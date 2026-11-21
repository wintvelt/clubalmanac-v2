import { describe, expect, it } from "vitest";
import { WIDE_FROM, wideOnIOS } from "../src/lib/wideLayout";

// Besluit Wouter 2026-11-21: op iOS de brede layout van Groep en Album alleen
// op een iPad die liggend staat, met een venster van minstens WIDE_FROM breed.
// Rechtop op de iPad en op de iPhone (ook liggend) blijft het smal.
describe("wideOnIOS", () => {
  const pad = (width: number, height: number) => wideOnIOS({ isPad: true, width, height });
  const phone = (width: number, height: number) => wideOnIOS({ isPad: false, width, height });

  it("iPad liggend: breed", () => {
    expect(pad(1376, 1032)).toBe(true); // iPad Pro 13"
    expect(pad(1133, 744)).toBe(true); // iPad mini
  });

  it("iPad rechtop: smal", () => {
    expect(pad(1032, 1376)).toBe(false);
    expect(pad(744, 1133)).toBe(false);
  });

  it("iPad liggend, maar een smal venster (Split View, Stage Manager): smal", () => {
    expect(pad(700, 1032)).toBe(false);
    expect(pad(700, 500)).toBe(false);
  });

  it("een liggend Stage Manager-venster van minstens WIDE_FROM: breed", () => {
    expect(pad(WIDE_FROM, WIDE_FROM - 1)).toBe(true);
    expect(pad(WIDE_FROM - 1, 600)).toBe(false);
  });

  it("vierkant venster is niet liggend: smal", () => {
    expect(pad(1000, 1000)).toBe(false);
  });

  it("iPhone: altijd smal, ook liggend", () => {
    expect(phone(956, 440)).toBe(false);
    expect(phone(440, 956)).toBe(false);
    expect(phone(1376, 1032)).toBe(false);
  });
});
