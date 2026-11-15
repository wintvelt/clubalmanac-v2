import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { filmPlayerCommand, filmScreenOptions } from "../src/lib/films";
import { parse } from "./support/sourceScan";

// WP21 gate-fix: twee vondsten uit de simulator-gate (iPhone, dev-build met
// nativeControls).
//
// 1. Spoelen schuift het scherm weg. De tijdbalk van de inline speler begint
//    bij de linkerrand; slepen daar wint het terug-veeggebaar van de stack.
//    Grens: het filmscherm zet het veeggebaar uit (`gestureEnabled: false`)
//    en houdt de navigatiebalk met de terugknop. Deze test pint alleen de
//    schermopties; of spoelen in de speler echt werkt, controleert de
//    simulator-gate.
//
// 2. De film speelt door als zijn scherm niet in beeld is (een tweede
//    filmscherm erop, een andere tab). Dat kost S3-verkeer (invariant 6).
//    Grens: een pure functie die zegt wat de speler doet bij "link klaar" en
//    bij een focuswissel, en FilmPlayer gebruikt hem met de focus van het
//    scherm.
//    A-keuze: bij terugkomen speelt de film niet vanzelf verder. De kijker
//    drukt zelf op afspelen (de standaard-speler toont de knop); de plek
//    blijft staan. Komt de link binnen terwijl het scherm al weg is, dan
//    start de film niet.
// Spec: docs/work-packages/WP21-videos.md §Gate-fix.

describe("vondst 1: spoelen zonder dat het scherm wegschuift", () => {
  it("het filmscherm zet het terug-veeggebaar uit", () => {
    expect(filmScreenOptions.gestureEnabled).toBe(false);
  });

  it("de terugknop blijft: navigatiebalk zichtbaar, terugknop niet verborgen of vervangen", () => {
    const o = filmScreenOptions as Record<string, unknown>;
    expect(o.headerShown).not.toBe(false);
    expect(o.headerBackVisible).not.toBe(false);
    expect(o.headerLeft).toBeUndefined();
    expect(o.presentation ?? "card").toBe("card");
  });

  it("de Home-stack gebruikt filmScreenOptions voor de film-route", () => {
    const layoutPath = fileURLToPath(new URL("../src/app/(tabs)/(home)/_layout.tsx", import.meta.url));
    const sf = parse(readFileSync(layoutPath, "utf8"), "_layout.tsx");
    const optionTexts: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
        const name = attrs.find((a) => a.name.getText(sf) === "name");
        const value = name?.initializer && ts.isStringLiteral(name.initializer) ? name.initializer.text : null;
        if (value === "groep/[groupId]/film/[filmId]") {
          const options = attrs.find((a) => a.name.getText(sf) === "options");
          optionTexts.push(options?.initializer?.getText(sf) ?? "");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(optionTexts, "film-route staat precies één keer in de Home-stack").toHaveLength(1);
    expect(optionTexts[0]).toMatch(/\bfilmScreenOptions\b/);
  });
});

describe("vondst 2: pauzeren als het filmscherm niet in beeld is", () => {
  it("link klaar en scherm in beeld → afspelen", () => {
    expect(filmPlayerCommand({ type: "linkReady", focused: true })).toBe("play");
  });

  it("link klaar maar scherm niet meer in beeld → niet starten", () => {
    expect(filmPlayerCommand({ type: "linkReady", focused: false })).toBe("none");
  });

  it("scherm verliest de focus (filmscherm erop, andere tab) → pauzeren", () => {
    expect(filmPlayerCommand({ type: "focusChanged", focused: false })).toBe("pause");
  });

  it("scherm krijgt de focus terug → niet vanzelf verder spelen (A-keuze)", () => {
    expect(filmPlayerCommand({ type: "focusChanged", focused: true })).toBe("none");
  });

  describe("FilmPlayer gebruikt de focus van het scherm", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/screens/FilmPlayer.tsx", import.meta.url)), "utf8");

    it("leest de focus met useIsFocused en beslist met filmPlayerCommand", () => {
      expect(src).toMatch(/\buseIsFocused\s*\(/);
      expect(src).toMatch(/\bfilmPlayerCommand\s*\(/);
    });

    it("speelt niet op de achtergrond of in beeld-in-beeld", () => {
      expect(src).not.toMatch(/staysActiveInBackground\s*=\s*true/);
      expect(src).not.toMatch(/staysActiveInBackground\s*:\s*true/);
      expect(src).not.toMatch(/allowsPictureInPicture(\s*=\s*\{\s*true\s*\}|\s*(?=[\s/>]))/);
      expect(src).not.toMatch(/startsPictureInPictureAutomatically/);
    });
  });
});
