// WP18: de pure logica achter "Foto's toevoegen" en de profielfoto. Geen React,
// geen native modules; de schermen en src/data/upload.ts gebruiken dit.
//
// Per gekozen foto één upload-id, gelijk bij opnieuw proberen (A-invariant
// 18, invariant 1). Dezelfde foto voor hetzelfde album houdt zijn id ook in
// een nieuwe ronde (A-invariant 25, `albumBatch`). Een 200 van /upload
// met album betekent "in het album" (A-keuze 1). Na een ronde per reden met
// aantal wat niet lukte (invariant 2); na "limiet" start er niets meer
// (invariant 7).

/** A-keuze 3: langste zijde na omzetten. */
export const UPLOAD_MAX_SIDE = 4032;

/**
 * Fix-cyclus 1, invariant 20: zo lang mag één verzoek naar /upload duren,
 * versturen én het antwoord lezen. Daarna stopt de app het en is de uitkomst
 * "netwerk"; opnieuw proberen gebruikt dezelfde upload-id.
 */
export const UPLOAD_TIMEOUT_MS = 120_000;

/** Hoeveel foto's tegelijk onderweg zijn. */
export const UPLOAD_PARALLEL = 2;

export type FailReason =
  | "netwerk"
  | "bezig"
  | "uitgelogd"
  | "server"
  | "limiet"
  | "te_groot"
  | "geen_foto"
  | "geen_album";

export type UploadState = "wacht" | "bezig" | "klaar" | "mislukt";

export type UploadItem = {
  key: string;
  uploadId: string;
  state: UploadState;
  photoId?: string;
  reason?: FailReason;
};

export type UploadOutcome = { ok: true; photoId: string } | { ok: false; reason: FailReason };

let counter = 0;

// Tijd, een teller en toeval: uniek binnen deze app-sessie (de teller) en
// over herstarts heen (tijd en toeval). Geen native crypto nodig.
function newUploadId(): string {
  counter += 1;
  const random = Math.floor(Math.random() * 0x7fffffff).toString(36);
  return `${Date.now().toString(36)}-${counter.toString(36)}-${random}`;
}

/** Een nieuwe ronde: elk gekozen beeld wacht, met een eigen upload-id. Voor de profielfoto. */
export function newBatch(keys: readonly string[]): UploadItem[] {
  return keys.map((key) => ({ key, uploadId: newUploadId(), state: "wacht" }));
}

// Fix-cyclus 2, A-invariant 25: de upload-id per foto (`assetId`) en album,
// voor de duur van de app-sessie. Na een herstart is hij weg (besluit 3).
const albumUploadIds = new Map<string, string>();

/**
 * Een nieuwe ronde voor een album. Dezelfde foto voor hetzelfde album krijgt
 * dezelfde upload-id als in een eerdere ronde, zodat de backend een foto die
 * al binnen was teruggeeft in plaats van een tweede te maken. Een ander album
 * of een foto zonder `assetId` krijgt een nieuwe id; binnen één ronde heeft
 * elke foto een eigen id.
 */
export function albumBatch(
  picks: readonly { key: string; assetId?: string | null }[],
  albumId: string,
): UploadItem[] {
  const used = new Set<string>();
  return picks.map(({ key, assetId }) => {
    let uploadId: string | undefined;
    if (assetId) {
      const memo = JSON.stringify([albumId, assetId]);
      if (!used.has(memo)) {
        used.add(memo);
        uploadId = albumUploadIds.get(memo);
        if (uploadId === undefined) {
          uploadId = newUploadId();
          albumUploadIds.set(memo, uploadId);
        }
      }
    }
    return { key, uploadId: uploadId ?? newUploadId(), state: "wacht" };
  });
}

/** Het antwoord van /upload als uitkomst. `status` null: geen antwoord (netwerk). */
export function uploadOutcome(status: number | null, body: unknown): UploadOutcome {
  if (status === 200) {
    const photoId =
      typeof body === "object" && body !== null ? (body as { photoId?: unknown }).photoId : undefined;
    return typeof photoId === "string" && photoId.length > 0
      ? { ok: true, photoId }
      : { ok: false, reason: "server" };
  }
  return { ok: false, reason: failReasonOf(status) };
}

function failReasonOf(status: number | null): FailReason {
  switch (status) {
    case null:
      return "netwerk";
    case 401:
      return "uitgelogd";
    case 403:
      return "limiet";
    case 404:
      return "geen_album";
    case 409:
      return "bezig";
    case 413:
      return "te_groot";
    case 415:
      return "geen_foto";
    default:
      return "server";
  }
}

/** Heeft opnieuw proberen zin? Niet bij een vaste reden. */
export function canRetry(reason: FailReason): boolean {
  return reason === "netwerk" || reason === "bezig" || reason === "uitgelogd" || reason === "server";
}

/** Eén item gaat de lucht in. */
export function startItem(items: readonly UploadItem[], key: string): UploadItem[] {
  return items.map((i) => (i.key === key ? { key: i.key, uploadId: i.uploadId, state: "bezig" } : i));
}

/**
 * De uitkomst van één item. Bij "limiet" tellen de wachtende foto's mee als
 * mislukt met dezelfde reden: ze starten niet meer.
 */
export function applyOutcome(items: readonly UploadItem[], key: string, outcome: UploadOutcome): UploadItem[] {
  const limit = !outcome.ok && outcome.reason === "limiet";
  return items.map((i) => {
    if (i.key === key) {
      return outcome.ok
        ? { key: i.key, uploadId: i.uploadId, state: "klaar", photoId: outcome.photoId }
        : { key: i.key, uploadId: i.uploadId, state: "mislukt", reason: outcome.reason };
    }
    if (limit && i.state === "wacht") {
      return { key: i.key, uploadId: i.uploadId, state: "mislukt", reason: "limiet" };
    }
    return i;
  });
}

export type ProfileRetry =
  | { step: "upload"; uploadId: string }
  | { step: "opslaan"; photoId: string }
  | null;

/**
 * Fix-cyclus 1, invariant 21: wat "Opnieuw proberen" bij een profielfoto doet.
 * Mislukte de upload met een reden waar opnieuw proberen zin heeft: de upload
 * opnieuw, met dezelfde id. Lukte de upload maar het opslaan als profielfoto
 * niet (het item is klaar): alleen het opslaan, met de foto die er is. Anders
 * niets; een andere foto kiezen is een nieuwe keuze.
 */
export function profileRetry(item: UploadItem): ProfileRetry {
  if (item.state === "klaar" && item.photoId) return { step: "opslaan", photoId: item.photoId };
  if (item.state === "mislukt" && item.reason !== undefined && canRetry(item.reason)) {
    return { step: "upload", uploadId: item.uploadId };
  }
  return null;
}

/** Opnieuw proberen: de mislukte foto's waar het zin heeft, met dezelfde id. */
export function retryBatch(items: readonly UploadItem[]): UploadItem[] {
  return items.map((i) =>
    i.state === "mislukt" && i.reason !== undefined && canRetry(i.reason)
      ? { key: i.key, uploadId: i.uploadId, state: "wacht" }
      : i,
  );
}

export type BatchSummary = {
  total: number;
  klaar: number;
  mislukt: number;
  /** Wacht of bezig. */
  open: number;
  done: boolean;
  allInAlbum: boolean;
  retryable: number;
  reasons: { reason: FailReason; count: number }[];
};

export function batchSummary(items: readonly UploadItem[]): BatchSummary {
  const counts = new Map<FailReason, number>();
  let klaar = 0;
  let mislukt = 0;
  let retryable = 0;
  for (const i of items) {
    if (i.state === "klaar") klaar += 1;
    if (i.state === "mislukt" && i.reason !== undefined) {
      mislukt += 1;
      counts.set(i.reason, (counts.get(i.reason) ?? 0) + 1);
      if (canRetry(i.reason)) retryable += 1;
    }
  }
  const open = items.length - klaar - mislukt;
  return {
    total: items.length,
    klaar,
    mislukt,
    open,
    done: open === 0,
    allInAlbum: items.length > 0 && klaar === items.length,
    retryable,
    reasons: [...counts].map(([reason, count]) => ({ reason, count })),
  };
}

const REASON_TEXT: Record<FailReason, string> = {
  netwerk: "Geen verbinding met internet",
  bezig: "Nog bezig met een eerdere poging",
  uitgelogd: "Je bent niet meer ingelogd",
  server: "Er ging iets mis bij Clubalmanac",
  limiet: "Je fotolimiet is bereikt",
  te_groot: "Het bestand is te groot",
  geen_foto: "Dit bestand is geen foto",
  geen_album: "Dit album is niet (meer) beschikbaar",
};

/** De reden in het NL, voor de melding na een ronde. */
export function reasonText(reason: FailReason): string {
  return REASON_TEXT[reason];
}

/** "1 foto" of "3 foto's". */
export function photoCountText(n: number): string {
  return n === 1 ? "1 foto" : `${n} foto's`;
}

/** A-keuze 3: de maat na omzetten. Nooit groter, verhouding gelijk, hele pixels. */
export function fitWithin(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= UPLOAD_MAX_SIDE) return { width, height };
  const scale = UPLOAD_MAX_SIDE / longest;
  const fit = (side: number) => Math.min(side, Math.max(1, Math.round(side * scale)));
  return width >= height
    ? { width: UPLOAD_MAX_SIDE, height: fit(height) }
    : { width: fit(width), height: UPLOAD_MAX_SIDE };
}

/**
 * A-keuze 2 en vraag 2: de headers uit de EXIF van de kiezer. iOS geeft
 * `DateTimeOriginal` in EXIF-vorm en de GPS als positieve graden met een
 * richting (N/S, E/W). De backend toetst de waarden zelf; wat hier niet past,
 * gaat niet mee.
 */
export function metadataHeaders(exif: Record<string, unknown> | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!exif) return headers;
  const taken = exif.DateTimeOriginal;
  if (typeof taken === "string" && taken.trim() !== "") headers["X-Taken-At"] = taken.trim();
  const lat = signedDegrees(exif.GPSLatitude, exif.GPSLatitudeRef, "S");
  const lon = signedDegrees(exif.GPSLongitude, exif.GPSLongitudeRef, "W");
  if (lat !== undefined && lon !== undefined) {
    headers["X-Latitude"] = String(lat);
    headers["X-Longitude"] = String(lon);
  }
  return headers;
}

function signedDegrees(value: unknown, ref: unknown, negative: "S" | "W"): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const flip = typeof ref === "string" && ref.trim().toUpperCase() === negative;
  return flip ? -Math.abs(n) : n;
}

const ALBUM_PATH = /^\/groep\/[^/]+\/album\/([^/?#]+)/;

/**
 * De "+" in de tabbalk geeft het album van de huidige route mee: het album
 * zelf, een foto erin, of het draaien van een foto erin.
 */
export function albumIdFromPath(pathname: string): string | null {
  const m = ALBUM_PATH.exec(pathname);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}
