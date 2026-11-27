import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { projectEmptyText } from "../src/lib/filmProject";

// WP42c — originelen insturen op Android (WP38 op Android).
//   - A27, A34: de Android-kant van `clubalmanac-video` krijgt de uploader. De
//     runner (src/data/originals.ts) en de schermen van 38c zijn dezelfde als
//     op iOS; Android geeft dus dezelfde functies en events aan JS.
//   - A33 (B15): versturen zonder foreground service, zonder melding in beeld
//     en zonder door de gebruiker gestarte overdracht (UIDT). Ook geen
//     expedited werk: dat is onder Android 12 een foreground service.
//   - A34: het filmproject op Android is dat van de iPhone met uploader (42a
//     A11 vervalt); de lege stand belooft dat nieuwe filmpjes als origineel
//     meegaan, afhankelijk van de uploader en niet van het platform.
// Spec: docs/work-packages/WP42-android.md §Spec-criticus aanvullingen 42c.

const MODULE_DIR = fileURLToPath(new URL("../modules/clubalmanac-video/", import.meta.url));
const ANDROID_SRC = join(MODULE_DIR, "android", "src");
const APP_JSON = fileURLToPath(new URL("../app.json", import.meta.url));
const SCREENS = fileURLToPath(new URL("../src/screens/", import.meta.url));

/** De functies van filmpjes (WP37, 42b). */
const VIDEO_FUNCTIONS = ["readMetadata", "compress", "cancel", "makePoster", "remove"];

/**
 * De uploader zoals de runner en het toevoegscherm hem gebruiken: het type
 * `Originals` in modules/clubalmanac-video/index.ts. Niet de twee functies
 * voor gate 6 van iOS (`uploaderExitAfterBackgroundSend`, `…Set…`).
 */
const UPLOADER_FUNCTIONS = [
  "keepOriginal",
  "originalInfo",
  "removeOriginal",
  "listOriginals",
  "originalSha256",
  "freeBytes",
  "partsBytes",
  "networkStatus",
  "readState",
  "writeState",
  "uploaderSend",
  "uploaderRetryPart",
  "uploaderForget",
  "uploaderJobs",
  "uploaderWifiOnly",
  "uploaderSetWifiOnly",
  "uploaderNote",
  "uploaderLog",
  "uploaderClearLog",
  "backgroundWorkBegin",
  "backgroundWorkEnd",
];

/** De events waar de runner naar luistert (`listenUploader`). */
const UPLOADER_EVENTS = ["onPartDone", "onPartFailed", "onAllPartsDone", "onFileBroken", "onNetwork"];

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

/** Alleen de broncode van de module, niet wat Gradle in `android/build` zet. */
const kotlinText = () =>
  filesUnder(ANDROID_SRC)
    .filter((f) => /\.(kt|java)$/.test(f))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

/** Zonder commentaar, zodat een uitleg over wat er níet gebruikt wordt niet telt. */
const kotlinCode = () => kotlinText().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

function exportedNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/\b(?:Async)?Function\s*\(\s*"([A-Za-z0-9_]+)"/g)) names.add(m[1]!);
  return names;
}

function declaredEvents(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/\bEvents\s*\(([^)]*)\)/g)) {
    for (const e of m[1]!.matchAll(/"([A-Za-z0-9_]+)"/g)) names.add(e[1]!);
  }
  return names;
}

describe("A27: de JS-kant met een Android-module mét uploader", () => {
  it("filmpjes en originelen kunnen; de runner hoort de events", async () => {
    vi.resetModules();
    const listeners: string[] = [];
    const native: Record<string, unknown> = {
      addListener: (name: string) => {
        listeners.push(name);
        return { remove: () => {} };
      },
    };
    for (const name of [...VIDEO_FUNCTIONS, ...UPLOADER_FUNCTIONS]) native[name] = async () => null;
    vi.doMock("expo", () => ({ requireOptionalNativeModule: () => native }));
    const video = await import("../modules/clubalmanac-video");
    expect(video.videoModuleAvailable).toBe(true);
    expect(video.originalUploaderAvailable).toBe(true);
    const stop = video.listenUploader({
      partDone: () => {},
      partFailed: () => {},
      allPartsDone: () => {},
      fileBroken: () => {},
      network: () => {},
    });
    stop();
    expect(listeners.sort()).toEqual([...UPLOADER_EVENTS].sort());
    // Gate 6 van iOS hoeft Android niet te kunnen.
    await expect(video.uploaderExitAfterBackgroundSend()).resolves.toBeNull();
    vi.doUnmock("expo");
  });
});

describe("A27: de Kotlin-kant geeft de uploader", () => {
  it("elke functie van de uploader die de runner en het toevoegscherm gebruiken", () => {
    const names = exportedNames(kotlinText());
    for (const name of [...VIDEO_FUNCTIONS, ...UPLOADER_FUNCTIONS]) expect(names, name).toContain(name);
  });

  it("de events van de uploader, naast die van het verkleinen", () => {
    const events = declaredEvents(kotlinText());
    for (const name of ["onProgress", ...UPLOADER_EVENTS]) expect(events, name).toContain(name);
  });
});

describe("A33 (B15): geen foreground service, geen melding, geen UIDT", () => {
  it("de Kotlin-kant start geen foreground service en geen UIDT- of expedited werk", () => {
    const code = kotlinCode();
    for (const forbidden of [
      /\bsetForeground(?:Async)?\s*\(/,
      /\bstartForeground(?:Service)?\s*\(/,
      /\bForegroundInfo\b/,
      /\bsetUserInitiated\s*\(/,
      /\bsetExpedited\s*\(/,
      /\bNotificationManager(?:Compat)?\b/,
    ]) {
      expect(code, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("app.json vraagt geen recht voor een dienst, een melding of UIDT, en blokkeert de foreground service", () => {
    const app = JSON.parse(readFileSync(APP_JSON, "utf8")) as {
      expo: { android: { permissions?: string[]; blockedPermissions?: string[] } };
    };
    const asked = app.expo.android.permissions ?? [];
    for (const p of [
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.RUN_USER_INITIATED_JOBS",
      "android.permission.READ_MEDIA_VIDEO",
    ]) {
      expect(asked, p).not.toContain(p);
    }
    const blocked = app.expo.android.blockedPermissions ?? [];
    expect(blocked).toContain("android.permission.FOREGROUND_SERVICE");
    expect(blocked).toContain("android.permission.FOREGROUND_SERVICE_DATA_SYNC");
  });
});

describe("A34: de lege stand van de projectpagina hangt aan de uploader, niet aan het platform", () => {
  const PROMISE = "Nieuwe filmpjes in deze groep gaan ook als origineel mee.";
  const NEUTRAL = "Er is nog geen filmpje binnengekomen.";

  it("open, in de app met uploader (iPhone en Android): de belofte", () => {
    expect(projectEmptyText({ open: true, platform: "ios", uploader: true })).toBe(PROMISE);
  });

  it("open, in de app zonder uploader (een oude Android-build): niets beloven", () => {
    expect(projectEmptyText({ open: true, platform: "ios", uploader: false })).toBe(NEUTRAL);
  });

  it("open, in de webapp: zoals nu (de belofte)", () => {
    expect(projectEmptyText({ open: true, platform: "web", uploader: false })).toBe(PROMISE);
  });

  it("gesloten: overal neutraal", () => {
    for (const platform of ["ios", "web"] as const) {
      for (const uploader of [true, false]) {
        expect(projectEmptyText({ open: false, platform, uploader }), `${platform} ${uploader}`).toBe(NEUTRAL);
      }
    }
  });

  it("de projectpagina gebruikt de functie en kijkt niet meer naar Android", () => {
    const text = readFileSync(join(SCREENS, "FilmProjectScreens.tsx"), "utf8");
    expect(text).toMatch(/\bprojectEmptyText\s*\(/);
    expect(text).not.toContain(PROMISE);
    expect(text).not.toMatch(/Platform\.OS\s*(?:!==|===)\s*"android"/);
  });
});
