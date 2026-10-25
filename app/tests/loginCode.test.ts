import { describe, expect, it } from "vitest";
import { normalizeLoginCode } from "../src/lib/loginCode";

// WP13 invariant 19 + edge case "plakken": de code uit de mail moet in de
// lopende login terechtkomen, ook als hij niet getypt is (plakken, iOS-autofill,
// later de mail-link uit WP22). Clerk-mailcodes zijn 6 cijfers.
// Geeft de 6 cijfers terug, of null. Raadt niet uit langere tekst.

describe("normalizeLoginCode — geldige invoer", () => {
  const cases: Array<[string, string]> = [
    ["123456", "123456"],
    ["012345", "012345"],
    [" 123456 ", "123456"],
    ["123 456", "123456"],
    ["123-456", "123456"],
    ["123456\n", "123456"],
    ["\t12 34 56\r\n", "123456"],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${expected}`, () => {
      expect(normalizeLoginCode(input)).toBe(expected);
    });
  }
});

describe("normalizeLoginCode — ongeldige invoer geeft null", () => {
  const cases: string[] = [
    "",
    "   ",
    "12345",
    "1234567",
    "abcdef",
    "12345a",
    "123.456",
    "Je code is 123456",
    "123456 789012",
    "１２３４５６", // volle-breedte cijfers: geen ASCII
  ];
  for (const input of cases) {
    it(`${JSON.stringify(input)} → null`, () => {
      expect(normalizeLoginCode(input)).toBeNull();
    });
  }
});
