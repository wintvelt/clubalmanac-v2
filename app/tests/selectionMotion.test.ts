import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { barSwap, pressFeedback, selectFeedback, titleChange } from "../src/lib/motion";
import { parse } from "./support/sourceScan";

// WP40 gate ronde 2, besluit Wouter: drie subtiele animaties in de
// selectiestand, in de stijl van WP33. Pure logica: de maten en duren.
// Hoe het oogt, de richting van de balken en het hergebruik van tegels
// toetsen audit en gate.
//
// `barSwap(reduceMotion)`: de wissel onderin (H1, H2). `leaving`: de balk die
//   weggaat (bij Selecteer de tabbalk, bij terug de selectiebalk); `arriving`:
//   de balk die komt. `delay` en `duration` in ms, gerekend vanaf de tik.
// `selectFeedback(reduceMotion)`: het vinkje en de gekozen tegel (H8).
//   `tileScale`: de schaal van een gekozen tegel in rust; `tileDuration`: in
//   ms, krimpen en terug; `markFromScale`: het vinkje begint op deze schaal en
//   veert naar 1; `markSpring`: de veer `{ damping, stiffness, mass }` (zoals
//   `withSpring` van Reanimated), `null` = meteen; `markOutDuration`: in ms,
//   het vinkje bij uitzetten (zonder veer).
// `titleChange(reduceMotion)`: het overvloeien van de titel (H12), `duration`
//   in ms.
// "Beperk beweging" (H14): elke duur 0, geen veer, meteen de eindstand.
//
// Spec: docs/work-packages/WP40-selectiebalk.md §Gate ronde 2: A-aanvullingen.

const end = (p: { delay: number; duration: number }) => p.delay + p.duration;

function finite(...xs: number[]) {
  for (const x of xs) expect(Number.isFinite(x)).toBe(true);
}

describe("barSwap: de wissel onderin (H1, H2)", () => {
  it("geeft eindige, niet-negatieve tijden", () => {
    const { leaving, arriving } = barSwap(false);
    finite(leaving.delay, leaving.duration, arriving.delay, arriving.duration);
    for (const t of [leaving.delay, leaving.duration, arriving.delay, arriving.duration]) expect(t).toBeGreaterThanOrEqual(0);
  });

  it("samen ongeveer een kwart seconde: 200 tot 300 ms (H1)", () => {
    const { leaving, arriving } = barSwap(false);
    const total = Math.max(end(leaving), end(arriving));
    expect(total).toBeGreaterThanOrEqual(200);
    expect(total).toBeLessThanOrEqual(300);
  });

  it("de balk die weggaat, begint meteen bij de tik (H1, WP33 invariant 12)", () => {
    const { leaving } = barSwap(false);
    expect(leaving.delay).toBe(0);
  });

  it("beide bewegen zichtbaar, geen flits: elk minstens 100 ms", () => {
    const { leaving, arriving } = barSwap(false);
    expect(leaving.duration).toBeGreaterThanOrEqual(100);
    expect(arriving.duration).toBeGreaterThanOrEqual(100);
  });

  it("geen gat: de nieuwe balk begint voordat de oude weg is (H2)", () => {
    const { leaving, arriving } = barSwap(false);
    expect(arriving.delay).toBeLessThan(end(leaving));
  });

  it("niet naast elkaar: de oude is weg uiterlijk als de nieuwe staat (H2)", () => {
    const { leaving, arriving } = barSwap(false);
    expect(end(leaving)).toBeLessThanOrEqual(end(arriving));
  });

  it("Beperk beweging: in één keer, zonder wachten (H14)", () => {
    expect(barSwap(true)).toEqual({ leaving: { delay: 0, duration: 0 }, arriving: { delay: 0, duration: 0 } });
  });
});

// --- Het vinkje (H8) -----------------------------------------------------------

type Spring = { damping: number; stiffness: number; mass: number };

// De veer doorgerekend: x'' = (stiffness·(1 − x) − damping·x') / mass, vanaf
// `from` in rust, naar 1. Zo werkt `withSpring` van Reanimated met deze
// drie waarden.
function simulate(spring: Spring, from: number) {
  const dt = 0.0002;
  let x = from;
  let v = 0;
  let peak = from;
  let peakAt = 0;
  let reach90: number | null = null;
  let lastOff = 0;
  const target90 = from + 0.9 * (1 - from);
  for (let t = 0; t <= 3; t += dt) {
    const a = (spring.stiffness * (1 - x) - spring.damping * v) / spring.mass;
    v += a * dt;
    x += v * dt;
    if (x > peak) {
      peak = x;
      peakAt = t;
    }
    if (reach90 === null && x >= target90) reach90 = t;
    if (Math.abs(x - 1) > 0.02) lastOff = t;
  }
  return { peak, peakAt, reach90, settledAt: lastOff, final: x };
}

describe("selectFeedback: vinkje en gekozen tegel (H8, H9)", () => {
  it("de gekozen tegel krimpt een beetje: tussen 0,86 en 0,95", () => {
    const f = selectFeedback(false);
    finite(f.tileScale);
    expect(f.tileScale).toBeGreaterThanOrEqual(0.86);
    expect(f.tileScale).toBeLessThanOrEqual(0.95);
  });

  it("ook ingedrukt blijft een gekozen tegel herkenbaar groot (H9): minstens 0,8", () => {
    const f = selectFeedback(false);
    expect(f.tileScale * pressFeedback("tile", false).scale).toBeGreaterThanOrEqual(0.8);
  });

  it("krimpen en terug gaan vloeiend, kort: 120 tot 300 ms", () => {
    const f = selectFeedback(false);
    finite(f.tileDuration);
    expect(f.tileDuration).toBeGreaterThanOrEqual(120);
    expect(f.tileDuration).toBeLessThanOrEqual(300);
  });

  it("het vinkje groeit vanuit klein: beginschaal tussen 0,3 en 0,85", () => {
    const f = selectFeedback(false);
    finite(f.markFromScale);
    expect(f.markFromScale).toBeGreaterThanOrEqual(0.3);
    expect(f.markFromScale).toBeLessThanOrEqual(0.85);
  });

  it("uitzetten: het vinkje gaat vloeiend weg, 80 tot 250 ms", () => {
    const f = selectFeedback(false);
    finite(f.markOutDuration);
    expect(f.markOutDuration).toBeGreaterThanOrEqual(80);
    expect(f.markOutDuration).toBeLessThanOrEqual(250);
  });

  describe("de veer van het vinkje", () => {
    it("is een veer met positieve waarden", () => {
      const f = selectFeedback(false);
      expect(f.markSpring).not.toBeNull();
      const s = f.markSpring!;
      finite(s.damping, s.stiffness, s.mass);
      expect(s.damping).toBeGreaterThan(0);
      expect(s.stiffness).toBeGreaterThan(0);
      expect(s.mass).toBeGreaterThan(0);
    });

    it("schiet zichtbaar maar klein voorbij: hoogste schaal tussen 1,02 en 1,15", () => {
      const f = selectFeedback(false);
      const r = simulate(f.markSpring!, f.markFromScale);
      expect(r.peak).toBeGreaterThanOrEqual(1.02);
      expect(r.peak).toBeLessThanOrEqual(1.15);
    });

    it("is meteen te zien: binnen 150 ms 90 % van de weg", () => {
      const f = selectFeedback(false);
      const r = simulate(f.markSpring!, f.markFromScale);
      expect(r.reach90).not.toBeNull();
      expect(r.reach90!).toBeLessThanOrEqual(0.15);
    });

    it("de top komt snel, binnen 250 ms", () => {
      const f = selectFeedback(false);
      expect(simulate(f.markSpring!, f.markFromScale).peakAt).toBeLessThanOrEqual(0.25);
    });

    it("staat binnen een halve seconde stil (binnen 2 % van 1)", () => {
      const f = selectFeedback(false);
      const r = simulate(f.markSpring!, f.markFromScale);
      expect(r.settledAt).toBeLessThanOrEqual(0.5);
      expect(Math.abs(r.final - 1)).toBeLessThan(0.001);
    });
  });

  it("Beperk beweging: meteen de eindstand, de tegel even klein (H14, A-keuze)", () => {
    const f = selectFeedback(false);
    const still = selectFeedback(true);
    expect(still.tileScale).toBe(f.tileScale);
    expect(still.tileDuration).toBe(0);
    expect(still.markFromScale).toBe(1);
    expect(still.markSpring).toBeNull();
    expect(still.markOutDuration).toBe(0);
  });
});

// --- De titel (H12) ------------------------------------------------------------

describe("titleChange: de titel vloeit over (H12, H13)", () => {
  it("kort: 120 tot 250 ms", () => {
    const { duration } = titleChange(false);
    finite(duration);
    expect(duration).toBeGreaterThanOrEqual(120);
    expect(duration).toBeLessThanOrEqual(250);
  });

  it("Beperk beweging: meteen (H14)", () => {
    expect(titleChange(true)).toEqual({ duration: 0 });
  });
});

describe("dezelfde uitkomst bij dezelfde invoer (F4, H15)", () => {
  it.each([false, true])("reduceMotion %s", (reduce) => {
    expect(barSwap(reduce)).toEqual(barSwap(reduce));
    expect(selectFeedback(reduce)).toEqual(selectFeedback(reduce));
    expect(titleChange(reduce)).toEqual(titleChange(reduce));
  });
});

// --- Bronscan: de maten komen van één plek (H15) -------------------------------
//
// Elke functie wordt aangeroepen in de code die de tabbalk of het scherm
// gebruikt: het bestand zelf of wat het (via relatieve imports, door en door)
// importeert. `lib/motion.ts` zelf telt niet mee, en voor de schermen ook de
// tabbalk niet: die is van de navigator.

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const MOTION = "lib/motion.ts";
const TAB_BAR = "navigation/TabBar.tsx";

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

const cache = new Map<string, ts.SourceFile>();
function source(rel: string): ts.SourceFile {
  let sf = cache.get(rel);
  if (!sf) {
    sf = parse(readFileSync(join(SRC, rel), "utf8"), rel.split("/").pop());
    cache.set(rel, sf);
  }
  return sf;
}

function imports(rel: string): string[] {
  const out: string[] = [];
  walk(source(rel), (n) => {
    const spec =
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)
        ? n.moduleSpecifier.text
        : undefined;
    if (!spec || !spec.startsWith(".")) return;
    const base = posix.normalize(posix.join(posix.dirname(rel), spec));
    const hit = [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((c) => existsSync(join(SRC, c)));
    if (hit) out.push(hit);
  });
  return out;
}

function reach(start: string, skip: ReadonlySet<string>): string[] {
  const seen = new Set<string>([start]);
  const todo = [start];
  while (todo.length) {
    for (const next of imports(todo.pop()!)) {
      if (seen.has(next) || skip.has(next)) continue;
      seen.add(next);
      todo.push(next);
    }
  }
  return [...seen];
}

/** Roept dit bestand `name(…)` aan (ook `x.name(…)`)? Commentaar telt niet. */
function calls(rel: string, name: string): boolean {
  let found = false;
  walk(source(rel), (n) => {
    if (!ts.isCallExpression(n)) return;
    const e = n.expression;
    if ((ts.isIdentifier(e) && e.text === name) || (ts.isPropertyAccessExpression(e) && e.name.text === name)) found = true;
  });
  return found;
}

const usedFrom = (start: string, name: string, skip: string[]) =>
  reach(start, new Set([MOTION, ...skip])).some((f) => calls(f, name));

describe("bronscan: de maten komen uit lib/motion.ts (H15)", () => {
  it("de scan ziet de bestanden", () => {
    for (const f of [MOTION, TAB_BAR, "screens/AlbumScreen.tsx", "screens/MyPhotosScreen.tsx"]) {
      expect(existsSync(join(SRC, f))).toBe(true);
    }
  });

  it("de tabbalk gebruikt barSwap (H1, H15)", () => {
    expect(usedFrom(TAB_BAR, "barSwap", [])).toBe(true);
  });

  it.each(["screens/AlbumScreen.tsx", "screens/MyPhotosScreen.tsx"])("%s: de selectiebalk gebruikt barSwap", (screen) => {
    expect(usedFrom(screen, "barSwap", [TAB_BAR])).toBe(true);
  });

  it.each(["screens/AlbumScreen.tsx", "screens/MyPhotosScreen.tsx"])("%s: het vinkje gebruikt selectFeedback", (screen) => {
    expect(usedFrom(screen, "selectFeedback", [TAB_BAR])).toBe(true);
  });

  it.each(["screens/AlbumScreen.tsx", "screens/MyPhotosScreen.tsx"])("%s: de titel gebruikt titleChange", (screen) => {
    expect(usedFrom(screen, "titleChange", [TAB_BAR])).toBe(true);
  });
});
