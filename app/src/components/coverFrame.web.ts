import { radius, size, space } from "../theme";
import type { CoverFrame } from "./coverFrame";

// WP35 (besluit Wouter): op een breed venster is een cover van 168 px hoog
// over de volle breedte een platte streep. Op het web is de cover daarom even
// breed als de inhoud van de kolom (size.maxTextColumn min de schermmarges),
// gecentreerd, met afgeronde hoeken en wat ruimte erboven; zo staat hij recht
// boven titel en lijst. Is
// het venster smaller dan de kolom (een telefoon), dan blijft het zoals in de
// app: over de volle breedte. In de browser trekt niemand de pagina omlaag,
// dus geen ruimte om mee te rekken.
export type { CoverFrame };

export function coverFrame(windowWidth: number, pullRoom: number): CoverFrame {
  if (windowWidth <= size.maxTextColumn) return { width: windowWidth, pullRoom, inset: null };
  return {
    width: size.maxTextColumn - 2 * size.screenMargin,
    pullRoom: 0,
    inset: { radius: radius.groupPhoto, top: space.l, contentTop: space.s },
  };
}
