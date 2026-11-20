import { describe, expect, it } from "vitest";
import { createImageMemory } from "../src/lib/imageMemory";

// Webapp-fix 2 (melding Wouter, iPhone Safari, mobiel netwerk): in het
// foto-detail eerst het beeld-icoon, daarna een reeks foto's die elkaar
// eindeloos vervangen. Het geheugen gooide bij de grens ook beelden weg die
// nog in beeld stonden en trok hun `blob:`-URL in. iOS Safari decodeert een
// beeld dat even uit beeld was opnieuw vanaf die URL; dat mislukt, de app
// haalt het opnieuw op, en dat duwt een ander beeld eruit. Een beeld in beeld
// (`hold`) gaat er niet meer uit.

type Held = { url: string };

function setup(limit: number) {
  const revoked = new Set<string>();
  const m = createImageMemory<Held>({ limit, release: (v) => revoked.add(v.url) });
  return { m, revoked };
}

describe("hold — een beeld in beeld gaat er niet uit", () => {
  it("bij de grens gaat het oudste beeld dat niet in beeld staat eruit", () => {
    const { m, revoked } = setup(2);
    m.hold("a");
    m.put("a", { url: "blob:a" });
    m.put("b", { url: "blob:b" });
    m.put("c", { url: "blob:c" });
    expect(m.get("a")).toEqual({ url: "blob:a" });
    expect(m.get("b")).toBeUndefined();
    expect([...revoked]).toEqual(["blob:b"]);
  });

  it("staat alles in beeld, dan groeit het geheugen tijdelijk; daarna weer tot de grens", () => {
    const { m, revoked } = setup(2);
    for (const k of ["a", "b", "c"]) {
      m.hold(k);
      m.put(k, { url: `blob:${k}` });
    }
    expect(m.size()).toBe(3);
    expect(revoked.size).toBe(0);
    m.unhold("a");
    expect(m.size()).toBe(2);
    expect([...revoked]).toEqual(["blob:a"]);
  });

  it("telt per scherm: pas los als geen scherm het meer toont", () => {
    const { m } = setup(1);
    m.hold("a");
    m.hold("a");
    m.put("a", { url: "blob:a" });
    m.unhold("a");
    m.put("b", { url: "blob:b" });
    expect(m.get("a")).toEqual({ url: "blob:a" });
    m.unhold("a");
    m.put("c", { url: "blob:c" });
    expect(m.get("a")).toBeUndefined();
    expect(m.get("c")).toEqual({ url: "blob:c" });
  });

  it("vastzetten vóór het binnenkomen telt ook", () => {
    const { m } = setup(1);
    m.hold("a");
    m.put("b", { url: "blob:b" });
    m.put("a", { url: "blob:a" });
    expect(m.get("a")).toEqual({ url: "blob:a" });
  });

  it("weghalen (een beeld dat niet te tonen was) en leegmaken gelden ook voor een vastgezet beeld", () => {
    const { m, revoked } = setup(3);
    m.hold("a");
    m.put("a", { url: "blob:a" });
    m.delete("a");
    expect(m.get("a")).toBeUndefined();
    m.put("a", { url: "blob:a2" });
    m.clear();
    expect(m.size()).toBe(0);
    expect([...revoked].sort()).toEqual(["blob:a", "blob:a2"]);
  });
});

// Een album onder het detail: meer beelden in beeld dan de grens. Elke ronde
// decodeert Safari elk beeld opnieuw vanaf zijn URL; een ingetrokken URL geeft
// een fout, en het scherm haalt het beeld opnieuw op.
function rounds(opts: { shown: number; limit: number; rounds: number; hold: boolean }) {
  const { m, revoked } = setup(opts.limit);
  const keys = Array.from({ length: opts.shown }, (_, i) => `foto-${i}`);
  const shownUrl = new Map<string, string>();
  let fetches = 0;
  const fetch = (key: string) => {
    fetches += 1;
    const url = `blob:${key}#${fetches}`;
    m.put(key, { url });
    shownUrl.set(key, url);
  };
  for (const key of keys) {
    if (opts.hold) m.hold(key);
    fetch(key);
  }
  const perRound: number[] = [];
  for (let r = 0; r < opts.rounds; r += 1) {
    const before = fetches;
    for (const key of keys) {
      const url = shownUrl.get(key)!;
      if (revoked.has(url)) {
        m.delete(key);
        fetch(key);
      } else {
        m.get(key);
      }
    }
    perRound.push(fetches - before);
  }
  return { perRound, size: m.size() };
}

describe("de lus van opnieuw ophalen", () => {
  it("zonder vastzetten: elke ronde opnieuw ophalen, eindeloos", () => {
    const { perRound } = rounds({ shown: 30, limit: 20, rounds: 10, hold: false });
    expect(perRound.every((n) => n > 0)).toBe(true);
  });

  it("met vastzetten: na het eerste laden niets meer opgehaald", () => {
    const { perRound, size } = rounds({ shown: 30, limit: 20, rounds: 10, hold: true });
    expect(perRound.every((n) => n === 0)).toBe(true);
    expect(size).toBe(30);
  });
});
