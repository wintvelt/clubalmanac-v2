import { describe, expect, it } from "vitest";
import * as info from "../src/lib/infoPages";

// WP47: naast versie en buildnummer een label "dev" en/of "TestFlight", alleen
// als het geldt (besluit 2). Nooit een fout label: alleen een echt "ja" telt
// (invariant 1, 10). Vaste woorden en volgorde, " · " ertussen (invariant 11,
// vraag 3: tekst, geen pillen). Web: geen buildnummer, wel "dev" (invariant 5).
// Spec: docs/work-packages/WP47-versielabel.md §Spec-criticus aanvullingen.

type Flags = { dev: unknown; testFlight: unknown };
type BuildLabels = (flags: Flags) => string[];
type VersionText = (
  version: string | null | undefined,
  build: string | number | null | undefined,
  labels?: readonly string[],
) => string;

function buildLabels(flags: Flags): string[] {
  const fn = (info as Record<string, unknown>).buildLabels;
  expect(typeof fn, "buildLabels ontbreekt in src/lib/infoPages.ts").toBe("function");
  return (fn as BuildLabels)(flags);
}

const versionText = info.versionText as VersionText;

describe("buildLabels (WP47)", () => {
  it("dev-build uit TestFlight: dev, dan TestFlight", () => {
    expect(buildLabels({ dev: true, testFlight: true })).toEqual(["dev", "TestFlight"]);
  });

  it("production-build in TestFlight: alleen TestFlight (vraag 4)", () => {
    expect(buildLabels({ dev: false, testFlight: true })).toEqual(["TestFlight"]);
  });

  it("dev zonder TestFlight (Android, simulator, lokale webapp): alleen dev", () => {
    expect(buildLabels({ dev: true, testFlight: false })).toEqual(["dev"]);
    expect(buildLabels({ dev: true, testFlight: null })).toEqual(["dev"]);
  });

  it("App Store-build: geen label (invariant 2)", () => {
    expect(buildLabels({ dev: false, testFlight: false })).toEqual([]);
  });

  it("TestFlight onbekend: geen TestFlight-label (invariant 1)", () => {
    expect(buildLabels({ dev: false, testFlight: null })).toEqual([]);
    expect(buildLabels({ dev: false, testFlight: undefined })).toEqual([]);
  });

  it("alleen een echt ja telt (invariant 10)", () => {
    for (const notTrue of ["true", "sandbox", 1, {}, "TestFlight"]) {
      expect(buildLabels({ dev: false, testFlight: notTrue }), String(notTrue)).toEqual([]);
      expect(buildLabels({ dev: notTrue, testFlight: false }), String(notTrue)).toEqual([]);
    }
  });

  it("alleen de twee vaste woorden, nooit iets anders (invariant 6, 11)", () => {
    const values = [true, false, null, undefined, "https://glorious-pheasant-759.eu-west-1.convex.cloud"];
    for (const dev of values) {
      for (const testFlight of values) {
        for (const label of buildLabels({ dev, testFlight })) {
          expect(["dev", "TestFlight"]).toContain(label);
        }
      }
    }
  });
});

describe("versionText met labels (WP47, vraag 3)", () => {
  it("App Store: versie en buildnummer, zonder label", () => {
    expect(versionText("2.0.3", "98", [])).toBe("Versie 2.0.3 (98)");
  });

  it("dev-build uit TestFlight", () => {
    expect(versionText("2.0.3", "98", ["dev", "TestFlight"])).toBe("Versie 2.0.3 (98) · dev · TestFlight");
  });

  it("production-build in TestFlight", () => {
    expect(versionText("2.0.3", "98", ["TestFlight"])).toBe("Versie 2.0.3 (98) · TestFlight");
  });

  it("Android-dev-build", () => {
    expect(versionText("2.0.3", "12", ["dev"])).toBe("Versie 2.0.3 (12) · dev");
  });

  it("webapp tegen dev: geen buildnummer, wel dev (invariant 5)", () => {
    expect(versionText("2.0.3", null, ["dev"])).toBe("Versie 2.0.3 · dev");
  });

  it("zonder versie blijft het label staan", () => {
    expect(versionText(undefined, null, ["dev"])).toBe("Versie onbekend · dev");
  });

  it("zonder labels zoals in WP42", () => {
    expect(versionText("2.0.3", "98")).toBe("Versie 2.0.3 (98)");
    expect(versionText("2.0.3", null)).toBe("Versie 2.0.3");
  });
});
