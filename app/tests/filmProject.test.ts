import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it } from "vitest";
import { FILM_PROJECT_MAX_AHEAD_MS } from "../../convex/lib/constants";
import {
  FOUNDER_BUTTONS,
  WITHDRAW_CONFIRMATION,
  addTargets,
  allRows,
  closeConfirmation,
  downloadAll,
  downloadAllIds,
  downloadHeaderText,
  downloadRows,
  downloadStatusText,
  dutchDayOf,
  endDayRange,
  endOfDutchDay,
  filmRefusalText,
  formatBytes,
  goneText,
  groupFilmView,
  mineRows,
  originalMetaText,
  originalSkipLines,
  projectPageView,
  projectStatusText,
  projectTitle,
  removeAllConfirmation,
  roundTargets,
  standText,
  submittedText,
  type ChosenAlbumRef,
  type OpenFilmProject,
  type ProjectOriginal,
  type ProjectRow,
} from "../src/lib/filmProject";
import { AA_LARGE_OR_UI, contrastRatio, relativeLuminance } from "../src/lib/contrast";
import type { Day } from "../src/lib/groupAdmin";
import { colors } from "../src/theme/tokens";
import { addOriginal, applyEvent, type QueueEntry, type QueueEvent } from "../src/lib/originalQueue";
import type { NetworkView } from "../src/lib/originalUpload";

// WP38c — de schermen van het filmproject, de pure delen.
//   - Besluit 3 (A-invariant 17, 38c-1, 38c-2): waar foto's en filmpjes heen
//     gaan, welk album de rij toont, de regels boven de knop, de schakelaar,
//     en welk album in het kiesscherm grijs is.
//   - Wie wat ziet (38c-3, 38c-4): de knop "Filmproject starten", de balk, en
//     per platform en rol de delen van de projectpagina en de downloadpagina.
//   - De lijsten (38c-5, 38c-6, 38c-9): "Alle filmpjes" alleen binnen;
//     "Mijn filmpjes" met de stand uit de wachtrij van 38b, ook voor wat nog
//     niet is aangemeld; de downloadpagina in de volgorde van de bestandsnamen.
//   - Teksten (38c-7, 38c-8, 38c-10, 38c-12, 38c-13): stand, data, grootte,
//     bevestigingen, weigeringen, en de melding als het origineel niet meegaat.
//   - De einddatum (38c-11): het einde van een dag in Nederland, ook bij een
//     wissel van zomertijd, en nooit later dan de grens van de backend.
// Datums in Nederlandse tijd, onafhankelijk van de tijdzone van het toestel;
// een opnamedatum is de kloktijd van de camera (zoals bij foto's).
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38c.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

// 25 november 2026, 12:00 in Nederland (winter: UTC+1).
const NOW = Date.UTC(2026, 10, 25, 11, 0);

// --- besluit 27: alles naar het gekozen album ----------------------------------------------

// Besluit 27 (Wouter, 2026-11-25, na build 89; vervangt besluit 3 en
// A-invariant 17): foto's en filmpjes gaan naar het album dat het lid kiest.
// Geen splitsen, geen grijs album. Staat er in de groep van dat album een
// project open, dan gaat van elk filmpje dat meegaat ook het origineel mee
// (alleen met de uploader), met één regel boven de knop.
// Groep G heeft een open project "Reis 2026"; X en Y zijn albums van G.
// Groep H heeft geen project. Groep K heeft een eigen project "Weekend".
const X: ChosenAlbumRef = { albumId: "ax", groupId: "g", name: "Georgië" };
const Y: ChosenAlbumRef = { albumId: "ay", groupId: "g", name: "Dag 3" };
const H: ChosenAlbumRef = { albumId: "ah", groupId: "h", name: "Diner" };
const YK: ChosenAlbumRef = { albumId: "ayk", groupId: "k", name: "Zondag" };
const PROJECTS: OpenFilmProject[] = [
  { groupId: "g", projectId: "pg", title: "Reis 2026" },
  { groupId: "k", projectId: "pk", title: "Weekend" },
];

const targets = (photos: number, videos: number, album: ChosenAlbumRef | null, extra: { openProjects?: readonly OpenFilmProject[] | undefined; originals?: boolean } = {}) =>
  addTargets({
    photos,
    videos,
    album,
    openProjects: "openProjects" in extra ? extra.openProjects : PROJECTS,
    originals: extra.originals ?? true,
  });

function ready(t: ReturnType<typeof addTargets>) {
  if (!t.ready) throw new Error("verwacht: ready");
  return t;
}

/** Besluit 27.4: "1 filmpje wordt ook …" / "[n] filmpjes worden ook …". */
function originalLine(n: number, title: string): string {
  return n === 1
    ? `1 filmpje wordt ook als origineel bewaard voor filmproject ${title}`
    : `${n} filmpjes worden ook als origineel bewaard voor filmproject ${title}`;
}

describe("addTargets: alles naar het gekozen album (besluit 27)", () => {
  it.each([
    ["alleen foto's", 3, 0],
    ["alleen filmpjes", 0, 2],
    ["foto's en filmpjes", 3, 2],
  ] as const)("%s naar Y: alles naar Y", (_name, photos, videos) => {
    expect(ready(targets(photos, videos, Y)).albumId).toBe("ay");
  });

  it("ook naar X of naar een album van een groep zonder project: het gekozen album", () => {
    expect(ready(targets(3, 2, X)).albumId).toBe("ax");
    expect(ready(targets(3, 2, H)).albumId).toBe("ah");
    expect(ready(targets(0, 1, YK)).albumId).toBe("ayk");
  });

  it("nog geen album: nergens heen, geen regel, geen schakelaar", () => {
    expect(ready(targets(3, 2, null))).toEqual({ ready: true, albumId: null, projectId: null, lines: [], wifiSwitch: false });
  });

  it("geen splitsen meer: het antwoord kent geen eigen album voor foto's of filmpjes", () => {
    const t = ready(targets(3, 2, Y));
    expect(t).not.toHaveProperty("split");
    expect(t).not.toHaveProperty("videoAlbumId");
    expect(t).not.toHaveProperty("photoAlbumId");
  });
});

describe("addTargets: het origineel en de regel boven de knop (besluit 27.2, 27.4)", () => {
  it("filmpjes naar een album van een groep met een project: het project, de regel en de schakelaar", () => {
    for (const album of [X, Y]) {
      expect(ready(targets(0, 2, album))).toEqual({ ready: true, albumId: album.albumId, projectId: "pg", lines: [originalLine(2, "Reis 2026")], wifiSwitch: true });
    }
  });

  it("enkelvoud en meervoud; met foto's erbij dezelfde ene regel", () => {
    expect(ready(targets(0, 1, Y)).lines).toEqual([originalLine(1, "Reis 2026")]);
    expect(ready(targets(3, 1, Y)).lines).toEqual([originalLine(1, "Reis 2026")]);
    expect(ready(targets(3, 5, Y)).lines).toEqual([originalLine(5, "Reis 2026")]);
  });

  it("de titel van het project van de eigen groep", () => {
    expect(ready(targets(0, 2, YK))).toMatchObject({ projectId: "pk", lines: [originalLine(2, "Weekend")] });
  });

  it("alleen foto's, of alleen te lange filmpjes (videos 0): geen project, geen regel, geen schakelaar", () => {
    expect(ready(targets(3, 0, Y))).toEqual({ ready: true, albumId: "ay", projectId: null, lines: [], wifiSwitch: false });
  });

  it("een groep zonder project: geen regel", () => {
    expect(ready(targets(3, 2, H))).toEqual({ ready: true, albumId: "ah", projectId: null, lines: [], wifiSwitch: false });
    expect(ready(targets(0, 2, Y, { openProjects: [] }))).toMatchObject({ projectId: null, lines: [] });
  });

  it("zonder uploader (web, oude build): geen regel en geen schakelaar", () => {
    expect(ready(targets(3, 2, Y, { originals: false }))).toMatchObject({ albumId: "ay", lines: [], wifiSwitch: false });
  });

  it("open projecten nog niet geladen, met filmpjes en uploader: nog niet klaar (anders gaat het origineel stil niet mee)", () => {
    expect(targets(0, 2, Y, { openProjects: undefined })).toEqual({ ready: false });
    expect(targets(3, 2, H, { openProjects: undefined })).toEqual({ ready: false });
  });

  it("nog niet geladen, maar alleen foto's of geen uploader: wel klaar", () => {
    expect(ready(targets(3, 0, Y, { openProjects: undefined }))).toMatchObject({ albumId: "ay", lines: [] });
    expect(ready(targets(0, 2, Y, { openProjects: undefined, originals: false }))).toMatchObject({ albumId: "ay", lines: [] });
  });
});

// 38c fix-cyclus 1, punt 1 (regressie op WP37 A12), met besluit 27: elk
// filmpje in de keuze krijgt een uitkomst, ook een te lang filmpje dat niet
// meegaat. `videos` telt de filmpjes die meegaan, `tooLong` de te lange;
// `videoResult` zegt of de ronde van de filmpjes er is. Album en project zijn
// die van `addTargets` met alleen de filmpjes die meegaan.
describe("roundTargets: de doelen van de ronde, ook met te lange filmpjes (fix-cyclus 1, punt 1)", () => {
  const round = (photos: number, videos: number, tooLong: number, album: ChosenAlbumRef | null, extra: { openProjects?: readonly OpenFilmProject[] | undefined } = {}) =>
    roundTargets({ photos, videos, tooLong, album, openProjects: "openProjects" in extra ? extra.openProjects : PROJECTS, originals: true });

  function readyRound(r: ReturnType<typeof roundTargets>) {
    if (!r.ready) throw new Error("verwacht: ready");
    return r;
  }

  it("alleen te lange filmpjes: het gekozen album, geen project, wel een uitkomst voor de filmpjes", () => {
    expect(readyRound(round(0, 0, 2, Y))).toEqual({ ready: true, albumId: "ay", projectId: null, videoResult: true, tooLong: 2 });
  });

  it("alleen te lange filmpjes, ook als de open projecten nog laden: klaar", () => {
    expect(readyRound(round(0, 0, 1, Y, { openProjects: undefined }))).toMatchObject({ videoResult: true, tooLong: 1 });
  });

  it("foto's met een te lang filmpje: naar Y, en een uitkomst voor het filmpje", () => {
    expect(readyRound(round(3, 0, 1, Y))).toEqual({ ready: true, albumId: "ay", projectId: null, videoResult: true, tooLong: 1 });
  });

  it("een te lang filmpje naast een goed filmpje, met een open project: het project, beide een uitkomst", () => {
    expect(readyRound(round(0, 1, 1, Y))).toEqual({ ready: true, albumId: "ay", projectId: "pg", videoResult: true, tooLong: 1 });
  });

  it("goede filmpjes met open projecten die nog laden: nog niet klaar", () => {
    expect(round(0, 1, 1, Y, { openProjects: undefined })).toEqual({ ready: false });
  });

  it("alleen foto's: geen ronde voor filmpjes", () => {
    expect(readyRound(round(3, 0, 0, Y))).toMatchObject({ albumId: "ay", projectId: null, videoResult: false, tooLong: 0 });
  });

  it.each([
    [3, 2, 0, Y],
    [3, 2, 1, Y],
    [0, 2, 3, X],
    [3, 0, 2, H],
    [1, 1, 1, YK],
  ] as const)("album en project zijn die van addTargets (%i foto's, %i goed, %i te lang)", (photos, videos, tooLong, album) => {
    const r = readyRound(round(photos, videos, tooLong, album));
    const t = ready(targets(photos, videos, album));
    expect({ albumId: r.albumId, projectId: r.projectId }).toEqual({ albumId: t.albumId, projectId: t.projectId });
    expect(r.videoResult).toBe(videos + tooLong > 0);
  });
});

describe("originalSkipLines: als het origineel niet meegaat (38c-13)", () => {
  it("niets: geen regel", () => {
    expect(originalSkipLines([])).toEqual([]);
  });

  it("één regel per reden, met het aantal", () => {
    const lines = originalSkipLines(["te_groot", "te_klein", "te_groot"]);
    expect(lines).toHaveLength(2);
    const groot = lines.find((l) => l.includes("te groot"));
    const klein = lines.find((l) => l.includes("te klein"));
    expect(groot).toContain("2 filmpjes");
    expect(klein).toContain("1 filmpje");
    expect(klein).not.toContain("1 filmpjes");
  });

  it("geen ruimte en een andere mislukking hebben elk een eigen regel", () => {
    const lines = originalSkipLines(["geen_ruimte", "fout"]);
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.includes("ruimte"))).toBe(true);
    expect(new Set(lines).size).toBe(2);
  });

  it("elke regel noemt de feature-film, nooit de clubfilm (feedback na besluit 27, punt 3)", () => {
    for (const r of ["te_klein", "te_groot", "geen_ruimte", "fout"] as const) {
      for (const n of [1, 2]) {
        const [line] = originalSkipLines(Array.from({ length: n }, () => r));
        expect(line, `${r} ${n}`).toContain("feature-film");
        expect(line!.toLowerCase(), `${r} ${n}`).not.toContain("clubfilm");
      }
    }
  });
});

// --- groep en projectpagina: wie wat ziet ---------------------------------------------

const END = endOfDutchDay({ year: 2026, month: 11, day: 30 });
// Besluit 27: een project heeft een titel.
const openRow: ProjectRow = { projectId: "p-open", title: "Reis 2026", endsAt: END, open: true };
const closedRow: ProjectRow = { projectId: "p-dicht", title: "Zomer 2026", endsAt: Date.UTC(2026, 7, 31, 21, 59, 59, 999), open: false };

describe("groupFilmView: de knop en de balk (38c-3)", () => {
  const view = (platform: "ios" | "web", isFounder: boolean, projects: readonly ProjectRow[] | undefined) =>
    groupFilmView({ platform, isFounder, projects, now: NOW });

  it("oprichter in de app, geen project: de knop, geen balk", () => {
    expect(view("ios", true, [])).toEqual({ start: true, banners: [] });
  });

  it("oprichter in de app, een open project: geen knop, de balk 'Filmproject [titel]', 'Open tot [dag maand]'", () => {
    expect(view("ios", true, [openRow])).toEqual({
      start: false,
      banners: [{ projectId: "p-open", title: "Filmproject Reis 2026", text: "Open tot 30 november" }],
    });
  });

  it("alleen een gesloten project met originelen: de balk zegt 'Gesloten', en de oprichter kan een nieuw starten", () => {
    const v = view("ios", true, [closedRow]);
    expect(v.start).toBe(true);
    expect(v.banners).toEqual([{ projectId: "p-dicht", title: "Filmproject Zomer 2026", text: "Gesloten" }]);
  });

  it("het open project eerst", () => {
    expect(view("ios", false, [closedRow, openRow]).banners.map((b) => b.projectId)).toEqual(["p-open", "p-dicht"]);
  });

  it("een lid of admin: nooit de knop; de balk wel", () => {
    expect(view("ios", false, [])).toEqual({ start: false, banners: [] });
    expect(view("ios", false, [openRow]).banners).toHaveLength(1);
  });

  it("op het web: nooit de knop, ook niet voor de oprichter; de balk wel", () => {
    expect(view("web", true, []).start).toBe(false);
    expect(view("web", true, [openRow]).banners).toHaveLength(1);
  });

  it("nog niet geladen: geen knop en geen balk", () => {
    expect(view("ios", true, undefined)).toEqual({ start: false, banners: [] });
  });

  it("projectTitle: 'Filmproject [titel]'", () => {
    expect(projectTitle("Reis 2026")).toBe("Filmproject Reis 2026");
  });
});

const orig = (id: string, extra: Partial<ProjectOriginal> = {}): ProjectOriginal => ({
  originalId: id,
  ownerName: "Lid " + id,
  mine: false,
  status: "binnen",
  durationMs: 75_000,
  submittedAt: NOW - DAY,
  takenAt: null,
  bytes: 820_000_000,
  goneAt: NOW + 360 * DAY,
  ...extra,
});

describe("projectPageView: wie wat ziet op de projectpagina (38c-4)", () => {
  const originals = [
    orig("a", { status: "binnen" }),
    orig("b", { status: "onderweg" }),
    orig("c", { status: "onderweg", mine: true }),
    orig("d", { status: "binnen", mine: true }),
  ];
  const view = (platform: "ios" | "web", isFounder: boolean, open: boolean, uploader = true, list = originals) =>
    projectPageView({ platform, uploader, isFounder, open, originals: list });

  it("lid in de app: schakelaar; geen sluiten, verschuiven, downloaden of verwijderen", () => {
    expect(view("ios", false, true)).toEqual({
      wifiSwitch: true,
      close: false,
      changeEnd: false,
      changeTitle: false,
      downloadHint: false,
      download: false,
      removeAll: false,
      count: 2,
      underway: null,
    });
  });

  it("oprichter in de app, open: sluiten, verschuiven, 'Downloaden kan in de webapp', en hoeveel er onderweg zijn", () => {
    expect(view("ios", true, true)).toEqual({
      wifiSwitch: true,
      close: true,
      changeEnd: true,
      changeTitle: true,
      downloadHint: true,
      download: false,
      removeAll: false,
      count: 2,
      underway: 2,
    });
  });

  it("oprichter in de app, gesloten: niet sluiten of verschuiven", () => {
    expect(view("ios", true, false)).toMatchObject({ close: false, changeEnd: false, downloadHint: true });
  });

  it("de titel wijzigen (besluit 27, Wouter: ja): de oprichter, in de app en op het web, ook na sluiten; niet een lid", () => {
    expect(view("ios", true, true).changeTitle).toBe(true);
    expect(view("ios", true, false).changeTitle).toBe(true);
    expect(view("ios", false, true).changeTitle).toBe(false);
    // Feedback webapp dev, tweede ronde, punt 1: ook op de downloadpagina.
    expect(view("web", true, true).changeTitle).toBe(true);
    expect(view("web", true, false).changeTitle).toBe(true);
    expect(view("web", false, true).changeTitle).toBe(false);
  });

  it("zonder uploader: geen schakelaar", () => {
    expect(view("ios", false, true, false).wifiSwitch).toBe(false);
  });

  it("lid op het web: alleen bekijken", () => {
    expect(view("web", false, true)).toMatchObject({
      wifiSwitch: false,
      close: false,
      changeEnd: false,
      changeTitle: false,
      downloadHint: false,
      download: false,
      removeAll: false,
      underway: null,
    });
  });

  // Feedback Wouter, webapp dev (2026-11-25, tweede ronde), punt 1: op de
  // downloadpagina ook Sluiten (alleen open), Titel wijzigen en Einddatum
  // wijzigen (alleen open, zoals setEndsAt), met de knoppen van de oprichter.
  it("oprichter op het web, open: de downloadpagina met sluiten, titel en einddatum wijzigen; geen schakelaar", () => {
    expect(view("web", true, true)).toMatchObject({ download: true, close: true, changeEnd: true, changeTitle: true, wifiSwitch: false, downloadHint: false });
  });

  it("oprichter op het web, gesloten: niet sluiten of de einddatum wijzigen, wel de titel", () => {
    expect(view("web", true, false)).toMatchObject({ download: true, close: false, changeEnd: false, changeTitle: true });
  });

  it("'Alles verwijderen': oprichter, web, gesloten, en er is iets (open vraag 5)", () => {
    expect(view("web", true, false).removeAll).toBe(true);
    expect(view("web", true, true).removeAll).toBe(false);
    expect(view("web", true, false, true, []).removeAll).toBe(false);
    expect(view("ios", true, false).removeAll).toBe(false);
    expect(view("web", false, false).removeAll).toBe(false);
  });

  it("het aantal in de kop telt alleen wat binnen is", () => {
    expect(view("ios", false, true, true, [orig("a"), orig("b", { status: "onderweg", mine: true })]).count).toBe(1);
    expect(view("ios", true, true, true, []).count).toBe(0);
    expect(view("ios", true, true, true, []).underway).toBe(0);
  });
});

describe("allRows: 'Alle filmpjes' (38c-5)", () => {
  it("alleen wat binnen is, het nieuwste eerst; eigen inzendingen heten 'Jij'", () => {
    const rows = allRows([
      orig("oud", { submittedAt: NOW - 3 * DAY, ownerName: "Bob" }),
      orig("weg", { status: "onderweg", submittedAt: NOW - HOUR }),
      orig("mijn", { mine: true, ownerName: "Wie ook", submittedAt: NOW - DAY, takenAt: Date.UTC(2026, 10, 23, 18, 0) }),
      orig("nieuw", { submittedAt: NOW - 2 * HOUR, ownerName: "Carol" }),
    ]);
    expect(rows.map((r) => r.originalId)).toEqual(["nieuw", "mijn", "oud"]);
    expect(rows.map((r) => r.name)).toEqual(["Carol", "Jij", "Bob"]);
    expect(rows[1]).toMatchObject({ durationMs: 75_000, submittedAt: NOW - DAY, takenAt: Date.UTC(2026, 10, 23, 18, 0) });
  });
});

// --- Mijn filmpjes: met de wachtrij van 38b --------------------------------------------

const U = "user-1";
const WIFI: NetworkView = { type: "wifi", expensive: false };
const MOBIEL: NetworkView = { type: "mobiel", expensive: true };
const BYTES = 410 * 1000 * 1000;

function step(queue: QueueEntry[], events: QueueEvent[], now = NOW): QueueEntry[] {
  let q = queue;
  for (const e of events) q = applyEvent(q, e, now).queue;
  return q;
}

function queued(key: string, projectId = "p1", now = NOW, userId = U): QueueEntry[] {
  return addOriginal([], { key, userId, projectId, fileName: `${key}.mov`, bytes: BYTES }, now);
}

/** Aangemeld, de delen bij iOS (stap versturen). */
function sending(key: string, originalId: string, projectId = "p1", now = NOW): QueueEntry[] {
  return step(queued(key, projectId, now), [
    { kind: "album_klaar", key, photoId: `photo-${key}` },
    {
      kind: "aangemeld",
      key,
      result: { kind: "upload", originalId, partSize: 32 * MiB, parts: [{ partNumber: 1, url: "https://r2.invalid/1" }], expiresAt: now + 7 * DAY },
    },
  ], now);
}

describe("mineRows: 'Mijn filmpjes' (38c-6)", () => {
  const device = (queue: QueueEntry[], network = WIFI, wifiOnly = true) => ({ userId: U, queue, wifiOnly, network });
  const rows = (originals: ProjectOriginal[], dev: ReturnType<typeof device> | null, platform: "ios" | "web" = "ios", now = NOW) =>
    mineRows({ platform, projectId: "p1", originals, device: dev, now });

  it("alleen eigen inzendingen; het nieuwste eerst", () => {
    const r = rows(
      [
        orig("o-oud", { mine: true, submittedAt: NOW - 2 * DAY }),
        orig("o-ander", { mine: false }),
        orig("o-nieuw", { mine: true, submittedAt: NOW - HOUR }),
      ],
      device([]),
    );
    expect(r.map((x) => x.originalId)).toEqual(["o-nieuw", "o-oud"]);
  });

  it("de stand uit de wachtrij: wordt verstuurd op wifi, wacht op wifi op mobiel internet; met de grootte", () => {
    const q = sending("k1", "o1");
    const own = [orig("o1", { mine: true, status: "onderweg", bytes: BYTES })];
    expect(rows(own, device(q))[0]).toMatchObject({ key: "o1", originalId: "o1", stand: "wordt_verstuurd", bytes: BYTES, canWithdraw: true });
    expect(rows(own, device(q, MOBIEL))[0]).toMatchObject({ stand: "wacht_op_wifi", bytes: BYTES });
    expect(rows(own, device(q, MOBIEL, false))[0]!.stand).toBe("wordt_verstuurd");
  });

  it("onderweg maar niet in de wachtrij van dit toestel: elders, met de grootte uit de backend, wel terugtrekken", () => {
    const r = rows([orig("o9", { mine: true, status: "onderweg", bytes: 123_000_000 })], device([]));
    expect(r[0]).toMatchObject({ stand: "elders", bytes: 123_000_000, canWithdraw: true });
  });

  it("binnen: binnen, met de grootte uit de backend, wel terugtrekken", () => {
    const r = rows([orig("o2", { mine: true, status: "binnen", bytes: 77_000_000 })], device([]));
    expect(r[0]).toMatchObject({ stand: "binnen", bytes: 77_000_000, canWithdraw: true });
  });

  it("een origineel in de wachtrij zonder inzending staat er ook, als 'wordt verstuurd', zonder terugtrekken", () => {
    const q = step(queued("k2"), [{ kind: "album_klaar", key: "k2", photoId: "photo-k2" }]);
    const r = rows([], device(q));
    expect(r).toEqual([
      { key: "k2", originalId: null, stand: "wordt_verstuurd", bytes: BYTES, durationMs: null, submittedAt: NOW, canWithdraw: false },
    ]);
  });

  it("ook als het filmpje voor het album nog loopt (stap album)", () => {
    expect(rows([], device(queued("k3")))).toHaveLength(1);
  });

  it("een origineel zonder inzending dat wacht (te_vaak): 'later opnieuw' (wacht), daarna weer wordt verstuurd", () => {
    const q = step(queued("k4"), [
      { kind: "album_klaar", key: "k4", photoId: "photo-k4" },
      { kind: "aangemeld", key: "k4", result: { kind: "geweigerd", reason: "te_vaak" } },
    ]);
    expect(rows([], device(q))[0]!.stand).toBe("wacht");
    expect(rows([], device(q), "ios", NOW + 2 * HOUR)[0]!.stand).toBe("wordt_verstuurd");
  });

  it("de wachtrij van een ander project of een andere user telt niet", () => {
    const other = queued("k5", "p2");
    const otherUser = addOriginal([], { key: "k6", userId: "user-2", projectId: "p1", fileName: "k6.mov", bytes: BYTES }, NOW);
    expect(rows([], device([...other, ...otherUser]))).toEqual([]);
  });

  it("een origineel in de wachtrij met een inzending die (nog) niet in de lijst staat: niet dubbel en niet als los origineel", () => {
    const q = sending("k7", "o7");
    expect(rows([], device(q))).toEqual([]);
    expect(rows([orig("o7", { mine: true, status: "onderweg" })], device(q))).toHaveLength(1);
  });

  it("het nieuwste eerst, ook met een origineel zonder inzending ertussen", () => {
    const q = step(queued("k8", "p1", NOW - 30 * MINUTE), [{ kind: "album_klaar", key: "k8", photoId: "photo-k8" }]);
    const r = rows(
      [orig("o-uur", { mine: true, submittedAt: NOW - HOUR }), orig("o-nu", { mine: true, submittedAt: NOW - MINUTE })],
      device(q),
    );
    expect(r.map((x) => x.key)).toEqual(["o-nu", "k8", "o-uur"]);
  });

  it("zonder uploader in de app: 'onderweg' of 'binnen', terugtrekken wel", () => {
    const r = rows([orig("o1", { mine: true, status: "onderweg" }), orig("o2", { mine: true, status: "binnen", submittedAt: NOW - 2 * DAY })], null);
    expect(r.map((x) => [x.stand, x.canWithdraw])).toEqual([
      ["onderweg", true],
      ["binnen", true],
    ]);
  });

  it("op het web: 'onderweg' of 'binnen', nooit terugtrekken", () => {
    const r = rows([orig("o1", { mine: true, status: "onderweg" }), orig("o2", { mine: true, status: "binnen", submittedAt: NOW - 2 * DAY })], null, "web");
    expect(r.map((x) => [x.stand, x.canWithdraw])).toEqual([
      ["onderweg", false],
      ["binnen", false],
    ]);
  });

  it("de lengte uit de inzending", () => {
    expect(rows([orig("o1", { mine: true, durationMs: 161_000 })], device([]))[0]!.durationMs).toBe(161_000);
  });
});

describe("standText (38c-7)", () => {
  it("de drie uit de mockup", () => {
    expect(standText("binnen")).toBe("Binnen");
    expect(standText("wordt_verstuurd")).toBe("Wordt verstuurd");
    expect(standText("wacht_op_wifi")).toBe("Wacht op wifi");
  });

  it("de andere drie (open vraag 8)", () => {
    expect(standText("wacht")).toBe("Later opnieuw");
    expect(standText("elders")).toBe("Niet op dit toestel");
    expect(standText("onderweg")).toBe("Onderweg");
  });

  it("allemaal verschillend", () => {
    const all = (["binnen", "wordt_verstuurd", "wacht_op_wifi", "wacht", "elders", "onderweg"] as const).map(standText);
    expect(new Set(all).size).toBe(all.length);
  });
});

// --- downloadpagina ----------------------------------------------------------------

describe("downloadRows: de volgorde van de bestandsnamen (38c-9)", () => {
  it("op opnamedatum (kloktijd van de camera), zonder opname op het inzenden in Nederlandse tijd", () => {
    const list = [
      // Ingestuurd 20 nov 11:30 UTC = 12:30 in Nederland; geen opname.
      orig("zonder", { takenAt: null, submittedAt: Date.UTC(2026, 10, 20, 11, 30) }),
      // Opgenomen 20 nov 12:00 op de camera.
      orig("twaalf", { takenAt: Date.UTC(2026, 10, 20, 12, 0), submittedAt: Date.UTC(2026, 10, 22, 9, 0) }),
      orig("vroeg", { takenAt: Date.UTC(2026, 10, 18, 16, 40), submittedAt: Date.UTC(2026, 10, 23, 9, 0) }),
    ];
    expect(downloadRows(list).map((r) => r.originalId)).toEqual(["vroeg", "twaalf", "zonder"]);
  });

  it("alles wat de oprichter ziet staat erin; alleen wat binnen is, is te downloaden", () => {
    const rows = downloadRows([
      orig("a", { takenAt: Date.UTC(2026, 10, 1) }),
      orig("b", { takenAt: Date.UTC(2026, 10, 2), status: "onderweg" }),
    ]);
    expect(rows.map((r) => [r.originalId, r.canDownload])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect(rows[0]).toMatchObject({ ownerName: "Lid a", durationMs: 75_000 });
  });

  it("'Alles downloaden': alleen wat binnen is, in dezelfde volgorde", () => {
    const list = [
      orig("c", { takenAt: Date.UTC(2026, 10, 3) }),
      orig("b", { takenAt: Date.UTC(2026, 10, 2), status: "onderweg" }),
      orig("a", { takenAt: Date.UTC(2026, 10, 1) }),
    ];
    expect(downloadAllIds(list)).toEqual(["a", "c"]);
    expect(downloadAllIds([])).toEqual([]);
  });
});

describe("downloadHeaderText en goneText: de kop van de downloadpagina (besluit 3 na A, mockup 5)", () => {
  const CLOSED_AT = endOfDutchDay({ year: 2026, month: 11, day: 30 });
  const NOW_DEC = Date.UTC(2026, 11, 2, 11, 0);
  const closed = { open: false, endsAt: CLOSED_AT, closedAt: CLOSED_AT };

  it("gesloten: 'Gesloten op [dag] · [n] originelen · [grootte] · weg op [eerste datum]'", () => {
    const list = [
      orig("a", { bytes: 9_000_000_000, goneAt: endOfDutchDay({ year: 2027, month: 12, day: 3 }) }),
      orig("b", { bytes: 5_600_000_000, goneAt: endOfDutchDay({ year: 2027, month: 11, day: 30 }) }),
    ];
    expect(downloadHeaderText(closed, list, NOW_DEC)).toBe("Gesloten op 30 november · 2 originelen · 14,6 GB · weg op 30 november 2027");
  });

  it("telt alleen wat binnen is: aantal, grootte en de eerste datum van weggaan", () => {
    const list = [
      orig("a", { bytes: 1_200_000_000, goneAt: endOfDutchDay({ year: 2027, month: 11, day: 30 }) }),
      orig("b", { status: "onderweg", bytes: 3_000_000_000, goneAt: endOfDutchDay({ year: 2026, month: 12, day: 14 }) }),
    ];
    expect(downloadHeaderText(closed, list, NOW_DEC)).toBe("Gesloten op 30 november · 1 origineel · 1,2 GB · weg op 30 november 2027");
  });

  it("nog niets binnen: alleen de stand en 'nog geen originelen'", () => {
    expect(downloadHeaderText(closed, [orig("b", { status: "onderweg" })], NOW_DEC)).toBe("Gesloten op 30 november · nog geen originelen");
    expect(downloadHeaderText(closed, [], NOW_DEC)).toBe("Gesloten op 30 november · nog geen originelen");
  });

  it("open: 'Open tot …' vooraan", () => {
    const open = { open: true, endsAt: END, closedAt: null };
    expect(downloadHeaderText(open, [orig("a", { bytes: 410_000_000, goneAt: endOfDutchDay({ year: 2027, month: 11, day: 20 }) })], NOW)).toBe(
      "Open tot 30 november · 1 origineel · 410 MB · weg op 20 november 2027",
    );
  });

  it("eerder gesloten dan de einddatum: de datum van sluiten, niet de einddatum", () => {
    const early = { open: false, endsAt: endOfDutchDay({ year: 2026, month: 12, day: 20 }), closedAt: Date.UTC(2026, 10, 27, 15, 0) };
    expect(downloadHeaderText(early, [], NOW_DEC)).toBe("Gesloten op 27 november · nog geen originelen");
  });

  it("gesloten zonder datum (oude stand): alleen 'Gesloten'", () => {
    expect(downloadHeaderText({ open: false, endsAt: END, closedAt: null }, [], NOW_DEC)).toBe("Gesloten · nog geen originelen");
  });

  it("goneText: dit jaar zonder jaar, een ander jaar met het jaar, in Nederlandse tijd", () => {
    expect(goneText(endOfDutchDay({ year: 2026, month: 12, day: 14 }), NOW)).toBe("weg op 14 december");
    expect(goneText(endOfDutchDay({ year: 2027, month: 11, day: 30 }), NOW)).toBe("weg op 30 november 2027");
    // 23:30 UTC in de winter is in Nederland al de volgende dag.
    expect(goneText(Date.UTC(2026, 11, 13, 23, 30), NOW)).toBe("weg op 14 december");
  });
});

// Feedback Wouter na besluit 27, punt 1: elke knop die alleen de oprichter
// heeft, heeft links het icoon van de handeling en achter de tekst een gele
// sleutel (`key`, dat Icon als `key-outline` tekent; de knop zelf zet hem
// erachter, zie filmProjectRoutes.test.ts). Het label noemt "oprichter".
describe("FOUNDER_BUTTONS: de knoppen alleen voor de oprichter (feedback na besluit 27, punt 1)", () => {
  const ACTIONS = ["start", "close", "changeTitle", "changeEnd", "download", "downloadAll", "removeAll"] as const;

  it("precies deze handelingen", () => {
    expect(Object.keys(FOUNDER_BUTTONS).sort()).toEqual([...ACTIONS].sort());
  });

  it.each(ACTIONS)("%s: een tekst, een eigen icoon links (niet de sleutel), en een label met de tekst en 'oprichter'", (action) => {
    const b = FOUNDER_BUTTONS[action];
    expect(b.title.length).toBeGreaterThan(0);
    expect(b.icon).not.toBe("key");
    expect(b.accessibilityLabel).toContain(b.title);
    expect(b.accessibilityLabel).toContain("oprichter");
  });

  it("de teksten en iconen die vastliggen", () => {
    expect(FOUNDER_BUTTONS.start).toMatchObject({ title: "Filmproject starten", icon: "film" });
    expect(FOUNDER_BUTTONS.close.title).toBe("Project sluiten");
    expect(FOUNDER_BUTTONS.download).toMatchObject({ title: "Downloaden", icon: "download" });
    expect(FOUNDER_BUTTONS.downloadAll).toMatchObject({ title: "Alles downloaden", icon: "download" });
    expect(FOUNDER_BUTTONS.removeAll).toMatchObject({ title: "Alles verwijderen", icon: "trash" });
  });

  it("titel en einddatum wijzigen zijn twee knoppen met een eigen tekst", () => {
    expect(FOUNDER_BUTTONS.changeTitle.title).not.toBe(FOUNDER_BUTTONS.changeEnd.title);
  });
});

// De gele sleutel: een eigen kleur `founderKey`, goud, lichter in donker en
// donkerder in licht, met contrast ≥ 3:1 (een icoon dat iets betekent) op de
// achtergrond en op een vlak, in beide thema's.
describe("de kleur van de sleutel (feedback na besluit 27, punt 1)", () => {
  function hue(hex: string): { h: number; s: number } {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return { h: 0, s: 0 };
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s: d / max };
  }

  it.each(["light", "dark"] as const)("%s: ≥ 3:1 op de achtergrond en op een vlak", (scheme) => {
    const c = colors[scheme] as Record<string, string>;
    expect(c.founderKey, "token founderKey").toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrastRatio(c.founderKey!, c.bg!)).toBeGreaterThanOrEqual(AA_LARGE_OR_UI);
    expect(contrastRatio(c.founderKey!, c.surface!)).toBeGreaterThanOrEqual(AA_LARGE_OR_UI);
  });

  it("goud (een gele tint, verzadigd), lichter in donker dan in licht", () => {
    const light = (colors.light as Record<string, string>).founderKey!;
    const dark = (colors.dark as Record<string, string>).founderKey!;
    for (const hex of [light, dark]) {
      const { h, s } = hue(hex);
      expect(h, hex).toBeGreaterThanOrEqual(35);
      expect(h, hex).toBeLessThanOrEqual(60);
      expect(s, hex).toBeGreaterThanOrEqual(0.5);
    }
    expect(relativeLuminance(dark)).toBeGreaterThan(relativeLuminance(light));
  });
});

describe("downloadStatusText: per rij (fix-cyclus 1, punt 2)", () => {
  it("binnen: 'weg op …'; onderweg: 'Onderweg · weg op …'", () => {
    const binnen = orig("a", { goneAt: endOfDutchDay({ year: 2027, month: 11, day: 30 }) });
    const onderweg = orig("b", { status: "onderweg", goneAt: endOfDutchDay({ year: 2026, month: 12, day: 14 }) });
    expect(downloadStatusText(binnen, NOW)).toBe("weg op 30 november 2027");
    expect(downloadStatusText(onderweg, NOW)).toBe("Onderweg · weg op 14 december");
  });
});

describe("downloadAll: 'Alles downloaden' met een fout per rij (fix-cyclus 1, punt 3)", () => {
  it("na elkaar, met een pauze ertussen (niet vooraf), en elke mislukte rij met haar eigen tekst", async () => {
    const calls: string[] = [];
    const errors = await downloadAll(
      ["a", "b", "c", "d"],
      async (id) => {
        calls.push(id);
        return id === "b" ? "fout bij b" : id === "d" ? "fout bij d" : null;
      },
      async () => {
        calls.push("pauze");
      },
    );
    expect(calls).toEqual(["a", "pauze", "b", "pauze", "c", "pauze", "d"]);
    expect([...errors]).toEqual([
      ["b", "fout bij b"],
      ["d", "fout bij d"],
    ]);
  });

  it("alles gelukt: geen fouten; niets te doen: geen aanroep", async () => {
    const ok = await downloadAll(["a", "b"], async () => null, async () => {});
    expect(ok.size).toBe(0);
    let called = false;
    const none = await downloadAll([], async () => ((called = true), null), async () => {});
    expect(none.size).toBe(0);
    expect(called).toBe(false);
  });

  it("een downloader die gooit, telt als een fout bij die rij; de rest gaat door", async () => {
    const seen: string[] = [];
    const errors = await downloadAll(
      ["a", "b", "c"],
      async (id) => {
        seen.push(id);
        if (id === "a") throw new Error("Server Error https://r2.invalid/x?X-Amz-Signature=geheim");
        return null;
      },
      async () => {},
    );
    expect(seen).toEqual(["a", "b", "c"]);
    expect([...errors.keys()]).toEqual(["a"]);
    expect(errors.get("a")).not.toMatch(/Server Error|https?:|Signature/);
    expect((errors.get("a") ?? "").length).toBeGreaterThan(0);
  });
});

// --- datums en grootte -------------------------------------------------------------------

describe("de einddatum (38c-11)", () => {
  it("het einde van een dag in Nederland, winter en zomer", () => {
    expect(endOfDutchDay({ year: 2026, month: 11, day: 30 })).toBe(Date.UTC(2026, 10, 30, 22, 59, 59, 999));
    expect(endOfDutchDay({ year: 2027, month: 7, day: 10 })).toBe(Date.UTC(2027, 6, 10, 21, 59, 59, 999));
  });

  it("op de dagen van de wissel van zomertijd", () => {
    // 29 maart 2026: zomertijd vanaf 01:00 UTC; het einde van de dag is CEST.
    expect(endOfDutchDay({ year: 2026, month: 3, day: 29 })).toBe(Date.UTC(2026, 2, 29, 21, 59, 59, 999));
    // 25 oktober 2026: wintertijd vanaf 01:00 UTC; het einde van de dag is CET.
    expect(endOfDutchDay({ year: 2026, month: 10, day: 25 })).toBe(Date.UTC(2026, 9, 25, 22, 59, 59, 999));
  });

  it("dutchDayOf en endOfDutchDay passen op elkaar", () => {
    for (const d of [
      { year: 2026, month: 1, day: 1 },
      { year: 2026, month: 3, day: 29 },
      { year: 2026, month: 10, day: 25 },
      { year: 2026, month: 12, day: 31 },
      { year: 2028, month: 2, day: 29 },
    ] satisfies Day[]) {
      expect(dutchDayOf(endOfDutchDay(d))).toEqual(d);
    }
  });

  it("dutchDayOf rekent in Nederlandse tijd: 23:30 UTC in de winter is al de volgende dag", () => {
    expect(dutchDayOf(Date.UTC(2026, 10, 24, 23, 30))).toEqual({ year: 2026, month: 11, day: 25 });
    expect(dutchDayOf(Date.UTC(2026, 6, 10, 22, 30))).toEqual({ year: 2026, month: 7, day: 11 });
  });

  it("de eerste dag is vandaag in Nederland, en zijn einde ligt in de toekomst", () => {
    const late = Date.UTC(2026, 10, 25, 22, 59, 0); // 23:59 in Nederland
    expect(endDayRange(late).first).toEqual({ year: 2026, month: 11, day: 25 });
    expect(endOfDutchDay(endDayRange(late).first)).toBeGreaterThan(late);
  });

  it("de laatste dag past altijd binnen de grens van de backend, en de dag erna niet (twee jaar, elk uur)", () => {
    const next = (d: Day): Day => dutchDayOf(endOfDutchDay(d) + HOUR);
    for (let now = Date.UTC(2026, 0, 1, 0, 0, 1); now < Date.UTC(2028, 11, 31); now += HOUR) {
      const { last } = endDayRange(now);
      expect(endOfDutchDay(last), `now ${new Date(now).toISOString()}`).toBeLessThanOrEqual(now + FILM_PROJECT_MAX_AHEAD_MS);
      expect(endOfDutchDay(next(last)), `now ${new Date(now).toISOString()}`).toBeGreaterThan(now + FILM_PROJECT_MAX_AHEAD_MS);
    }
  });

  it("schrikkeljaar en wintertijd: vandaag plus 365 dagen past dan niet", () => {
    // 30 oktober 2027, 00:00:01 in Nederland (zomertijd). 365 dagen later is
    // 29 oktober 2028, al wintertijd: het einde van die dag ligt na de grens.
    const now = Date.UTC(2027, 9, 29, 22, 0, 1);
    expect(endDayRange(now).last).toEqual({ year: 2028, month: 10, day: 28 });
  });
});

describe("projectStatusText: 'Open tot …' in Nederlandse tijd (38c-3, 38c-10)", () => {
  const savedTz = process.env.TZ;
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("open: 'Open tot 30 november'; gesloten: 'Gesloten'", () => {
    expect(projectStatusText({ open: true, endsAt: END }, NOW)).toBe("Open tot 30 november");
    expect(projectStatusText({ open: false, endsAt: END }, NOW)).toBe("Gesloten");
  });

  it("een ander jaar: met het jaar", () => {
    expect(projectStatusText({ open: true, endsAt: endOfDutchDay({ year: 2027, month: 1, day: 15 }) }, NOW)).toBe("Open tot 15 januari 2027");
  });

  it("dezelfde dag, ook als het toestel in een andere tijdzone staat (op reis)", () => {
    for (const tz of ["Asia/Tokyo", "America/New_York", "Pacific/Auckland", "UTC"]) {
      process.env.TZ = tz;
      expect(projectStatusText({ open: true, endsAt: END }, NOW), tz).toBe("Open tot 30 november");
      expect(dutchDayOf(END), tz).toEqual({ year: 2026, month: 11, day: 30 });
    }
  });
});

describe("submittedText en originalMetaText (38c-10)", () => {
  it("vandaag en gisteren in Nederlandse tijd", () => {
    expect(submittedText(Date.UTC(2026, 10, 25, 13, 12), Date.UTC(2026, 10, 25, 15, 0))).toBe("Vandaag 14:12");
    expect(submittedText(Date.UTC(2026, 10, 24, 18, 3), NOW)).toBe("Gisteren 19:03");
  });

  it("net na middernacht in Nederland is 23:30 de avond ervoor 'Gisteren'", () => {
    const now = Date.UTC(2026, 10, 24, 23, 10); // 00:10 op 25 november
    expect(submittedText(Date.UTC(2026, 10, 24, 22, 30), now)).toBe("Gisteren 23:30");
  });

  it("ouder: dag, korte maand en tijd; een ander jaar met het jaar", () => {
    expect(submittedText(Date.UTC(2026, 10, 21, 18, 3), NOW)).toBe("21 nov 19:03");
    expect(submittedText(Date.UTC(2025, 10, 21, 18, 3), NOW)).toBe("21 nov 2025 19:03");
  });

  it("'Ingestuurd … · opgenomen …', de opname als kloktijd van de camera", () => {
    // Opgenomen 20 november 23:30 op de camera: blijft 20 november.
    expect(originalMetaText({ submittedAt: Date.UTC(2026, 10, 22, 9, 0), takenAt: Date.UTC(2026, 10, 20, 23, 30) }, NOW)).toBe(
      "Ingestuurd 22 nov · opgenomen 20 nov",
    );
  });

  it("zonder opname alleen 'Ingestuurd'; een ander jaar met het jaar", () => {
    expect(originalMetaText({ submittedAt: Date.UTC(2026, 10, 21, 9, 0), takenAt: null }, NOW)).toBe("Ingestuurd 21 nov");
    expect(originalMetaText({ submittedAt: Date.UTC(2026, 10, 21, 9, 0), takenAt: Date.UTC(2019, 5, 12, 10, 0) }, NOW)).toBe(
      "Ingestuurd 21 nov · opgenomen 12 jun 2019",
    );
  });

  it("korte maanden: mrt, okt", () => {
    expect(originalMetaText({ submittedAt: Date.UTC(2027, 2, 3, 12, 0), takenAt: Date.UTC(2027, 9, 1, 12, 0) }, Date.UTC(2027, 2, 10))).toBe(
      "Ingestuurd 3 mrt · opgenomen 1 okt",
    );
  });
});

describe("formatBytes: decimaal, zoals iOS (38c-10)", () => {
  it.each([
    [410_000_000, "410 MB"],
    [1_048_576, "1 MB"],
    [999_499_999, "999 MB"],
    [999_999_999, "1,0 GB"],
    [1_200_000_000, "1,2 GB"],
    [14_600_000_000, "14,6 GB"],
    [2 * GiB, "2,1 GB"],
  ])("%d → %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

// --- bevestigingen en weigeringen ---------------------------------------------------------

describe("bevestigingen (38c-8)", () => {
  it("terugtrekken en alles verwijderen noemen de feature-film, nooit de clubfilm (feedback na besluit 27, punt 3)", () => {
    for (const m of [WITHDRAW_CONFIRMATION.message, removeAllConfirmation(1).message, removeAllConfirmation(18).message]) {
      expect(m).toContain("feature-film");
      expect(m.toLowerCase()).not.toContain("clubfilm");
    }
  });

  it("terugtrekken: rood, definitief, het filmpje blijft in het album", () => {
    expect(WITHDRAW_CONFIRMATION.destructive).toBe(true);
    expect(WITHDRAW_CONFIRMATION.button).toBe("Terugtrekken");
    expect(WITHDRAW_CONFIRMATION.message).toContain("niet opnieuw");
    expect(WITHDRAW_CONFIRMATION.message).toContain("album");
  });

  it("alles verwijderen: rood, met het aantal, definitief, de filmpjes blijven in het album", () => {
    const c = removeAllConfirmation(18);
    expect(c.destructive).toBe(true);
    expect(c.message).toContain("18 originelen");
    expect(c.message).toContain("niet opnieuw");
    expect(c.message).toContain("album");
    expect(c.button.toLowerCase()).toContain("verwijderen");
    const one = removeAllConfirmation(1).message;
    expect(one).toContain("1 origineel");
    expect(one).not.toContain("1 originelen");
  });

  it("sluiten: vraagt het, met een knop 'sluiten'", () => {
    const c = closeConfirmation("Reis 2026");
    expect(c.title.toLowerCase()).toContain("sluiten");
    expect(c.button.toLowerCase()).toContain("sluiten");
  });
});

describe("filmRefusalText: weigeringen (38c-12)", () => {
  const err = (code: string) => new ConvexError({ code });

  it("al een project open", () => {
    expect(filmRefusalText(err("PROJECT_ALREADY_OPEN"), "start")).toContain("al een filmproject open");
  });

  it("een datum die niet kan", () => {
    expect(filmRefusalText(err("DATE_INVALID"), "start").toLowerCase()).toContain("datum");
    expect(filmRefusalText(err("DATE_INVALID"), "changeEnd").toLowerCase()).toContain("datum");
  });

  it("niet de oprichter", () => {
    for (const a of ["start", "close", "changeEnd", "changeTitle", "removeAll"] as const) {
      expect(filmRefusalText(err("NOT_ALLOWED"), a), a).toContain("oprichter");
    }
  });

  it.each(["start", "changeTitle"] as const)("%s met een titel die niet kan (besluit 27): over de titel, niet over een naam", (action) => {
    for (const code of ["NAME_REQUIRED", "NAME_TOO_LONG", "NAME_INVALID"]) {
      const text = filmRefusalText(err(code), action);
      expect(text, code).toContain("titel");
      expect(text, code).not.toContain("naam");
    }
    expect(filmRefusalText(err("NAME_TOO_LONG"), action)).toContain("50");
  });

  it("de titel wijzigen: geen lid (meer) of het project is weg", () => {
    expect(filmRefusalText(err("NOT_MEMBER"), "changeTitle")).toContain("lid");
  });

  it("al gesloten", () => {
    expect(filmRefusalText(err("PROJECT_CLOSED"), "changeEnd")).toContain("gesloten");
  });

  it("geen lid (meer), of weg", () => {
    expect(filmRefusalText(err("NOT_MEMBER"), "start")).toContain("lid");
  });

  it("een origineel dat er niet meer is", () => {
    expect(filmRefusalText(err("ORIGINAL_NOT_FOUND"), "withdraw")).toContain("niet meer");
    expect(filmRefusalText(err("ORIGINAL_NOT_FOUND"), "download")).toContain("niet meer");
  });

  it("al het andere: de algemene tekst, nooit de tekst van de fout", () => {
    const generic = filmRefusalText(err("IETS_ANDERS"), "download");
    expect(generic.length).toBeGreaterThan(0);
    for (const e of [
      new Error("[CONVEX A(filmProjects:downloadUrl)] Server Error R2_CONFIG_MISSING: R2_ORIGINALS_BUCKET"),
      new Error("https://r2.invalid/originals/abc?X-Amz-Signature=geheim"),
      "zomaar",
      null,
    ]) {
      const text = filmRefusalText(e, "download");
      expect(text).toBe(generic);
      expect(text).not.toMatch(/Server Error|R2_|https?:|Signature/);
    }
  });
});
