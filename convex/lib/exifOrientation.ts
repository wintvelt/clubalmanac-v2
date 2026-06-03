// WP8 (EXIF-only): canonieke EXIF-Orientation arithmetiek.
//
// De 8 EXIF-Orientation-waarden zijn de D4-symmetrieën van een afbeelding:
//   1=normaal 2=mirror-H 3=180° 4=mirror-V 5=transpose
//   6=90°CW   7=transverse 8=90°CCW
//
// `photos.exifOrientation` is sinds cyclus-2 hardening de bron-van-waarheid voor
// display-oriëntatie (clients passen CSS-transform toe; de embedded file-EXIF
// wordt genegeerd). `rotate` herberekent deze waarde puur op DB-niveau — geen
// pixel-manipulatie, geen sharp/jimp.
//
// Conventies (spec WP8 §A-revisie cyclus 2):
//   - rotation = clockwise ("draai rechts").
//   - flipY    = horizontale mirror (naam uit Jimp-`flip(horizontal, vertical)`;
//                "Y" historisch verkeerd, behouden voor v1-continuïteit).
//   - Volgorde bij combinatie: flip EERST, dán rotatie
//     (matcht oude AWS `image.flip(flipY,false).rotate(rotation)`):
//       nieuw = ROT[rotation]( FLIP( huidig ) )
//   - undefined huidige oriëntatie → behandel als 1 (normaal).

export type Rotation = 0 | 90 | 180 | 270;

// Transitie-tabellen (huidige 1..8) → nieuwe 1..8. Ground-truth uit de spec,
// afgeleid via D4-groep-compositie, geverifieerd op delta (90∘90=180) +
// inverse (90 dán 270 = identiteit).
const ROT90: Record<number, number> = { 1: 6, 2: 5, 3: 8, 4: 7, 5: 4, 6: 3, 7: 2, 8: 1 };
const ROT180: Record<number, number> = { 1: 3, 2: 4, 3: 1, 4: 2, 5: 7, 6: 8, 7: 5, 8: 6 };
const ROT270: Record<number, number> = { 1: 8, 2: 7, 3: 6, 4: 5, 5: 2, 6: 1, 7: 4, 8: 3 };
// flip-only (horizontale mirror)
const FLIP: Record<number, number> = { 1: 2, 2: 1, 3: 4, 4: 3, 5: 8, 6: 7, 7: 6, 8: 5 };

const ROT: Record<Rotation, Record<number, number> | null> = {
  0: null, // identiteit — geen lookup nodig
  90: ROT90,
  180: ROT180,
  270: ROT270,
};

// Bereken de nieuwe oriëntatie door eerst de flip, dán de rotatie toe te passen.
// `current === undefined` → start vanaf 1 (normaal).
export function applyOrientation(
  current: number | undefined,
  rotation: Rotation,
  flipY: boolean,
): number {
  // Oriëntatie is altijd een gesloten domein 1..8 en de tabellen zijn compleet,
  // dus de lookups zijn total — non-null assertion i.p.v. een fallback die een
  // out-of-range-bug zou maskeren.
  let value = current ?? 1;
  if (flipY) value = FLIP[value]!;
  const rot = ROT[rotation];
  if (rot) value = rot[value]!;
  return value;
}

// Een 90°/270°-rotatie wisselt breedte en hoogte; 0°, 180° en flip-only niet.
export function rotationSwapsDimensions(rotation: Rotation): boolean {
  return rotation === 90 || rotation === 270;
}
