import { describe, expect, it } from "vitest";
import { pagerSettle } from "../src/lib/webPager";

// Webapp-fix (melding Wouter, iPhone Safari): het foto-detail opende met een
// andere foto dan de tegel en wisselde daarna steeds. Een terugkoppellus: een
// nieuwe foto in beeld verandert de gerenderde lijst, Safari zet de
// scroll-snap dan zelf op een andere plek, en dat telde als bladeren. Alleen
// een gebaar van de user mag de foto in beeld veranderen.

const W = 375;

describe("pagerSettle", () => {
  it("met een gebaar: de foto waar het scrollen stilstaat", () => {
    expect(pagerSettle({ gesture: true, scrollLeft: 5 * W, pageWidth: W, index: 4, count: 58 })).toEqual({
      kind: "show",
      index: 5,
    });
  });

  it("met een gebaar: binnen de grenzen", () => {
    expect(pagerSettle({ gesture: true, scrollLeft: 99 * W, pageWidth: W, index: 4, count: 10 })).toEqual({
      kind: "show",
      index: 9,
    });
    expect(pagerSettle({ gesture: true, scrollLeft: -40, pageWidth: W, index: 0, count: 10 })).toEqual({
      kind: "show",
      index: 0,
    });
  });

  it("zonder gebaar: terug naar de foto in beeld, niet bladeren", () => {
    expect(pagerSettle({ gesture: false, scrollLeft: 27 * W, pageWidth: W, index: 28, count: 58 })).toEqual({
      kind: "restore",
      left: 28 * W,
    });
  });

  it("zonder gebaar en op de goede plek: niets (geen nieuwe scroll)", () => {
    expect(pagerSettle({ gesture: false, scrollLeft: 28 * W, pageWidth: W, index: 28, count: 58 })).toEqual({
      kind: "none",
    });
    expect(pagerSettle({ gesture: false, scrollLeft: 28 * W + 0.5, pageWidth: W, index: 28, count: 58 })).toEqual({
      kind: "none",
    });
  });

  it("nog geen maat: niets", () => {
    expect(pagerSettle({ gesture: true, scrollLeft: 100, pageWidth: 0, index: 0, count: 5 })).toEqual({ kind: "none" });
  });
});

// Een browser die na elke wissel van foto de snap zelf een plek opschuift
// (zoals Safari doet als de gerenderde foto's veranderen), zonder gebaar.
function simulate(open: number, settles: number, decide: typeof pagerSettle) {
  let index = open;
  let scrollLeft = open * W;
  const shown: number[] = [];
  let layoutChanged = true; // het openen zelf verandert de lijst
  for (let n = 0; n < settles; n += 1) {
    if (layoutChanged) scrollLeft += W; // Safari: opnieuw snappen, één verder
    layoutChanged = false;
    const step = decide({ gesture: false, scrollLeft, pageWidth: W, index, count: 58 });
    if (step.kind === "show" && step.index !== index) {
      index = step.index;
      layoutChanged = true;
    }
    if (step.kind === "restore") scrollLeft = step.left;
    shown.push(index);
  }
  return { index, scrollLeft, shown };
}

describe("de lus van wisselende foto's", () => {
  it("vroeger (elke stilstand telt): de foto blijft wisselen", () => {
    const old: typeof pagerSettle = (p) => ({
      kind: "show",
      index: Math.max(0, Math.min(p.count - 1, Math.round(p.scrollLeft / p.pageWidth))),
    });
    const { shown } = simulate(28, 6, old);
    expect(new Set(shown).size).toBeGreaterThan(3);
  });

  it("nu: het detail blijft op de foto van de tegel", () => {
    const { index, scrollLeft, shown } = simulate(28, 6, pagerSettle);
    expect(shown.every((i) => i === 28)).toBe(true);
    expect(index).toBe(28);
    expect(scrollLeft).toBe(28 * W);
  });
});
