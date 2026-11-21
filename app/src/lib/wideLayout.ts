// WP35 (besluit Wouter 2026-11-20): de brede layout van Groep en Album. Links
// een vaste kolom met cover en titel, rechts de inhoud. Op het web vanaf een
// breed venster (src/components/wideLayout.web.ts); op iOS alleen op een iPad
// die liggend staat (besluit Wouter 2026-11-21, src/components/wideLayout.ts).

/** Vanaf deze vensterbreedte de brede layout. */
export const WIDE_FROM = 900;

/**
 * Breed op iOS: een iPad, het venster liggend (breder dan hoog) en minstens
 * WIDE_FROM breed. Het venster, niet het scherm: draaien, Split View en Stage
 * Manager schakelen meteen om. Een iPhone blijft smal, ook liggend.
 */
export function wideOnIOS({ isPad, width, height }: { isPad: boolean; width: number; height: number }): boolean {
  return isPad && width > height && width >= WIDE_FROM;
}

/** Breedte van de vaste kolom links. */
export const SIDE_WIDTH = 340;
/** Een fototegel in de brede layout: vast, groeit niet mee met het venster. */
export const WIDE_TILE = 180;

/** Zoveel kolommen van WIDE_TILE als er passen in `available` (minstens 1). */
export function wideGrid(available: number, gap: number): { columns: number; tile: number } {
  const columns = Math.max(1, Math.floor((available + gap) / (WIDE_TILE + gap)));
  return { columns, tile: WIDE_TILE };
}

/**
 * `windowSize` van het fotoraster in de brede web-layout: de lijst rendert het
 * scherm plus één scherm erboven en eronder. (Smal en op iOS: 5.)
 */
export const WIDE_WINDOW_SIZE = 3;

/** De tussenruimte van het fotoraster (GAP in AlbumScreen en MyPhotosScreen). */
const RASTER_GAP = 2;
/** De kleinste tegel in de smalle layout met 4 kolommen (venster ≥ 600 px). */
const NARROW_MIN_TILE = 150;
const NARROW_MAX_COLUMNS = 4;
const NARROW_WINDOW_SIZE = 5;

/**
 * WP35 A-invariant W3: de grens van het beeldgeheugen op het web. Wat de
 * albumlijst tegelijk rendert, moet er ruim (2×) in passen, anders vallen
 * zichtbare beelden eruit, worden ze opnieuw opgehaald en flikkeren ze.
 * Begrensd door het scherm (`screen`, de grootste maat die het venster kan
 * krijgen), nooit minder dan 200. Een scherm van 1920 × 1080 geeft ~400
 * beelden (*klein* ~35 kB: ~14 MB), 2560 × 1440 ~720 (~25 MB).
 */
export function webImageMemoryLimit(screenWidth: number, screenHeight: number): number {
  const step = WIDE_TILE + RASTER_GAP;
  const wide = Math.ceil(screenWidth / step) * Math.ceil(screenHeight / step) * WIDE_WINDOW_SIZE;
  const narrow = NARROW_MAX_COLUMNS * Math.ceil(screenHeight / NARROW_MIN_TILE) * NARROW_WINDOW_SIZE;
  return Math.max(200, 2 * Math.max(wide, narrow));
}
