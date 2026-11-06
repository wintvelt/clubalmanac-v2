// WP17a: pure logica achter het albumscherm en het foto-detail.
// Spec: docs/work-packages/WP17a-fotos-bekijken.md §Spec-criticus aanvullingen
// (pariteit-checklist, invarianten 4, 11, 12, vraag 6). Wat er getoond wordt
// en wanneer; de schermen tonen het.

// --- Datum van een foto -----------------------------------------------------------

type PhotoDated = { takenAt?: number; createdAt: number };

// De datum van de foto (EXIF), anders de upload.
export function photoDate(photo: PhotoDated): number {
  return photo.takenAt ?? photo.createdAt;
}

const MONTHS = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

const HOUR = 3_600_000;

// Laatste zondag van een maand, 01:00 UTC: daar wisselt de Europese zomertijd.
function lastSundayOneUtc(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const back = lastDay.getUTCDay(); // 0 = zondag
  return Date.UTC(year, month, lastDay.getUTCDate() - back, 1);
}

// Nederlandse tijd zonder tijdzone-database op het toestel: UTC+2 tussen de
// laatste zondag van maart en die van oktober (01:00 UTC), anders UTC+1.
function dutchOffset(ms: number): number {
  const year = new Date(ms).getUTCFullYear();
  const summer = ms >= lastSundayOneUtc(year, 2) && ms < lastSundayOneUtc(year, 9);
  return summer ? 2 * HOUR : HOUR;
}

// "12 maart 2023": de dag in Nederlandse tijd, zonder tijd.
export function formatPhotoDate(ms: number): string {
  const local = new Date(ms + dutchOffset(ms));
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}`;
}

// --- Volgorde in het album ----------------------------------------------------------

type AlbumEntry = {
  albumPhoto: { photoId: string };
  photo: PhotoDated | null;
  isNew: boolean;
};

export type ShownEntry<E extends AlbumEntry> = E & { photo: NonNullable<E["photo"]> };

// Zoals v1: de datum van de foto, nieuwste eerst; bij gelijke datum nieuw
// eerst, dan op id. Een publicatie zonder foto-rij wordt niet getoond.
export function sortAlbumPhotos<E extends AlbumEntry>(entries: readonly E[]): ShownEntry<E>[] {
  return entries
    .filter((e): e is ShownEntry<E> => e.photo !== null)
    .sort(
      (a, b) =>
        photoDate(b.photo) - photoDate(a.photo) ||
        Number(b.isNew) - Number(a.isNew) ||
        (a.albumPhoto.photoId < b.albumPhoto.photoId ? -1 : a.albumPhoto.photoId > b.albumPhoto.photoId ? 1 : 0),
    );
}

// --- Oriëntatie (invariant 4, WP8 §Frontend-contract) ---------------------------------

export type Orientation = { rotate: 0 | 90 | 180 | 270; mirror: boolean };

// Wat de app op de opgeslagen pixels toepast om de foto rechtop te tonen:
// eerst horizontaal spiegelen (als `mirror`), dan `rotate` graden met de klok
// mee. Per EXIF-tag (0x0112). Geen of een ongeldige waarde: zoals opgeslagen.
const ORIENTATIONS: Record<number, Orientation> = {
  1: { rotate: 0, mirror: false },
  2: { rotate: 0, mirror: true },
  3: { rotate: 180, mirror: false },
  4: { rotate: 180, mirror: true },
  5: { rotate: 270, mirror: true },
  6: { rotate: 90, mirror: false },
  7: { rotate: 90, mirror: true },
  8: { rotate: 270, mirror: false },
};

const UPRIGHT: Orientation = { rotate: 0, mirror: false };

export function orientationOf(exifOrientation: number | undefined): Orientation {
  if (exifOrientation === undefined || !Number.isInteger(exifOrientation)) return UPRIGHT;
  return ORIENTATIONS[exifOrientation] ?? UPRIGHT;
}

// Bij een kwartslag wisselen breedte en hoogte.
export function swapsAspect(exifOrientation: number | undefined): boolean {
  const { rotate } = orientationOf(exifOrientation);
  return rotate === 90 || rotate === 270;
}

// De transform voor React Native: eerst spiegelen, dan draaien. RN past de
// lijst van achter naar voren toe op het beeld, dus de draaiing staat vooraan.
export function orientationTransform(
  exifOrientation: number | undefined,
): ({ rotate: string } | { scaleX: number })[] {
  const { rotate, mirror } = orientationOf(exifOrientation);
  const out: ({ rotate: string } | { scaleX: number })[] = [];
  if (rotate !== 0) out.push({ rotate: `${rotate}deg` });
  if (mirror) out.push({ scaleX: -1 });
  return out;
}

// --- Markeringen blijven staan (invariant 12) ---------------------------------------

type Marked = { albumPhoto: { photoId: string }; isNew: boolean };

// Wat nieuw was toen het album openging, of erbij kwam terwijl het open was,
// houdt zijn markering tot de user het scherm verlaat. `markSeen` maakt alles
// live "niet nieuw"; de vorige set blijft dus de basis.
export function keepNewMarkers(previous: ReadonlySet<string>, items: readonly Marked[]): Set<string> {
  const next = new Set(previous);
  for (const item of items) if (item.isNew) next.add(item.albumPhoto.photoId);
  return next;
}

// --- Wanneer markSeen loopt (vraag 6, WP16 invariant 3) ------------------------------

// In beeld, geladen, met minstens één foto, en er is een foto die nog niet als
// gezien gemarkeerd is (eerste keer, of een foto die erbij kwam). Laden, een
// fout of een leeg album tellen niet; alleen een foto die verdween ook niet.
export function shouldMarkSeen(input: {
  inView: boolean;
  loaded: boolean;
  photoIds: readonly string[];
  markedIds: ReadonlySet<string> | null;
}): boolean {
  if (!input.inView || !input.loaded || input.photoIds.length === 0) return false;
  if (input.markedIds === null) return true;
  return input.photoIds.some((id) => !input.markedIds!.has(id));
}

// --- Detail: de foto in beeld verdwijnt ----------------------------------------------

// De huidige blijft als hij er nog is. Anders de eerstvolgende in de oude
// volgorde die er nog is, anders de dichtstbijzijnde ervoor. Niets meer over:
// null (terug naar het album).
export function nextAfterRemoval(
  before: readonly string[],
  after: readonly string[],
  current: string,
): string | null {
  const still = new Set(after);
  if (still.has(current)) return current;
  const at = before.indexOf(current);
  for (let i = at + 1; i < before.length; i++) if (still.has(before[i]!)) return before[i]!;
  for (let i = at - 1; i >= 0; i--) if (still.has(before[i]!)) return before[i]!;
  return after[0] ?? null;
}
