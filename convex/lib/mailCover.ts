"use node";

// WP19c A-invariant 4–6: de groepsfoto als bijlage van de uitnodigingsmail.
//
// In: de bytes van *klein* (ruwe pixels, WP25 invariant 18) en de stand uit
// `photos.exifOrientation`. Uit: een JPEG die een mailclient rechtop toont
// zonder iets te draaien.
//   - De stand zit in de pixels: eerst spiegelen, dan draaien, zoals de app
//     (`orientationTransform`, app/src/lib/photos.ts). Geen oriëntatie-tag.
//   - Alleen pixels: sharp schrijft zonder `withMetadata`/`keepMetadata` geen
//     EXIF, XMP, IPTC of ICC, ook als *klein* dat tegen de regels in had.
//   - Hoogstens 512 px breed en hoog, nooit vergroot; hoogstens 200 kB.
//     Te groot of geen beeld: `null`, de mail gaat zonder foto.

import { KLEIN_MAX, loadSharp } from "./photoFormats";

export const MAIL_COVER_MAX_BYTES = 200_000;
const JPEG_OPTIONS = { quality: 80, mozjpeg: true } as const;
const WHITE = { r: 255, g: 255, b: 255 };

// EXIF-stand → spiegelen (horizontaal), dan draaien (met de klok mee).
// Gelijk aan ORIENTATIONS in app/src/lib/photos.ts.
const ORIENTATIONS: Record<number, { mirror: boolean; rotate: 0 | 90 | 180 | 270 }> = {
  1: { mirror: false, rotate: 0 },
  2: { mirror: true, rotate: 0 },
  3: { mirror: false, rotate: 180 },
  4: { mirror: true, rotate: 180 },
  5: { mirror: true, rotate: 270 },
  6: { mirror: false, rotate: 90 },
  7: { mirror: true, rotate: 90 },
  8: { mirror: false, rotate: 270 },
};

export type MailCover = { bytes: Uint8Array; width: number };

/**
 * Maakt de bijlage. Gooit als de bytes geen beeld zijn; `null` als het
 * resultaat boven de grens uitkomt.
 */
export async function makeMailCover(
  klein: Uint8Array,
  exifOrientation: number | undefined,
): Promise<MailCover | null> {
  const sharp = await loadSharp();
  const { mirror, rotate } = (exifOrientation !== undefined && ORIENTATIONS[exifOrientation]) || ORIENTATIONS[1]!;

  // sharp spiegelt altijd vóór het draaien. Een draaiing met een hoek negeert
  // een eventuele tag in het bestand; zonder hoek wordt er niet gedraaid.
  let img = sharp(klein, { pages: 1 }).flatten({ background: WHITE }).toColourspace("srgb");
  if (mirror) img = img.flop();
  if (rotate !== 0) img = img.rotate(rotate);
  const { data, info } = await img
    .resize(KLEIN_MAX, KLEIN_MAX, { fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .jpeg(JPEG_OPTIONS)
    .toBuffer({ resolveWithObject: true });

  if (data.length > MAIL_COVER_MAX_BYTES) return null;
  return { bytes: new Uint8Array(data), width: info.width };
}
