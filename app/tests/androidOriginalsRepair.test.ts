import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { standText } from "../src/lib/filmProject";
import {
  WAIT_MS,
  addOriginal,
  applyEvent,
  atLaunch,
  nextCall,
  ownOriginalStand,
  type Effect,
  type NativeJobView,
  type QueueEntry,
  type QueueEvent,
  type StartResult,
} from "../src/lib/originalQueue";
import { partFailure, type NetworkView } from "../src/lib/originalUpload";

// WP42c herstelronde (na audit en red-team), het deel dat de grens tussen de
// uploader op Android en de app raakt. Spec: docs/work-packages/WP42-android.md
// §Herstelronde 42c, §Tests herstelronde (A).
//
// Op de achtergrond draait er geen JS (42c, S3): de uploader beslist zelf, en
// de app hoort de afloop via `onPartFailed` of bij de start via de stand van
// de uploader (`atLaunch`). Twee nieuwe uitkomsten van de uploader, met een
// eigen `code` in die melding (R2 gebruikt CamelCase, deze niet):
//   - H1 `te_traag`: Android stopte de taak van een deel herhaaldelijk op de
//     tijdslimiet per taak. De app wacht (een uur, dan opnieuw aanmelden) en
//     het lid ziet "Later opnieuw"; niet dezelfde link meteen opnieuw, want
//     dan loopt het weer eindeloos.
//   - K1 `link_verlopen`: de link van het deel is (bijna) verlopen; de
//     uploader begint er niet aan. De app meldt opnieuw aan, zoals na een 403.
// Op iOS komen deze codes niet voor; daar verandert niets (invariant 7).
//
// Daarnaast bewakers op de Kotlin-kant (het gedrag zelf toont de gate, zie de
// spec): de tijdslimiet herkennen, de twee codes, en bewaren dat een
// stroomuitval overleeft (K5).

const MiB = 1024 * 1024;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 27, 12, 0, 0);
const U = "user-1";
const BYTES = 291 * MiB; // 10 delen van 32 MiB

/** De codes in `onPartFailed` en in de stand van de uploader (testcontract, A). */
const TE_TRAAG = "te_traag";
const LINK_VERLOPEN = "link_verlopen";
/** Ruim boven PART_ATTEMPTS (5): ook dan geen `later` maar nieuwe links. */
const PART_ATTEMPTS_PLUS = 9;

// --- de wachtrij (zelfde opzet als originalQueue.test.ts) ---------------------------

function upload(originalId: string): StartResult {
  return {
    kind: "upload",
    originalId,
    partSize: 32 * MiB,
    parts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ partNumber: n, url: `https://r2.invalid/${originalId}?partNumber=${n}` })),
    expiresAt: T0 + 7 * DAY,
  };
}

/** Een origineel waarvan de delen bij de uploader zijn, met de generatie van die links. */
function sending(): { queue: QueueEntry[]; generation: number } {
  let queue = addOriginal([], { key: "k1", userId: U, projectId: "p1", fileName: "k1.mp4", bytes: BYTES }, T0);
  queue = applyEvent(queue, { kind: "album_klaar", key: "k1", photoId: "photo-k1" }, T0).queue;
  const step = applyEvent(queue, { kind: "aangemeld", key: "k1", result: upload("o1") }, T0);
  const send = step.effects.find((e): e is Extract<Effect, { kind: "aan_ios" }> => e.kind === "aan_ios");
  if (!send) throw new Error("geen aan_ios na aangemeld");
  return { queue: step.queue, generation: send.generation };
}

function failed(generation: number, code: string, attempts: number): QueueEvent {
  return { kind: "deel_mislukt", originalId: "o1", generation, partNumber: 4, status: null, code, attempts };
}

function jobWith(generation: number, code: string, attempts: number): NativeJobView {
  return {
    originalId: "o1",
    generation,
    parts: [
      { partNumber: 1, state: "klaar", status: 200, code: null, attempts: 0 },
      { partNumber: 2, state: "klaar", status: 200, code: null, attempts: 0 },
      { partNumber: 3, state: "klaar", status: 200, code: null, attempts: 0 },
      { partNumber: 4, state: "mislukt", status: null, code, attempts },
      { partNumber: 5, state: "wacht", status: null, code: null, attempts: 0 },
    ],
  };
}

const ctx = (now: number) => ({ now, userId: U });
const wifi: NetworkView = { type: "wifi", expensive: false };
const stand = (queue: QueueEntry[], now: number) =>
  ownOriginalStand({ status: "onderweg", originalId: "o1", queue, wifiOnly: true, network: wifi, now });

// --- de Kotlin-kant ----------------------------------------------------------------

const ANDROID_SRC = fileURLToPath(new URL("../modules/clubalmanac-video/android/src/", import.meta.url));

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

/** De broncode van de module zonder commentaar: een uitleg telt niet als code. */
const kotlinCode = () =>
  filesUnder(ANDROID_SRC)
    .filter((f) => /\.(kt|java)$/.test(f))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

/** Zonder de hele broncode in de melding als het misgaat. */
const inKotlin = (pattern: RegExp | string): boolean =>
  typeof pattern === "string" ? kotlinCode().includes(pattern) : pattern.test(kotlinCode());

// --- H1 --------------------------------------------------------------------------------

describe("H1: een trage verbinding loopt niet eindeloos", () => {
  it("te traag: later, hoe weinig pogingen er ook waren (niet dezelfde link opnieuw)", () => {
    for (const attempts of [0, 1, 2, 4]) {
      expect(partFailure({ status: null, code: TE_TRAAG, attempts }), `${attempts}`).toBe("later");
    }
  });

  it("de app hoort het terwijl hij draait: geen opnieuw bij de uploader, een uur wachten, het lid ziet 'Later opnieuw'", () => {
    const { queue, generation } = sending();
    const { queue: q, effects } = applyEvent(queue, failed(generation, TE_TRAAG, 1), T0);
    expect(effects).toEqual([]);
    expect(stand(q, T0)).toBe("wacht");
    expect(standText(stand(q, T0))).toBe("Later opnieuw");
    expect(nextCall(q, ctx(T0 + WAIT_MS.later - 1))).toBeNull();
    expect(nextCall(q, ctx(T0 + WAIT_MS.later))).toMatchObject({ kind: "start", key: "k1" });
  });

  it("de app was dicht: bij de start hetzelfde (geen opnieuw, een uur wachten, 'Later opnieuw')", () => {
    const { queue, generation } = sending();
    const now = T0 + 3 * HOUR;
    const r = atLaunch(queue, { jobs: [jobWith(generation, TE_TRAAG, 1)], files: ["k1.mp4"] }, now);
    expect(r.effects).toEqual([]);
    expect(stand(r.queue, now)).toBe("wacht");
    expect(nextCall(r.queue, ctx(now + WAIT_MS.later - 1))).toBeNull();
    expect(nextCall(r.queue, ctx(now + WAIT_MS.later))).toMatchObject({ kind: "start", key: "k1" });
  });

  it("bewaker: de uploader herkent een stop op de tijdslimiet van Android", () => {
    expect(inKotlin(/\bSTOP_REASON_TIMEOUT\b/), "STOP_REASON_TIMEOUT in de Kotlin-code").toBe(true);
  });

  it("bewaker: de uploader meldt zo'n deel met de code te_traag", () => {
    expect(inKotlin(`"${TE_TRAAG}"`), `"${TE_TRAAG}" in de Kotlin-code`).toBe(true);
  });
});

// --- K1 --------------------------------------------------------------------------------

describe("K1: geen deel beginnen met een (bijna) verlopen link", () => {
  it("link verlopen: opnieuw aanmelden, zoals na een 403", () => {
    for (const attempts of [0, 1, PART_ATTEMPTS_PLUS]) {
      expect(partFailure({ status: null, code: LINK_VERLOPEN, attempts }), `${attempts}`).toBe("opnieuw_aanmelden");
    }
  });

  it("de app hoort het terwijl hij draait: meteen nieuwe links, niet dezelfde link opnieuw", () => {
    const { queue, generation } = sending();
    const { queue: q, effects } = applyEvent(queue, failed(generation, LINK_VERLOPEN, 0), T0);
    expect(effects).toEqual([]);
    expect(nextCall(q, ctx(T0))).toEqual({ kind: "start", key: "k1", photoId: "photo-k1", bytes: BYTES });
  });

  it("de app was dicht: bij de start meteen nieuwe links", () => {
    const { queue, generation } = sending();
    // Voor de app gelden de links nog ruim (geen eigen reden om aan te melden):
    // alleen de melding van de uploader zet het in gang.
    const now = T0 + 2 * HOUR;
    const r = atLaunch(queue, { jobs: [jobWith(generation, LINK_VERLOPEN, 0)], files: ["k1.mp4"] }, now);
    expect(r.effects).toEqual([]);
    expect(nextCall(r.queue, ctx(now))).toEqual({ kind: "start", key: "k1", photoId: "photo-k1", bytes: BYTES });
  });

  it("bewaker: de uploader meldt zo'n deel met de code link_verlopen", () => {
    expect(inKotlin(`"${LINK_VERLOPEN}"`), `"${LINK_VERLOPEN}" in de Kotlin-code`).toBe(true);
  });
});

// --- K5 --------------------------------------------------------------------------------

describe("K5: de opslag van de uploader overleeft stroomuitval", () => {
  it("bewaker: wat de uploader bewaart, staat op schijf voordat het de oude versie vervangt (fsync of AtomicFile)", () => {
    expect(
      inKotlin(/\.sync\s*\(\s*\)|\bfsync\s*\(|\.force\s*\(\s*true\s*\)|\bAtomicFile\b/),
      "fsync (FileDescriptor.sync, FileChannel.force) of AtomicFile in de Kotlin-code",
    ).toBe(true);
  });
});
