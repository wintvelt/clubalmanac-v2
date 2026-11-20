// WP35 (besluit Wouter 2026-11-20): de brede web-layout van Groep en Album.
// Links een vaste kolom met cover en titel, rechts de inhoud. Alleen op het
// web vanaf een breed venster (src/components/wideLayout.web.ts); op iOS nooit.

/** Vanaf deze vensterbreedte de brede layout. */
export const WIDE_FROM = 900;
/** Breedte van de vaste kolom links. */
export const SIDE_WIDTH = 340;
/** Een fototegel in de brede layout: vast, groeit niet mee met het venster. */
export const WIDE_TILE = 180;

/** Zoveel kolommen van WIDE_TILE als er passen in `available` (minstens 1). */
export function wideGrid(available: number, gap: number): { columns: number; tile: number } {
  const columns = Math.max(1, Math.floor((available + gap) / (WIDE_TILE + gap)));
  return { columns, tile: WIDE_TILE };
}
