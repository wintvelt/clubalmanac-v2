// De plek van de cover in de kop van Groep en Album (MotionHeader). Op iOS over
// de volle breedte, met ruimte erboven om bij trekken mee te rekken; precies
// zoals het was. Web: coverFrame.web.ts (WP35).
export type CoverFrame = {
  // Breedte van de cover (het vlak waarin het beeld staat).
  width: number;
  // Ruimte boven de kop voor de cover die bij trekken meerekt.
  pullRoom: number;
  // Alleen op het web: een gecentreerde, afgeronde cover met wat ruimte erboven.
  // `contentTop`: extra ruimte boven de inhoud (pil, letter) binnen de cover.
  inset: { radius: number; top: number; contentTop: number } | null;
};

export function coverFrame(windowWidth: number, pullRoom: number): CoverFrame {
  return { width: windowWidth, pullRoom, inset: null };
}
