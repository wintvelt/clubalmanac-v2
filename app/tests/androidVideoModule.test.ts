import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// WP42b — de module `clubalmanac-video` krijgt een Android-kant (open vraag 5).
//   - Een build met alleen de functies van filmpjes (verkleinen, poster,
//     metadata, stoppen, wissen): `videoModuleAvailable` waar,
//     `originalUploaderAvailable` onwaar; de onderdelen van de originelen
//     blijven stil.
//   - De module meldt zich ook voor Android aan; de Kotlin-kant definieert de
//     vijf functies van filmpjes.
//   - WP42c: de Android-kant krijgt ook de uploader (A21 van 42b vervalt); dat
//     staat in androidOriginals.test.ts.
//   - Geen rechten voor een achtergronddienst of de hele galerij (42a A9):
//     app.json blokkeert ze, en de module vraagt ze niet.
// Spec: docs/work-packages/WP42-android.md §Spec-criticus aanvullingen 42b.

const MODULE_DIR = fileURLToPath(new URL("../modules/clubalmanac-video/", import.meta.url));
const APP_JSON = fileURLToPath(new URL("../app.json", import.meta.url));

/** De functies van filmpjes (WP37) die Android nodig heeft. */
const VIDEO_FUNCTIONS = ["readMetadata", "compress", "cancel", "makePoster", "remove"];

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

const ANDROID_DIR = join(MODULE_DIR, "android");
const kotlin = () => filesUnder(ANDROID_DIR).filter((f) => /\.(kt|java)$/.test(f));
const kotlinText = () => kotlin().map((f) => readFileSync(f, "utf8")).join("\n");

/** Namen die de module als functie aan JS geeft: `Function("x")` en `AsyncFunction("x")`. */
function exportedNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/\b(?:Async)?Function\s*\(\s*"([A-Za-z0-9_]+)"/g)) names.add(m[1]!);
  return names;
}

describe("de JS-kant met een module zonder uploader (een build van 42b)", () => {
  it("filmpjes kunnen, originelen niet", async () => {
    vi.resetModules();
    const listeners: string[] = [];
    const native: Record<string, unknown> = {
      addListener: (name: string) => {
        listeners.push(name);
        return { remove: () => {} };
      },
    };
    for (const name of VIDEO_FUNCTIONS) native[name] = async () => null;
    vi.doMock("expo", () => ({ requireOptionalNativeModule: () => native }));
    const video = await import("../modules/clubalmanac-video");
    expect(video.videoModuleAvailable).toBe(true);
    expect(video.originalUploaderAvailable).toBe(false);
    expect(() => video.keepOriginal("file:///x.mp4")).toThrow();
    const stop = video.listenUploader({ partDone: () => {}, network: () => {} });
    stop();
    expect(listeners).toEqual([]);
    await expect(video.uploaderExitAfterBackgroundSend()).resolves.toBeNull();
    vi.doUnmock("expo");
  });
});

describe("de module meldt zich ook voor Android aan (open vraag 5)", () => {
  it("expo-module.config.json noemt android met een module", () => {
    const config = JSON.parse(readFileSync(join(MODULE_DIR, "expo-module.config.json"), "utf8")) as {
      platforms?: string[];
      android?: { modules?: string[] };
    };
    expect(config.platforms).toContain("android");
    expect(config.platforms).toContain("apple");
    expect(config.android?.modules?.length ?? 0).toBeGreaterThan(0);
  });

  it("de Kotlin-kant heet ClubalmanacVideo en geeft de vijf functies van filmpjes", () => {
    expect(kotlin().length, "geen Kotlin onder modules/clubalmanac-video/android").toBeGreaterThan(0);
    const text = kotlinText();
    expect(text).toMatch(/Name\s*\(\s*"ClubalmanacVideo"\s*\)/);
    const names = exportedNames(text);
    for (const name of VIDEO_FUNCTIONS) expect(names, name).toContain(name);
  });

});

describe("geen achtergronddienst en geen toegang tot de hele galerij (42a A9, B12)", () => {
  it("app.json blokkeert de rechten nog steeds", () => {
    const app = JSON.parse(readFileSync(APP_JSON, "utf8")) as {
      expo: { android: { permissions?: string[]; blockedPermissions?: string[] } };
    };
    const blocked = app.expo.android.blockedPermissions ?? [];
    for (const p of [
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
    ]) {
      expect(blocked, p).toContain(p);
    }
    // WP42c B19: RECEIVE_BOOT_COMPLETED mag erbij (WorkManager); verder niets.
    const asked = app.expo.android.permissions ?? [];
    expect(asked).toContain("android.permission.ACCESS_MEDIA_LOCATION");
    for (const p of asked) {
      expect(["android.permission.ACCESS_MEDIA_LOCATION", "android.permission.RECEIVE_BOOT_COMPLETED"], p).toContain(p);
    }
  });

  it("het manifest van de module vraagt geen rechten", () => {
    for (const file of filesUnder(ANDROID_DIR).filter((f) => f.endsWith("AndroidManifest.xml"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/uses-permission|<service/);
    }
  });
});
