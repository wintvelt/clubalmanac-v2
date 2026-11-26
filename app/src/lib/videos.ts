// WP37: de pure logica van filmpjes in de app. Geen React, geen native
// modules; de schermen, src/data/videoUpload.ts en de module
// modules/clubalmanac-video gebruiken dit.
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §Testcontract.
//
// - Besluit 1: de tegel toont de duur (0:42); een filter Alle/Foto's/Video's,
//   alleen in een album met minstens één filmpje (invariant 10, A-keuze).
// - Besluit 3: het doel van de compressie (`VIDEO_TARGET`).
// - A-keuze: de grens van 3:00 telt afgerond op hele seconden, gelijk aan de
//   backend (convex/lib/constants.ts, `videoTooLong`).
// - A-invariant 14: de datum van een iPhone-filmpje
//   (com.apple.quicktime.creationdate, lokale tijd met tijdzone) gaat als de
//   kloktijd naar de backend, in de vorm van `X-Taken-At` (zoals bij foto's).
// - Invariant 5: per reden een NL-melding, en of opnieuw proberen zin heeft.
// - A-invariant 23: geen filmpje in de schijfcache.

/** A-keuze: 3:00, afgerond op hele seconden (tot 180,499 s mag). */
const MAX_VIDEO_SECONDS = 180;

/** "0:42", "3:00", "10:00": de duur afgerond op hele seconden. */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Langer dan 3:00 zoals de tegel het toont (dezelfde regel als de backend). */
export function videoTooLong(ms: number): boolean {
  return Math.round(ms / 1000) > MAX_VIDEO_SECONDS;
}

/**
 * A-keuze: zo lang mag een filmpje zijn om het te versturen (180,4 s). De
 * backend meet ook de AAC-aanloop van het geluid (~70 ms langer dan wat de app
 * meet, A-invariant 30) en laat tot 180,499 s door: met 100 ms marge komt wat de
 * app verstuurt ook binnen, en een te lang filmpje wordt al vóór het verkleinen
 * en versturen geweigerd.
 */
const MAX_SEND_MS = 180_400;

/** Te lang om te versturen? Geen getal of negatief: niet (de backend toetst het bestand zelf). */
export function videoTooLongToSend(ms: number): boolean {
  return Number.isFinite(ms) && ms > MAX_SEND_MS;
}

// --- filter (besluit 1, invariant 10) ----------------------------------------

export type MediaFilter = "alle" | "fotos" | "videos";

type FilterEntry = { photo: { video?: { durationMs: number } } | null };

/** Alleen in een album met minstens één filmpje. */
export function showMediaFilter(entries: readonly FilterEntry[]): boolean {
  return entries.some((e) => e.photo?.video !== undefined);
}

/** De tegels voor een filter, in dezelfde volgorde. Een tegel zonder rij hoort alleen bij "alle". */
export function filterEntries<E extends FilterEntry>(entries: readonly E[], filter: MediaFilter): E[] {
  switch (filter) {
    case "alle":
      return [...entries];
    case "fotos":
      return entries.filter((e) => e.photo !== null && e.photo.video === undefined);
    case "videos":
      return entries.filter((e) => e.photo?.video !== undefined);
  }
}

export const MEDIA_FILTER_LABELS: Record<MediaFilter, string> = {
  alle: "Alle",
  fotos: "Foto's",
  videos: "Video's",
};

// --- datum en plaats uit het origineel (A-invariant 14) ----------------------

const QUICKTIME_DATE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/**
 * `com.apple.quicktime.creationdate` ("2026-07-14T15:32:10+0200") als
 * `X-Taken-At` ("2026:07:14 15:32:10"): de kloktijd waar de opname gemaakt
 * is, de tijdzone valt weg (zoals de EXIF-tijd van een foto). Geen echte
 * datum: null (dan stuurt de app geen datum, invariant 3).
 */
export function takenAtFromQuickTime(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const m = QUICKTIME_DATE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const back = new Date(Date.UTC(y, mo - 1, d));
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(y).padStart(4, "0")}:${p(mo)}:${p(d)} ${p(h)}:${p(mi)}:${p(s)}`;
}

// WP42b A18: de lengte met drie cijfers (iPhone, de camera van Android via
// MediaMuxer: "+004.9041") of zonder voorloopnullen (Media3: "+4.9041").
const ISO6709 = /^([+-]\d{2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?\/?$/;

/**
 * De plaats uit `com.apple.quicktime.location.ISO6709` ("+52.3676+004.9041+000.000/")
 * of `©xyz` van Android ("+52.3676+004.9041/", "+52.3676+4.9041/"), in
 * decimale graden. Hoogte valt weg. Buiten bereik of een andere vorm: null.
 * WP42b A18 (zoals 42a A5 bij foto's): 0/0 is geen plaats, ook niet als −0;
 * alleen de breedte of alleen de lengte 0 wel.
 */
export function locationFromISO6709(value: string | null | undefined): { latitude: number; longitude: number } | null {
  if (typeof value !== "string") return null;
  const m = ISO6709.exec(value.trim());
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

// WP42b A17: de UTC-tijd van Android (`METADATA_KEY_DATE`), in de vorm van
// MediaMetadataRetriever ("20261126T174453.000Z") of als ISO met Z.
const ANDROID_UTC_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z$/;
const ISO_UTC_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;

/**
 * Vóór dit jaar is het geen opnamedatum: Android geeft 1904-01-01 (`mvhd` 0)
 * of 1970-01-01 als het bestand geen datum heeft.
 */
const FIRST_REAL_YEAR = 1971;

/**
 * WP42b B11, A17: de UTC-tijd van een Android-filmpje als `X-Taken-At` in de
 * kloktijd van de tijdzone van de telefoon (die van `Date`), met de regels van
 * die zone op het moment van opnemen: een filmpje van juli in Amsterdam krijgt
 * +2, ook als het in november gekozen wordt. Geen datum, 1904/1970 of iets
 * onleesbaars: null (nooit vandaag, invariant 3).
 */
export function takenAtFromUtc(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const m = ANDROID_UTC_DATE.exec(text) ?? ISO_UTC_DATE.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (y < FIRST_REAL_YEAR || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const local = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // 31 februari en dergelijke: geen datum.
  if (local.getUTCFullYear() !== y || local.getUTCMonth() !== mo - 1 || local.getUTCDate() !== d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(local.getFullYear()).padStart(4, "0")}:${p(local.getMonth() + 1)}:${p(local.getDate())} ${p(local.getHours())}:${p(local.getMinutes())}:${p(local.getSeconds())}`;
}

/**
 * De headers voor `POST /upload/video`, zoals bij een foto (`X-Taken-At`, `X-Latitude`, `X-Longitude`).
 * De datum uit `creationDate` (iOS, kloktijd met tijdzone), anders uit
 * `utcDate` (Android, UTC; WP42b A17).
 */
export function videoMetadataHeaders(meta: {
  creationDate?: string | null;
  utcDate?: string | null;
  location?: string | null;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  const taken = takenAtFromQuickTime(meta.creationDate) ?? takenAtFromUtc(meta.utcDate);
  if (taken) headers["X-Taken-At"] = taken;
  const spot = locationFromISO6709(meta.location);
  if (spot) {
    headers["X-Latitude"] = String(spot.latitude);
    headers["X-Longitude"] = String(spot.longitude);
  }
  return headers;
}

// --- het doel van de compressie (besluit 3) ----------------------------------

/**
 * Wat de module op het toestel maakt: 1080p (langste zijde 1920), H.264 op
 * 3,6 Mbit/s met AAC 128 kbit/s, hooguit 30 fps, mp4 met de index vooraan, en
 * geen metadata (geen datum, geen GPS). ~28 MB per minuut.
 */
export const VIDEO_TARGET = {
  maxSide: 1920,
  videoCodec: "avc1",
  videoBitrate: 3_600_000,
  audioBitrate: 128_000,
  maxFps: 30,
  container: "mp4",
  indexFirst: true,
  keepMetadata: false,
} as const;

// --- meldingen (invariant 5) -------------------------------------------------

export type VideoFailReason =
  | "te_lang"
  | "te_groot"
  | "locatie"
  | "codec"
  | "geen_mp4"
  | "index_achteraan"
  | "comprimeren"
  | "netwerk"
  | "niet_binnen"
  | "bezig"
  | "limiet"
  | "geen_album"
  | "uitgelogd"
  // A-invariant 32: de upload stond langer dan een dag open (of is weg); opnieuw proberen vraagt een nieuwe aan.
  | "verlopen"
  // A-invariant 36: meer dan 30 aanvragen in 24 uur; pas later weer.
  | "te_vaak"
  | "server";

const MESSAGES: Record<VideoFailReason, string> = {
  // WP42b B14 (a): neutraal, op elk platform.
  te_lang: "Dit filmpje duurt langer dan 3 minuten. Kort het filmpje in en kies het opnieuw.",
  te_groot: "Dit filmpje is te groot, ook na het verkleinen. Kort het filmpje in en probeer het opnieuw.",
  locatie: "Er zat nog een locatie in het filmpje, dus het is niet geplaatst.",
  codec: "Dit soort filmpje kan Clubalmanac niet afspelen.",
  geen_mp4: "Dit bestand is geen filmpje dat Clubalmanac kan lezen.",
  index_achteraan: "Het filmpje is niet goed klaargemaakt voor het versturen.",
  comprimeren: "Het verkleinen van het filmpje lukte niet. Houd de app open en probeer het opnieuw.",
  netwerk: "Geen verbinding met internet. Probeer het opnieuw als je weer verbinding hebt.",
  niet_binnen: "Het filmpje is nog niet helemaal verstuurd.",
  bezig: "Er lopen al een paar filmpjes. Wacht tot die klaar zijn.",
  limiet: "Je limiet voor foto's en filmpjes is bereikt.",
  geen_album: "Dit album is niet (meer) beschikbaar.",
  uitgelogd: "Je bent niet meer ingelogd.",
  verlopen: "Het versturen duurde te lang en is gestopt. Probeer het opnieuw.",
  te_vaak: "Je hebt vandaag al veel filmpjes verstuurd. Probeer het later of morgen weer.",
  server: "Er ging iets mis bij Clubalmanac.",
};

export function videoFailMessage(reason: VideoFailReason): string {
  return MESSAGES[reason];
}

// A-invariant 33: `uitgelogd` met een vers token, zoals bij foto's; `verlopen` met een nieuwe aanvraag.
const RETRYABLE = new Set<VideoFailReason>(["netwerk", "niet_binnen", "server", "bezig", "comprimeren", "uitgelogd", "verlopen"]);

/** Heeft opnieuw proberen zin? Niet bij een vaste reden. */
export function videoRetryable(reason: VideoFailReason): boolean {
  return RETRYABLE.has(reason);
}

const START_REASONS = new Set<VideoFailReason>(["uitgelogd", "geen_album", "limiet", "te_lang", "te_groot", "bezig", "te_vaak"]);
const FINISH_REASONS = new Set<VideoFailReason>(["geen_mp4", "index_achteraan", "te_lang", "te_groot", "codec", "locatie"]);

type RetryItem = { key: string; uploadId: string; state: "wacht" | "bezig" | "klaar" | "mislukt"; reason?: VideoFailReason };

/**
 * A-invariant 33: "Filmpjes opnieuw proberen". De herhaalbare filmpjes weer op
 * "wacht" met dezelfde upload-id (zoals `retryBatch` bij foto's), en `fresh`:
 * de filmpjes die `uitgelogd` kregen, die een vers token meekrijgen.
 */
export function videoRetryRound<I extends RetryItem>(items: readonly I[]): { items: I[]; fresh: Set<string> } {
  const fresh = new Set<string>();
  const next = items.map((i) => {
    if (i.state !== "mislukt" || i.reason === undefined || !videoRetryable(i.reason)) return i;
    if (i.reason === "uitgelogd") fresh.add(i.key);
    return { ...i, state: "wacht" as const, reason: undefined };
  });
  return { items: next, fresh };
}

/** De reden van een weigering van `videos.startUpload` (`ConvexError` met `VIDEO_UPLOAD_REFUSED`). */
export function startRefusalReason(data: unknown): VideoFailReason | null {
  if (typeof data !== "object" || data === null) return null;
  const { code, reason } = data as { code?: unknown; reason?: unknown };
  if (code !== "VIDEO_UPLOAD_REFUSED") return null;
  return typeof reason === "string" && START_REASONS.has(reason as VideoFailReason) ? (reason as VideoFailReason) : "server";
}

export type VideoFinishOutcome = { ok: true; photoId: string } | { ok: false; reason: VideoFailReason };

/** Het antwoord van `POST /upload/video`. `status` null: geen antwoord (netwerk). */
export function finishOutcome(status: number | null, body: unknown): VideoFinishOutcome {
  const field = (k: string): unknown => (typeof body === "object" && body !== null ? (body as Record<string, unknown>)[k] : undefined);
  if (status === 200) {
    const photoId = field("photoId");
    return typeof photoId === "string" && photoId.length > 0 ? { ok: true, photoId } : { ok: false, reason: "server" };
  }
  switch (status) {
    case null:
      return { ok: false, reason: "netwerk" };
    case 401:
      return { ok: false, reason: "uitgelogd" };
    case 403:
      return { ok: false, reason: "limiet" };
    case 404:
      // A-invariant 32: alleen met reden `geen_album` is het album weg; anders verlopen.
      return { ok: false, reason: field("reason") === "geen_album" ? "geen_album" : "verlopen" };
    case 409:
      return { ok: false, reason: field("reason") === "niet_binnen" ? "niet_binnen" : "bezig" };
    case 413:
      return { ok: false, reason: "te_groot" };
    case 422: {
      const reason = field("reason");
      return {
        ok: false,
        reason: typeof reason === "string" && FINISH_REASONS.has(reason as VideoFailReason) ? (reason as VideoFailReason) : "server",
      };
    }
    default:
      return { ok: false, reason: "server" };
  }
}

// --- de albumkop (A-invariant 34) ----------------------------------------------

/** "38 foto's · 2 filmpjes"; zonder filmpjes alleen de foto's (invariant 10). */
export function mediaCountText(photos: number, videos: number): string {
  const p = photos === 1 ? "1 foto" : `${photos} foto's`;
  const v = videos === 1 ? "1 filmpje" : `${videos} filmpjes`;
  if (videos === 0) return p;
  if (photos === 0) return v;
  return `${p} · ${v}`;
}

// --- afspelen (A-invariant 23) -------------------------------------------------

/** De bron voor expo-video: de ondertekende link uit `videos.playUrl`, nooit uit een schijfcache. */
export function videoPlayerSource(link: { url: string; expiresAt: number }): { uri: string; useCaching: false } {
  return { uri: link.url, useCaching: false };
}

/** De afspeellink is (bijna) verlopen: een minuut marge, dan een verse. */
export function linkExpired(link: { expiresAt: number }, nowMs: number): boolean {
  return nowMs >= link.expiresAt - 60_000;
}

/** "Filmpje van 14 juli 2026, 0:42" voor VoiceOver. */
export function videoLabel(dateText: string, durationMs: number): string {
  return `Filmpje van ${dateText}, ${formatDuration(durationMs)}`;
}
