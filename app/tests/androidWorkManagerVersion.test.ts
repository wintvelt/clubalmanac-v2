import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// WP42c herstelronde, K4 (les van WP42b, A15): de uploader in de module
// `clubalmanac-video` gebruikt WorkManager in dezelfde versie als
// `react-native-maps`, die hem ook meebrengt. Gradle neemt per onderdeel de
// hoogste versie: een nieuwere versie in de module tilt ook die van de kaart
// mee (of zet de uploader op een versie waarmee hij niet getest is). Bij een
// upgrade van de kaart faalt deze test tot beide gelijk zijn.
// Spec: docs/work-packages/WP42-android.md §Herstelronde 42c, §Tests herstelronde (A).

const MODULE_GRADLE = fileURLToPath(new URL("../modules/clubalmanac-video/android/build.gradle", import.meta.url));
const MAPS_GRADLE = fileURLToPath(new URL("../node_modules/react-native-maps/android/build.gradle", import.meta.url));

/** De waarden van `def naam = "…"` in een build.gradle. */
function gradleDefs(source: string): Map<string, string> {
  const defs = new Map<string, string>();
  for (const m of source.matchAll(/\bdef\s+(\w+)\s*=\s*["']([^"']+)["']/g)) defs.set(m[1]!, m[2]!);
  return defs;
}

/** De versie van elke afhankelijkheid `androidx.work:…:<versie>`, met `${naam}` ingevuld. */
function workVersions(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const defs = gradleDefs(code);
  const out: string[] = [];
  for (const m of code.matchAll(/["']androidx\.work:[\w-]+:([^"']+)["']/g)) {
    out.push(m[1]!.replace(/\$\{(\w+)\}|\$(\w+)/g, (whole, a, b) => defs.get(a ?? b) ?? whole));
  }
  return out;
}

describe("WorkManager in de module is de versie van react-native-maps (K4)", () => {
  it("beide build.gradle-bestanden bestaan", () => {
    expect(existsSync(MODULE_GRADLE)).toBe(true);
    expect(existsSync(MAPS_GRADLE)).toBe(true);
  });

  it("react-native-maps noemt één versie van WorkManager", () => {
    const versions = new Set(workVersions(readFileSync(MAPS_GRADLE, "utf8")));
    expect(versions.size).toBe(1);
    expect([...versions][0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("elke WorkManager-afhankelijkheid van de module heeft die versie", () => {
    const [mapsVersion] = workVersions(readFileSync(MAPS_GRADLE, "utf8"));
    const moduleVersions = workVersions(readFileSync(MODULE_GRADLE, "utf8"));
    expect(moduleVersions.length).toBeGreaterThan(0);
    for (const version of moduleVersions) expect(version).toBe(mapsVersion);
  });
});
