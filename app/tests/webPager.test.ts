import { describe, expect, it } from "vitest";
import { SWIPE_MIN_PX, neighbours, stepIndex, swipeIndex } from "../src/lib/webPager";

// Webapp-fix 3 (besluit Wouter): het foto-detail op het web toont één foto
// tegelijk, zonder horizontale scrollcontainer. In WebKit liep de horizontale
// lijst zelf weg terwijl beelden binnenkwamen. Alleen de user verandert de
// foto: pijltjes, pijltoetsen of een veeg over de drempel.

const W = 390;

describe("stepIndex — één stap, binnen de grenzen", () => {
  it.each<[number, number, number, number]>([
    [4, 1, 58, 5],
    [4, -1, 58, 3],
    [0, -1, 58, 0],
    [57, 1, 58, 57],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
  ])("van %i met %i in %i foto's: %i", (index, delta, count, to) => {
    expect(stepIndex(index, delta, count)).toBe(to);
  });
});

describe("swipeIndex — vegen met een drempel", () => {
  const swipe = (dx: number, dy = 0, index = 4, count = 58) => swipeIndex({ dx, dy, width: W, index, count });

  it("naar links vegen: de volgende foto; naar rechts: de vorige", () => {
    expect(swipe(-120)).toBe(5);
    expect(swipe(120)).toBe(3);
  });

  it("onder de drempel: dezelfde foto (een tik, een kleine sleep)", () => {
    expect(swipe(0)).toBe(4);
    expect(swipe(-(SWIPE_MIN_PX - 1))).toBe(4);
    expect(swipe(SWIPE_MIN_PX - 1)).toBe(4);
  });

  it("op de drempel telt", () => {
    expect(swipe(-SWIPE_MIN_PX)).toBe(5);
  });

  it("te schuin (vooral verticaal): dezelfde foto", () => {
    expect(swipe(-80, 100)).toBe(4);
    expect(swipe(-80, -60)).toBe(4);
    expect(swipe(-160, 100)).toBe(5);
  });

  it("aan de randen: blijft staan", () => {
    expect(swipe(120, 0, 0)).toBe(0);
    expect(swipe(-120, 0, 57)).toBe(57);
  });

  it("een smal vak: een kleinere drempel", () => {
    expect(swipeIndex({ dx: -40, dy: 0, width: 200, index: 1, count: 3 })).toBe(2);
  });

  it("één veeg is hooguit één foto, hoe lang ook", () => {
    expect(swipe(-5000)).toBe(5);
  });

  it("geen getal: dezelfde foto", () => {
    expect(swipe(Number.NaN)).toBe(4);
  });
});

describe("neighbours — voorladen verandert niets aan de index", () => {
  it("vorige en volgende, binnen de lijst", () => {
    expect(neighbours(4, 58)).toEqual([3, 5]);
    expect(neighbours(0, 58)).toEqual([1]);
    expect(neighbours(57, 58)).toEqual([56]);
    expect(neighbours(0, 1)).toEqual([]);
  });
});
