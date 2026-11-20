import { radius, size, space } from "../theme";
import type { CoverFrame } from "./coverFrame";

// WP35 (besluit Wouter): de kop met cover op een smal web-venster. Vanaf
// WIDE_FROM (src/lib/wideLayout.ts) staat de cover in de zijkolom (WideSide)
// en is deze kop er niet.
// - De cover is 2:1, niet 168 px hoog: over een breder venster anders een
//   platte streep.
// - Breder dan de kolom: even breed als de inhoud van de kolom
//   (size.maxTextColumn min de schermmarges), gecentreerd, met afgeronde
//   hoeken en wat ruimte erboven; pil en letter staan binnen de cover.
// - Smaller (een telefoon): over de volle breedte, zoals in de app.
// In de browser trekt niemand de pagina omlaag, dus geen ruimte om mee te
// rekken.
export type { CoverFrame };

export function coverFrame(windowWidth: number, pullRoom: number): CoverFrame {
  if (windowWidth <= size.maxTextColumn) {
    return { width: windowWidth, pullRoom, height: Math.round(windowWidth / 2), inset: null };
  }
  const width = size.maxTextColumn - 2 * size.screenMargin;
  return {
    width,
    pullRoom: 0,
    height: Math.round(width / 2),
    inset: { radius: radius.groupPhoto, top: space.l, contentTop: space.s },
  };
}
