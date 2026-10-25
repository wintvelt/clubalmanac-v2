import { describe, expect, it } from "vitest";
import { AA_LARGE_OR_UI, AA_TEXT, contrastRatio } from "../src/lib/contrast";
import { colors, typography, type ColorScheme, type ColorTokens } from "../src/theme/tokens";

// WP-Design invariant 4: tekst haalt WCAG AA in licht én donker. Het contrast
// wordt hier berekend uit de tokens, niet overgenomen uit design.md.

describe("contrastRatio (WCAG-formule)", () => {
  it("zwart op wit is 21:1, in beide volgordes", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
  });

  it("een kleur op zichzelf is 1:1", () => {
    expect(contrastRatio("#0369A1", "#0369A1")).toBeCloseTo(1, 5);
  });

  it("#767676 op wit is de bekende grens van 4,54:1", () => {
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  });

  it("weigert iets anders dan #RRGGBB", () => {
    expect(() => contrastRatio("#FFF", "#000000")).toThrow();
    expect(() => contrastRatio("rgba(0,0,0,1)", "#000000")).toThrow();
  });
});

type Pair = { fg: keyof ColorTokens; bg: keyof ColorTokens; min: number; why: string };

// Elk paar uit design.md §2, plus de paren die de componenten van stap 7
// gebruiken. Norm 3:1 alleen voor randen en vlakken, nooit voor tekst.
const PAIRS: Pair[] = [
  { fg: "text", bg: "bg", min: AA_TEXT, why: "gewone tekst" },
  { fg: "muted", bg: "surface", min: AA_TEXT, why: "tweede regel, meta" },
  { fg: "primary", bg: "surface", min: AA_TEXT, why: "links, terug, jaartal" },
  { fg: "onCta", bg: "cta", min: AA_TEXT, why: "tekst op de hoofdknop" },
  { fg: "ctaText", bg: "bg", min: AA_TEXT, why: "oranje tekstknop" },
  { fg: "tabInactive", bg: "tabbar", min: AA_TEXT, why: "label inactieve tab" },
  { fg: "primary", bg: "tabPill", min: AA_TEXT, why: "label en icoon actieve tab" },
  { fg: "segOn", bg: "segBg", min: AA_LARGE_OR_UI, why: "gekozen groepstab tegen de balk" },
  { fg: "onSegOn", bg: "segOn", min: AA_TEXT, why: "tekst gekozen groepstab" },
  { fg: "fieldLine", bg: "field", min: AA_LARGE_OR_UI, why: "rand invoerveld" },
  { fg: "danger", bg: "surface", min: AA_TEXT, why: "fout, verwijderen" },
  { fg: "success", bg: "surface", min: AA_TEXT, why: "bevestiging" },
  { fg: "onGradient", bg: "gradStart", min: AA_TEXT, why: "initialen op het verloop (lime)" },
  { fg: "onGradient", bg: "gradEnd", min: AA_TEXT, why: "initialen op het verloop (sky)" },
  // Gebruikt door de componenten en de WP13-schermen.
  { fg: "text", bg: "surface", min: AA_TEXT, why: "tekst in melding, lijstrij, inlogscherm" },
  { fg: "muted", bg: "bg", min: AA_TEXT, why: "meta op de schermachtergrond" },
  { fg: "primary", bg: "bg", min: AA_TEXT, why: "tekstknop en tweede knop op de achtergrond" },
  { fg: "text", bg: "field", min: AA_TEXT, why: "invoer in het veld" },
  { fg: "primary", bg: "field", min: AA_LARGE_OR_UI, why: "focusrand invoerveld" },
];

describe.each<ColorScheme>(["light", "dark"])("tokens %s", (scheme) => {
  const c = colors[scheme];
  it.each(PAIRS)("$fg op $bg haalt $min:1 ($why)", ({ fg, bg, min }) => {
    expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(min);
  });
});

describe("tekstschaal", () => {
  it("tabbalk-labels groeien hoogstens 1,2×, tot 15,6 pt", () => {
    for (const role of [typography.tabLabel, typography.tabLabelActive]) {
      expect(role.maxFontSizeMultiplier).toBe(1.2);
      expect(role.fontSize * role.maxFontSizeMultiplier).toBeCloseTo(15.6, 5);
    }
  });

  it("alle andere tekst schaalt zonder grens mee", () => {
    const capped = Object.entries(typography)
      .filter(([, role]) => "maxFontSizeMultiplier" in role)
      .map(([name]) => name);
    expect(capped.sort()).toEqual(["tabLabel", "tabLabelActive"]);
  });
});
