import { ConvexError } from "convex/values";
import type { Confirmation, Day } from "./groupAdmin";
import { queuedStand, ownOriginalStand, type OwnStand, type QueueEntry } from "./originalQueue";
import type { NetworkView } from "./originalUpload";
import { MONTHS, dutchOffset } from "./photos";

// WP38c: de pure delen van de schermen van het filmproject. Spec:
// docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38c
// (invarianten 38c-1 tot 38c-13, 38c-20), §Besluiten Wouter na A van 38c.
//
// - Besluit 27 (vervangt besluit 3, A-invariant 17): alles naar het gekozen
//   album; met een open project in die groep gaat ook het origineel mee, met
//   één regel boven de knop en de schakelaar (`addTargets`, `roundTargets`).
// - Een project heeft een titel (besluit 27.3), geen album.
// - Wie wat ziet: de knop en de balk in de groep (`groupFilmView`), de delen
//   van de projectpagina en de downloadpagina (`projectPageView`).
// - De lijsten: "Mijn filmpjes" met de stand uit de wachtrij van 38b, ook voor
//   een origineel dat nog niet is aangemeld (`mineRows`); "Alle filmpjes"
//   (`allRows`); de downloadpagina in de volgorde van de bestandsnamen.
// - Datums in Nederlandse tijd, los van de tijdzone van het toestel (op
//   reis). Een opnamedatum is de kloktijd van de camera, zonder omrekening
//   (zoals bij foto's, src/lib/photos.ts). Grootte decimaal, zoals iOS.
// - Een weigering geeft een eigen tekst per code, nooit de tekst van de fout.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Zelfde grens als de backend (convex/lib/constants.ts, FILM_PROJECT_MAX_AHEAD_MS). */
const FILM_PROJECT_MAX_AHEAD_MS = 366 * DAY;

export type Platform = "ios" | "web";

// --- besluit 27: het toevoegscherm ----------------------------------------------------

export type OpenFilmProject = { groupId: string; projectId: string; title: string };
export type ChosenAlbumRef = { albumId: string; groupId: string; name: string };

export type AddTargets =
  | { ready: false }
  | {
      ready: true;
      /** Het gekozen album: daar gaan foto's en filmpjes heen. */
      albumId: string | null;
      /** Het open project van de groep van dat album, als er filmpjes meegaan. */
      projectId: string | null;
      /** De regel boven de knop (besluit 27.4). */
      lines: string[];
      wifiSwitch: boolean;
    };

function videosText(n: number): string {
  return n === 1 ? "1 filmpje" : `${n} filmpjes`;
}

function projectOf(groupId: string, openProjects: readonly OpenFilmProject[]): OpenFilmProject | undefined {
  return openProjects.find((p) => p.groupId === groupId);
}

/**
 * Besluit 27 (vervangt besluit 3 en A-invariant 17): alles gaat naar het
 * gekozen album, geen splitsen. Staat er in die groep een project open en gaan
 * er filmpjes mee (`videos`: een te lang filmpje telt niet), dan gaat van elk
 * filmpje ook het origineel mee: één regel boven de knop en de schakelaar,
 * alleen met de uploader (`originals`). Met filmpjes en uploader wacht de knop
 * tot de open projecten geladen zijn; anders gaat het origineel stil niet mee.
 */
export function addTargets(input: {
  photos: number;
  videos: number;
  album: ChosenAlbumRef | null;
  openProjects: readonly OpenFilmProject[] | undefined;
  originals: boolean;
}): AddTargets {
  const { videos, album, openProjects, originals } = input;
  if (videos > 0 && originals && openProjects === undefined) return { ready: false };
  if (!album) return { ready: true, albumId: null, projectId: null, lines: [], wifiSwitch: false };
  const project = videos > 0 && openProjects ? projectOf(album.groupId, openProjects) : undefined;
  if (!project) return { ready: true, albumId: album.albumId, projectId: null, lines: [], wifiSwitch: false };
  const line = `${videosText(videos)} ${videos === 1 ? "wordt" : "worden"} ook als origineel bewaard voor filmproject ${project.title}`;
  return {
    ready: true,
    albumId: album.albumId,
    projectId: project.projectId,
    lines: originals ? [line] : [],
    wifiSwitch: originals,
  };
}

export type RoundTargets =
  | { ready: false }
  | {
      ready: true;
      albumId: string | null;
      projectId: string | null;
      /** Er komt een uitkomst voor de filmpjes: elk filmpje in de keuze, ook een te lang (WP37 A12). */
      videoResult: boolean;
      tooLong: number;
    };

/**
 * 38c fix-cyclus 1, punt 1, met besluit 27: de doelen van een ronde. Album en
 * project zijn die van `addTargets` met de filmpjes die meegaan (`videos`); een
 * te lang filmpje (`tooLong`) gaat nergens heen, maar krijgt wel een uitkomst
 * ("niet gelukt: te lang"), ook als er geen ander filmpje is.
 */
export function roundTargets(input: {
  photos: number;
  videos: number;
  tooLong: number;
  album: ChosenAlbumRef | null;
  openProjects: readonly OpenFilmProject[] | undefined;
  originals: boolean;
}): RoundTargets {
  const t = addTargets({
    photos: input.photos,
    videos: input.videos,
    album: input.album,
    openProjects: input.openProjects,
    originals: input.originals,
  });
  if (!t.ready) return { ready: false };
  return {
    ready: true,
    albumId: t.albumId,
    projectId: t.projectId,
    videoResult: input.videos + input.tooLong > 0,
    tooLong: input.tooLong,
  };
}

// --- als het origineel niet meegaat (38c-13) -----------------------------------------

export type SkipReason = "te_klein" | "te_groot" | "geen_ruimte" | "fout";

const SKIP_ORDER: readonly SkipReason[] = ["te_klein", "te_groot", "geen_ruimte", "fout"];

function skipLine(reason: SkipReason, n: number): string {
  const one = n === 1;
  switch (reason) {
    case "te_klein":
      return `${videosText(n)} ${one ? "is" : "zijn"} te klein voor de clubfilm; ${one ? "het origineel gaat" : "de originelen gaan"} niet mee.`;
    case "te_groot":
      return `${videosText(n)} ${one ? "is" : "zijn"} te groot voor de clubfilm; ${one ? "het origineel gaat" : "de originelen gaan"} niet mee.`;
    case "geen_ruimte":
      return `Te weinig ruimte op je iPhone voor de volle kwaliteit van ${videosText(n)}; ${one ? "dat gaat" : "die gaan"} niet mee naar de clubfilm.`;
    case "fout":
      return `De volle kwaliteit van ${videosText(n)} kon niet mee naar de clubfilm.`;
  }
}

/** Eén regel per reden, met het aantal filmpjes. */
export function originalSkipLines(reasons: readonly SkipReason[]): string[] {
  return SKIP_ORDER.map((r) => [r, reasons.filter((x) => x === r).length] as const)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => skipLine(r, n));
}

// --- datums en grootte (38c-10, 38c-11) --------------------------------------------------

const SHORT_MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function utcDay(ms: number): Day {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function sameDay(a: Day, b: Day): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function addDays(day: Day, n: number): Day {
  return utcDay(Date.UTC(day.year, day.month - 1, day.day + n));
}

/** De dag in Nederland van een tijdstip. */
export function dutchDayOf(ms: number): Day {
  return utcDay(ms + dutchOffset(ms));
}

/**
 * Het einde van een dag in Nederland (23:59:59,999), ook op de dag van een
 * wissel van zomertijd. Die wissel is om 02:00 of 03:00 Nederlandse tijd,
 * dus middernacht ligt altijd in één regime.
 */
export function endOfDutchDay(day: Day): number {
  const nextMidnightUtc = Date.UTC(day.year, day.month - 1, day.day + 1);
  return nextMidnightUtc - dutchOffset(nextMidnightUtc - HOUR) - 1;
}

/** Te kiezen: vandaag (in Nederland) tot de laatste dag waarvan het einde binnen de grens van de backend valt. */
export function endDayRange(now: number): { first: Day; last: Day } {
  const limit = now + FILM_PROJECT_MAX_AHEAD_MS;
  let last = dutchDayOf(limit);
  if (endOfDutchDay(last) > limit) last = addDays(last, -1);
  return { first: dutchDayOf(now), last };
}

function dayMonth(day: Day, now: number): string {
  const base = `${day.day} ${MONTHS[day.month - 1]}`;
  return day.year === dutchDayOf(now).year ? base : `${base} ${day.year}`;
}

function shortDay(day: Day, now: number): string {
  const base = `${day.day} ${SHORT_MONTHS[day.month - 1]}`;
  return day.year === dutchDayOf(now).year ? base : `${base} ${day.year}`;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Inzenden: "Vandaag 14:12", "Gisteren 19:03", anders "21 nov 19:03" (met het jaar als het niet dit jaar is). */
export function submittedText(ms: number, now: number): string {
  const day = dutchDayOf(ms);
  const today = dutchDayOf(now);
  const time = clock(ms + dutchOffset(ms));
  if (sameDay(day, today)) return `Vandaag ${time}`;
  if (sameDay(day, addDays(today, -1))) return `Gisteren ${time}`;
  return `${shortDay(day, now)} ${time}`;
}

/** "Ingestuurd 22 nov · opgenomen 20 nov"; de opname als kloktijd van de camera. */
export function originalMetaText(o: { submittedAt: number; takenAt: number | null }, now: number): string {
  const sent = `Ingestuurd ${shortDay(dutchDayOf(o.submittedAt), now)}`;
  return o.takenAt === null ? sent : `${sent} · opgenomen ${shortDay(utcDay(o.takenAt), now)}`;
}

/** De opname met tijd ("18 nov 16:40"), als kloktijd van de camera; zonder opname `null`. */
export function takenText(takenAt: number | null, now: number): string | null {
  return takenAt === null ? null : `${shortDay(utcDay(takenAt), now)} ${clock(takenAt)}`;
}

/** De dag van inzenden in Nederlandse tijd ("20 nov"). */
export function submittedDayText(submittedAt: number, now: number): string {
  return shortDay(dutchDayOf(submittedAt), now);
}

/** Decimaal, zoals iOS: "410 MB", "1,2 GB". */
export function formatBytes(bytes: number): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (b < 999_500) return `${Math.round(b / 1000)} kB`;
  const mb = Math.round(b / 1e6);
  if (mb < 1000) return `${mb} MB`;
  return `${(b / 1e9).toFixed(1).replace(".", ",")} GB`;
}

// --- de groep: de knop en de balk (38c-3, 38c-20) ---------------------------------------

export type ProjectRow = { projectId: string; title: string; endsAt: number; open: boolean };

/** "Filmproject [titel]" (besluit 27). */
export function projectTitle(title: string): string {
  return `Filmproject ${title}`;
}

/** "Open tot 30 november" (met het jaar als het niet dit jaar is), of "Gesloten". */
export function projectStatusText(project: { open: boolean; endsAt: number }, now: number): string {
  return project.open ? `Open tot ${dayMonth(dutchDayOf(project.endsAt), now)}` : "Gesloten";
}

/** Besluit 1 na A: herkenbaar alleen voor de oprichter. */
export const START_BUTTON: { title: string; icon: "key"; accessibilityLabel: string } = {
  title: "Filmproject starten",
  icon: "key",
  accessibilityLabel: "Filmproject starten, alleen voor de oprichter",
};

/**
 * De knop "Filmproject starten": oprichter, in de app, de projecten geladen en
 * geen open project. Een balk per project, het open project eerst.
 */
export function groupFilmView(input: {
  platform: Platform;
  isFounder: boolean;
  projects: readonly ProjectRow[] | undefined;
  now: number;
}): { start: boolean; banners: { projectId: string; title: string; text: string }[] } {
  const { platform, isFounder, projects, now } = input;
  if (projects === undefined) return { start: false, banners: [] };
  const isOpen = (p: ProjectRow) => p.open && now < p.endsAt;
  const ordered = [...projects.filter(isOpen), ...projects.filter((p) => !isOpen(p))];
  return {
    start: platform === "ios" && isFounder && !projects.some(isOpen),
    banners: ordered.map((p) => ({
      projectId: p.projectId,
      title: projectTitle(p.title),
      text: projectStatusText({ open: isOpen(p), endsAt: p.endsAt }, now),
    })),
  };
}

// --- de projectpagina (38c-4 tot 38c-8) ---------------------------------------------------

/** Een rij uit `filmProjects.get`. */
export type ProjectOriginal = {
  originalId: string;
  ownerName: string;
  mine: boolean;
  status: "onderweg" | "binnen";
  durationMs: number;
  submittedAt: number;
  takenAt: number | null;
  bytes: number;
  goneAt: number;
};

export function projectPageView(input: {
  platform: Platform;
  uploader: boolean;
  isFounder: boolean;
  open: boolean;
  originals: readonly ProjectOriginal[];
}): {
  wifiSwitch: boolean;
  close: boolean;
  changeEnd: boolean;
  /** Besluit 27 (Wouter: ja): de titel wijzigen, ook na sluiten. */
  changeTitle: boolean;
  downloadHint: boolean;
  download: boolean;
  removeAll: boolean;
  count: number;
  underway: number | null;
} {
  const { platform, uploader, isFounder, open, originals } = input;
  const app = platform === "ios";
  return {
    wifiSwitch: app && uploader,
    close: app && isFounder && open,
    changeEnd: app && isFounder && open,
    changeTitle: app && isFounder,
    downloadHint: app && isFounder,
    download: !app && isFounder,
    removeAll: !app && isFounder && !open && originals.length > 0,
    count: originals.filter((o) => o.status === "binnen").length,
    underway: isFounder ? originals.filter((o) => o.status === "onderweg").length : null,
  };
}

/** De stand van een eigen filmpje; "onderweg" op het web en zonder uploader. */
export type MineStand = OwnStand | "onderweg";

const STAND_TEXT: Record<MineStand, string> = {
  binnen: "Binnen",
  wordt_verstuurd: "Wordt verstuurd",
  wacht_op_wifi: "Wacht op wifi",
  wacht: "Later opnieuw",
  elders: "Niet op dit toestel",
  onderweg: "Onderweg",
};

export function standText(stand: MineStand): string {
  return STAND_TEXT[stand];
}

export type MineRow = {
  key: string;
  originalId: string | null;
  stand: MineStand;
  bytes: number | null;
  durationMs: number | null;
  submittedAt: number;
  canWithdraw: boolean;
};

/**
 * "Mijn filmpjes": de eigen inzendingen, plus (in de app met uploader) de
 * originelen in de wachtrij van dit toestel voor dit project en deze user die
 * nog geen inzending hebben. `device` is `null` op het web en zonder uploader.
 * Het nieuwste eerst.
 */
export function mineRows(input: {
  platform: Platform;
  projectId: string;
  originals: readonly ProjectOriginal[];
  device: { userId: string; queue: readonly QueueEntry[]; wifiOnly: boolean; network: NetworkView } | null;
  now: number;
}): MineRow[] {
  const { platform, projectId, originals, now } = input;
  const device = platform === "ios" ? input.device : null;
  const rows: MineRow[] = originals
    .filter((o) => o.mine)
    .map((o) => ({
      key: o.originalId,
      originalId: o.originalId,
      stand: device
        ? ownOriginalStand({
            status: o.status,
            originalId: o.originalId,
            queue: device.queue,
            wifiOnly: device.wifiOnly,
            network: device.network,
            now,
          })
        : o.status,
      bytes: o.bytes,
      durationMs: o.durationMs,
      submittedAt: o.submittedAt,
      canWithdraw: platform === "ios",
    }));
  if (device) {
    for (const e of device.queue) {
      if (e.userId !== device.userId || e.projectId !== projectId || e.originalId !== null) continue;
      rows.push({
        key: e.key,
        originalId: null,
        stand: queuedStand(e, { wifiOnly: device.wifiOnly, network: device.network, now }),
        bytes: e.bytes,
        durationMs: null,
        submittedAt: e.addedAt,
        canWithdraw: false,
      });
    }
  }
  return rows.sort((a, b) => b.submittedAt - a.submittedAt);
}

/** "Alle filmpjes": alleen wat binnen is, het nieuwste eerst; eigen inzendingen heten "Jij". */
export function allRows(
  originals: readonly ProjectOriginal[],
): { originalId: string; name: string; durationMs: number; submittedAt: number; takenAt: number | null }[] {
  return originals
    .filter((o) => o.status === "binnen")
    .sort((a, b) => b.submittedAt - a.submittedAt)
    .map((o) => ({
      originalId: o.originalId,
      name: o.mine ? "Jij" : o.ownerName,
      durationMs: o.durationMs,
      submittedAt: o.submittedAt,
      takenAt: o.takenAt,
    }));
}

// --- de downloadpagina (38c-9) -------------------------------------------------------------

/** Waarop de bestandsnaam (38a, `originalFilename`) begint: de opname, anders het inzenden in Nederlandse tijd. */
function filenameMoment(o: ProjectOriginal): number {
  return o.takenAt ?? o.submittedAt + dutchOffset(o.submittedAt);
}

/** Alle inzendingen die de oprichter ziet, in de volgorde van de bestandsnamen; alleen wat binnen is, is te downloaden. */
export function downloadRows(originals: readonly ProjectOriginal[]): (ProjectOriginal & { canDownload: boolean })[] {
  return [...originals]
    .sort(
      (a, b) =>
        filenameMoment(a) - filenameMoment(b) ||
        a.submittedAt - b.submittedAt ||
        (a.originalId < b.originalId ? -1 : a.originalId > b.originalId ? 1 : 0),
    )
    .map((o) => ({ ...o, canDownload: o.status === "binnen" }));
}

/** "Alles downloaden": wat binnen is, in de volgorde van de lijst. */
export function downloadAllIds(originals: readonly ProjectOriginal[]): string[] {
  return downloadRows(originals)
    .filter((o) => o.canDownload)
    .map((o) => o.originalId);
}

/** Per rij van de downloadpagina: "weg op …", of onderweg "Onderweg · weg op …" (fix-cyclus 1, punt 2). */
export function downloadStatusText(original: ProjectOriginal, now: number): string {
  const gone = goneText(original.goneAt, now);
  return original.status === "binnen" ? gone : `Onderweg · ${gone}`;
}

/**
 * "Alles downloaden" (fix-cyclus 1, punt 3): na elkaar, met een pauze tussen
 * twee downloads. `download` geeft `null` als het lukte, anders de tekst voor
 * die rij; gooit hij, dan de algemene tekst. De rest gaat altijd door. Geeft
 * per mislukte rij de tekst.
 */
export async function downloadAll(
  ids: readonly string[],
  download: (id: string) => Promise<string | null>,
  pause: () => Promise<void>,
): Promise<Map<string, string>> {
  const errors = new Map<string, string>();
  for (const [i, id] of ids.entries()) {
    if (i > 0) await pause();
    try {
      const failed = await download(id);
      if (failed !== null) errors.set(id, failed);
    } catch {
      errors.set(id, GENERIC);
    }
  }
  return errors;
}

/** "weg op 30 november 2027" (het jaar alleen als het niet dit jaar is). */
export function goneText(goneAt: number, now: number): string {
  return `weg op ${dayMonth(dutchDayOf(goneAt), now)}`;
}

/** De kop van de downloadpagina (mockup 5). Aantal, grootte en "weg op" tellen alleen wat binnen is. */
export function downloadHeaderText(
  project: { open: boolean; endsAt: number; closedAt: number | null },
  originals: readonly ProjectOriginal[],
  now: number,
): string {
  const head = project.open
    ? projectStatusText(project, now)
    : project.closedAt === null
      ? "Gesloten"
      : `Gesloten op ${dayMonth(dutchDayOf(project.closedAt), now)}`;
  const received = originals.filter((o) => o.status === "binnen");
  if (received.length === 0) return `${head} · nog geen originelen`;
  const count = received.length === 1 ? "1 origineel" : `${received.length} originelen`;
  const bytes = received.reduce((sum, o) => sum + o.bytes, 0);
  const firstGone = Math.min(...received.map((o) => o.goneAt));
  return `${head} · ${count} · ${formatBytes(bytes)} · ${goneText(firstGone, now)}`;
}

// --- bevestigingen en weigeringen (38c-8, 38c-12) ------------------------------------------

export const WITHDRAW_CONFIRMATION: Confirmation = {
  title: "Origineel terugtrekken?",
  message:
    "Het origineel gaat uit het filmproject. Dit filmpje kan daarna niet opnieuw naar een clubfilm, ook niet later. Het filmpje blijft in het album.",
  button: "Terugtrekken",
  destructive: true,
};

export function closeConfirmation(title: string): Confirmation {
  return {
    title: "Filmproject sluiten?",
    message: `Van nieuwe filmpjes gaat daarna geen origineel meer naar filmproject ${title}. Wat al onderweg is, mag nog 14 dagen binnenkomen. De projectpagina blijft er tot de originelen weg zijn.`,
    button: "Sluiten",
    destructive: false,
  };
}

export function removeAllConfirmation(count: number): Confirmation {
  const one = count === 1;
  return {
    title: "Alle originelen verwijderen?",
    message: one
      ? "1 origineel gaat weg, ook als het nog onderweg is. Dat filmpje kan daarna niet opnieuw naar een clubfilm. Het filmpje blijft in het album."
      : `${count} originelen gaan weg, ook wat nog onderweg is. Die filmpjes kunnen daarna niet opnieuw naar een clubfilm. De filmpjes blijven in het album.`,
    button: "Alles verwijderen",
    destructive: true,
  };
}

export type FilmAction = "start" | "close" | "changeEnd" | "changeTitle" | "withdraw" | "download" | "removeAll";

const GENERIC = "Dat lukte niet. Er is niets veranderd. Controleer je verbinding en probeer het opnieuw.";

function codeOf(error: unknown): string | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return null;
  const code: unknown = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** Alleen de code telt, nooit de tekst van de fout ("Server Error", R2_CONFIG_MISSING, een link). */
export function filmRefusalText(error: unknown, action: FilmAction): string {
  switch (codeOf(error)) {
    case "PROJECT_ALREADY_OPEN":
      return "Er staat al een filmproject open in deze groep.";
    case "DATE_INVALID":
      return "Deze datum kan niet. Kies een dag van vandaag tot over een jaar.";
    case "NOT_ALLOWED":
      return "Dat kan alleen de oprichter van de groep.";
    case "PROJECT_CLOSED":
      return "Dit filmproject is al gesloten.";
    // Besluit 27: de titel van een project (de regels van een albumnaam).
    case "NAME_REQUIRED":
      return "Vul een titel in.";
    case "NAME_TOO_LONG":
      return "De titel is te lang. Gebruik hoogstens 50 tekens.";
    case "NAME_INVALID":
      return "De titel bevat een teken dat niet mag, zoals een tab of een onzichtbaar teken. Haal dat weg en probeer het opnieuw.";
    case "NOT_MEMBER":
      return action === "start"
        ? "Je bent geen lid meer van deze groep, of de groep bestaat niet meer."
        : "Dit filmproject is er niet meer, of je bent geen lid meer van de groep.";
    case "ORIGINAL_NOT_FOUND":
      return "Dit origineel is er niet meer.";
    default:
      return GENERIC;
  }
}
