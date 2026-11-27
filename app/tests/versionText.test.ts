import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { versionText } from "../src/lib/infoPages";

// WP42 B18 (regie, 2026-11-27): bij Info staat naast de versie het
// buildnummer, "Versie 2.0.2 (7)", op Android en op iOS. Zonder buildnummer
// (web, Expo Go): alleen de versie, geen lege haakjes.
// Spec: docs/work-packages/WP42-android.md §Besluiten Wouter (42c), B18; A37.

describe("versionText (B18)", () => {
  it("versie en buildnummer", () => {
    expect(versionText("2.0.2", "7")).toBe("Versie 2.0.2 (7)");
    expect(versionText("2.0.2", 7)).toBe("Versie 2.0.2 (7)");
    expect(versionText("2.0.3", "112")).toBe("Versie 2.0.3 (112)");
  });

  it("zonder buildnummer: alleen de versie, geen lege haakjes", () => {
    for (const build of [null, undefined, "", "  "]) {
      expect(versionText("2.0.2", build), String(build)).toBe("Versie 2.0.2");
    }
  });

  it("spaties om het buildnummer tellen niet", () => {
    expect(versionText("2.0.2", " 7 ")).toBe("Versie 2.0.2 (7)");
  });

  it("zonder versie en buildnummer: zoals nu", () => {
    expect(versionText(undefined, undefined)).toBe("Versie onbekend");
    expect(versionText(null, null)).toBe("Versie onbekend");
  });
});

describe("Info gebruikt versionText", () => {
  it("InfoList.tsx toont de regel via versionText, niet alleen de versie uit app.json", () => {
    const text = readFileSync(fileURLToPath(new URL("../src/screens/InfoList.tsx", import.meta.url)), "utf8");
    expect(text).toMatch(/\bversionText\s*\(/);
    expect(text).not.toMatch(/Versie\s*\{\s*config\?\.version/);
  });
});
