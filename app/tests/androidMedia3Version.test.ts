import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// WP42b fix-ronde (audit G4), A15: de module `clubalmanac-video` gebruikt Media3
// in dezelfde versie als `expo-video`. Gradle neemt per onderdeel van Media3 de
// hoogste versie: een andere versie in de module tilt ook de speler van
// `expo-video` stil naar een versie waartegen die niet gebouwd is (of zet de
// module op een andere versie dan waarmee hij getest is). Bij een
// Expo-upgrade faalt deze test tot beide gelijk zijn.
// Spec: docs/work-packages/WP42-android.md §Fix-ronde 42b (A).

const MODULE_GRADLE = fileURLToPath(new URL("../modules/clubalmanac-video/android/build.gradle", import.meta.url));
const EXPO_VIDEO_GRADLE = fileURLToPath(new URL("../node_modules/expo-video/android/build.gradle", import.meta.url));

/** De waarden van `def naam = "…"` in een build.gradle. */
function gradleDefs(source: string): Map<string, string> {
  const defs = new Map<string, string>();
  for (const m of source.matchAll(/\bdef\s+(\w+)\s*=\s*["']([^"']+)["']/g)) defs.set(m[1]!, m[2]!);
  return defs;
}

/** De versie van elke afhankelijkheid `androidx.media3:…:<versie>`, met `${naam}` ingevuld. */
function media3Versions(source: string): string[] {
  const defs = gradleDefs(source);
  const out: string[] = [];
  for (const m of source.matchAll(/["']androidx\.media3:[\w-]+:([^"']+)["']/g)) {
    out.push(m[1]!.replace(/\$\{(\w+)\}|\$(\w+)/g, (whole, a, b) => defs.get(a ?? b) ?? whole));
  }
  return out;
}

describe("Media3 in de module is de versie van expo-video (A15)", () => {
  it("beide build.gradle-bestanden bestaan", () => {
    expect(existsSync(MODULE_GRADLE)).toBe(true);
    expect(existsSync(EXPO_VIDEO_GRADLE)).toBe(true);
  });

  it("expo-video noemt zijn Media3-versie in `androidxMedia3Version`", () => {
    const version = gradleDefs(readFileSync(EXPO_VIDEO_GRADLE, "utf8")).get("androidxMedia3Version");
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("elke Media3-afhankelijkheid van de module heeft die versie", () => {
    const expoVersion = gradleDefs(readFileSync(EXPO_VIDEO_GRADLE, "utf8")).get("androidxMedia3Version");
    const moduleVersions = media3Versions(readFileSync(MODULE_GRADLE, "utf8"));
    expect(moduleVersions.length).toBeGreaterThan(0);
    for (const version of moduleVersions) expect(version).toBe(expoVersion);
  });
});
