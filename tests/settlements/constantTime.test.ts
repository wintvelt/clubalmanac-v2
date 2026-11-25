import { describe, expect, it } from "vitest";
import { constantTimeEqual } from "../../convex/lib/constantTime";

// WP41 §A8: de vergelijking uit WP26 (lib/testGate.ts) wordt een gedeelde
// helper. Gedrag: gelijk alleen bij precies dezelfde tekst. Constante tijd
// zelf is niet te meten in een unit-test; die eigenschap toetst de audit aan
// de code (geen vroege stop op het eerste verschil).

describe("constantTimeEqual", () => {
  const S = "4f1c0e9a7b2d6c38e5a1f0b9d7c3e2a18b6f4d0c2e9a7b5d3f1c8e6a4b2d0f97";

  it("dezelfde tekst: gelijk", () => {
    expect(constantTimeEqual(S, S)).toBe(true);
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("één teken anders, vooraan, in het midden of achteraan: ongelijk", () => {
    for (const i of [0, 31, 63]) {
      const other = S.slice(0, i) + (S[i] === "0" ? "1" : "0") + S.slice(i + 1);
      expect(constantTimeEqual(other, S)).toBe(false);
    }
  });

  it("een begin of een verlenging is niet gelijk, in beide richtingen", () => {
    expect(constantTimeEqual(S.slice(0, 63), S)).toBe(false);
    expect(constantTimeEqual(`${S}0`, S)).toBe(false);
    expect(constantTimeEqual(S, S.slice(0, 63))).toBe(false);
    expect(constantTimeEqual("", S)).toBe(false);
    expect(constantTimeEqual(S, "")).toBe(false);
  });

  it("tekens buiten ASCII worden niet gelijkgesteld", () => {
    expect(constantTimeEqual("é", "e")).toBe(false);
    expect(constantTimeEqual("ā", "ā")).toBe(true);
  });
});
