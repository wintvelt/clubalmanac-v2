import { describe, expect, it } from "vitest";
import { createImageMemory, imageMemoryKey } from "../src/lib/imageMemory";
import { inviteCoverUrl, photoImageUrl, profileImageUrl } from "../src/lib/imageUrls";

// WP35 A-invariant W3 (vraag 1, route A): op het web haalt de app een foto of
// uitnodigingscover op met het token in de header, zonder HTTP-cache, en houdt
// hem als `blob:`-URL in een eigen geheugen. Spec:
// docs/work-packages/WP35-webapp-bekijken.md §Spec-criticus aanvullingen.
//
// Het geheugen is puur (nieuwe module src/lib/imageMemory.ts): de web-variant
// van de beeldbron geeft `release` mee (`URL.revokeObjectURL`).
//
// - Begrensd: bij de grens gaat het langst niet gebruikte beeld eruit, en wordt
//   het vrijgegeven. Een album van 540 foto's groeit zo niet onbeperkt.
// - Lezen telt als gebruik.
// - Een nieuw beeld onder dezelfde sleutel geeft het oude vrij.
// - Leegmaken (uitloggen) geeft alles vrij, elk precies één keer.
// - De sleutel bevat de user: een volgende user in dezelfde browser krijgt
//   nooit een beeld van de vorige, ook niet als leegmaken mislukte. Hij hangt
//   niet af van het token (dat wisselt elke minuut).

type Blobby = { url: string };

function memory(limit: number) {
  const released: string[] = [];
  const m = createImageMemory<Blobby>({ limit, release: (v) => released.push(v.url) });
  return { m, released };
}

const b = (url: string): Blobby => ({ url });

describe("createImageMemory — begrensd, langst niet gebruikt eruit", () => {
  it("bewaart en geeft terug", () => {
    const { m, released } = memory(3);
    m.put("a", b("blob:a"));
    expect(m.get("a")).toEqual(b("blob:a"));
    expect(m.get("onbekend")).toBeUndefined();
    expect(m.size()).toBe(1);
    expect(released).toEqual([]);
  });

  it("boven de grens gaat het oudste eruit en wordt het vrijgegeven", () => {
    const { m, released } = memory(2);
    m.put("a", b("blob:a"));
    m.put("b", b("blob:b"));
    m.put("c", b("blob:c"));
    expect(m.size()).toBe(2);
    expect(m.get("a")).toBeUndefined();
    expect(m.get("b")).toEqual(b("blob:b"));
    expect(m.get("c")).toEqual(b("blob:c"));
    expect(released).toEqual(["blob:a"]);
  });

  it("lezen telt als gebruik", () => {
    const { m, released } = memory(2);
    m.put("a", b("blob:a"));
    m.put("b", b("blob:b"));
    expect(m.get("a")).toEqual(b("blob:a"));
    m.put("c", b("blob:c"));
    expect(m.get("a")).toEqual(b("blob:a"));
    expect(m.get("b")).toBeUndefined();
    expect(released).toEqual(["blob:b"]);
  });

  it("een nieuw beeld onder dezelfde sleutel geeft het oude vrij, zonder iets anders te verdringen", () => {
    const { m, released } = memory(2);
    m.put("a", b("blob:a1"));
    m.put("b", b("blob:b"));
    m.put("a", b("blob:a2"));
    expect(m.size()).toBe(2);
    expect(m.get("a")).toEqual(b("blob:a2"));
    expect(m.get("b")).toEqual(b("blob:b"));
    expect(released).toEqual(["blob:a1"]);
  });

  it("hetzelfde beeld opnieuw zetten geeft niets vrij", () => {
    const { m, released } = memory(2);
    const a = b("blob:a");
    m.put("a", a);
    m.put("a", a);
    expect(m.get("a")).toBe(a);
    expect(released).toEqual([]);
  });

  it("een lang album: nooit meer dan de grens, en alles wat eruit ging is vrijgegeven", () => {
    const { m, released } = memory(50);
    for (let i = 0; i < 540; i++) m.put(`foto-${i}`, b(`blob:${i}`));
    expect(m.size()).toBe(50);
    expect(released).toHaveLength(490);
    expect(new Set(released).size).toBe(490);
    expect(m.get("foto-539")).toEqual(b("blob:539"));
    expect(m.get("foto-489")).toBeUndefined();
  });

  it("leegmaken geeft alles precies één keer vrij", () => {
    const { m, released } = memory(5);
    m.put("a", b("blob:a"));
    m.put("b", b("blob:b"));
    m.put("c", b("blob:c"));
    m.clear();
    expect(m.size()).toBe(0);
    expect(m.get("a")).toBeUndefined();
    expect([...released].sort()).toEqual(["blob:a", "blob:b", "blob:c"]);
    m.clear();
    expect(released).toHaveLength(3);
  });
});

describe("imageMemoryKey — per user, nooit gelijk voor iets anders", () => {
  it("vast: dezelfde invoer geeft dezelfde sleutel", () => {
    expect(imageMemoryKey("u1", "foto", "p1", "klein")).toBe(imageMemoryKey("u1", "foto", "p1", "klein"));
  });

  it("verschilt per user, soort, id en formaat", () => {
    const keys = [
      imageMemoryKey("u1", "foto", "p1", "klein"),
      imageMemoryKey("u2", "foto", "p1", "klein"),
      imageMemoryKey("u1", "uitnodiging", "p1", "klein"),
      imageMemoryKey("u1", "foto", "p2", "klein"),
      imageMemoryKey("u1", "foto", "p1", "groot"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("geen botsing door scheidingstekens in een id", () => {
    const seps = [":", "|", "/", "#", "?", "&", "=", " ", "\u0000", "%3A"];
    const keys = new Set<string>();
    let n = 0;
    for (const s of seps) {
      for (const [user, id] of [
        [`a${s}b`, "c"],
        ["a", `b${s}c`],
        [`a${s}foto`, "c"],
        ["a", `klein${s}c`],
      ] as const) {
        keys.add(imageMemoryKey(user, "foto", id, "klein"));
        n++;
      }
    }
    expect(keys.size).toBe(n);
  });
});

describe("geen token in een beeld-URL", () => {
  const site = "https://happy-otter-123.eu-west-1.convex.site";

  it("foto, uitnodiging en profiel: alleen pad, id en formaat", () => {
    for (const url of [
      photoImageUrl(site, "p1", "klein"),
      inviteCoverUrl(site, "i1", "groot"),
      profileImageUrl(site, "u1", "klein"),
    ]) {
      expect(url).toMatch(/^https:\/\/[^?#]+\?formaat=(klein|groot)$/);
      expect(url).not.toMatch(/token|bearer|authorization|sig|jwt/i);
    }
  });
});
