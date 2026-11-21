import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { withOneRetry } from "../src/lib/actionRetry";

// WP37 gate op de iPhone, A-invariant 37: een action die wegvalt, krijgt één
// nieuwe poging.
//   Na de kiezer herverbindt de WebSocket. Een action die op dat moment al
//   verstuurd was, faalt in de Convex-client met "Connection lost while action
//   was in flight" (een gewone Error, geen ConvexError), en Convex probeert een
//   action niet zelf opnieuw. `withOneRetry(call)` roept `call` nog één keer aan
//   bij een fout die geen ConvexError is; een ConvexError (een weigering van de
//   backend) gaat meteen door. Faalt ook de tweede, dan gaat die fout door.
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §A-invarianten 37.

const LOST = "Connection lost while action was in flight";

function scripted<T>(steps: Array<{ ok: T } | { err: unknown }>) {
  let calls = 0;
  const call = async (): Promise<T> => {
    const step = steps[calls];
    calls += 1;
    if (!step) throw new Error("te vaak aangeroepen");
    if ("err" in step) throw step.err;
    return step.ok;
  };
  return { call, calls: () => calls };
}

describe("withOneRetry (A-invariant 37)", () => {
  it("lukt meteen: één aanroep", async () => {
    const s = scripted([{ ok: "link" }]);
    await expect(withOneRetry(s.call)).resolves.toBe("link");
    expect(s.calls()).toBe(1);
  });

  it("verbinding weg, dan gelukt: twee aanroepen, de uitkomst van de tweede", async () => {
    const s = scripted([{ err: new Error(LOST) }, { ok: "link" }]);
    await expect(withOneRetry(s.call)).resolves.toBe("link");
    expect(s.calls()).toBe(2);
  });

  it("ook bij een andere gewone fout (geen ConvexError) één nieuwe poging", async () => {
    const s = scripted([{ err: new TypeError("Network request failed") }, { ok: 7 }]);
    await expect(withOneRetry(s.call)).resolves.toBe(7);
    expect(s.calls()).toBe(2);
  });

  it("een ConvexError (weigering van de backend) gaat meteen door, zonder nieuwe poging", async () => {
    const refusal = new ConvexError({ code: "VIDEO_UPLOAD_REFUSED", reason: "te_vaak" });
    const s = scripted([{ err: refusal }, { ok: "link" }]);
    await expect(withOneRetry(s.call)).rejects.toBe(refusal);
    expect(s.calls()).toBe(1);
  });

  it("twee keer weg: de tweede fout gaat door, en er komt geen derde poging", async () => {
    const second = new Error(`${LOST} (2)`);
    const s = scripted([{ err: new Error(LOST) }, { err: second }, { ok: "link" }]);
    await expect(withOneRetry(s.call)).rejects.toBe(second);
    expect(s.calls()).toBe(2);
  });

  it("eerst weg, dan een weigering: de ConvexError gaat door", async () => {
    const refusal = new ConvexError({ code: "VIDEO_NOT_FOUND" });
    const s = scripted([{ err: new Error(LOST) }, { err: refusal }]);
    await expect(withOneRetry(s.call)).rejects.toBe(refusal);
    expect(s.calls()).toBe(2);
  });
});

describe("de actions in de foto- en filmpjesflow gaan via withOneRetry (A-invariant 37)", () => {
  const src = (f: string) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), "utf8");

  // Elke aanroep van de variabele uit `useAction(api.videos.<naam>)` staat in
  // een `withOneRetry(...)`: zoek per aanroep terug naar de dichtstbijzijnde
  // `withOneRetry(` en kijk of de aanroep binnen zijn haakjes valt.
  function unwrappedCalls(text: string, action: string): { name: string | null; bare: number; total: number } {
    const m = new RegExp(`(\\w+)\\s*=\\s*useAction\\(\\s*api\\.videos\\.${action}\\s*\\)`).exec(text);
    if (!m) return { name: null, bare: 0, total: 0 };
    const name = m[1]!;
    const calls = [...text.matchAll(new RegExp(`\\b${name}\\s*\\(`, "g"))].map((c) => c.index!);
    let bare = 0;
    for (const at of calls) {
      const wrap = text.lastIndexOf("withOneRetry(", at);
      if (wrap < 0) {
        bare += 1;
        continue;
      }
      // Sluit de haakjes van withOneRetry( pas ná deze aanroep?
      let depth = 0;
      let close = -1;
      for (let i = wrap + "withOneRetry".length; i < text.length; i++) {
        if (text[i] === "(") depth += 1;
        else if (text[i] === ")") {
          depth -= 1;
          if (depth === 0) {
            close = i;
            break;
          }
        }
      }
      if (close < at) bare += 1;
    }
    return { name, bare, total: calls.length };
  }

  it.each([
    ["data/videoUpload.ts", "startUpload"],
    ["components/VideoPlayer.tsx", "playUrl"],
    ["data/share.ts", "playUrl"],
  ])("%s: api.videos.%s alleen via withOneRetry", (file, action) => {
    const r = unwrappedCalls(src(file), action);
    expect(r.name, `geen useAction(api.videos.${action}) in ${file}`).not.toBeNull();
    expect(r.total, `${r.name} wordt in ${file} nergens aangeroepen`).toBeGreaterThan(0);
    expect(r.bare, `${r.name}(...) in ${file} buiten withOneRetry`).toBe(0);
  });
});
