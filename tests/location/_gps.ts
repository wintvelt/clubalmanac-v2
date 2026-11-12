// WP17d besluit 2 — draagt een beeld GPS?
//
// Een kleine JPEG-lezer zonder bibliotheek (de tests draaien in de
// edge-runtime): loop de segmenten af, en kijk in elk APP1-segment met
// "Exif\0\0" of IFD0 een GPS-wijzer (tag 0x8825) heeft. Een bestand dat geen
// JPEG is, telt als "geen GPS-EXIF gevonden" maar zegt `isJpeg: false`.
//
// tests/fixtures/wp17d/gps.jpg: 16×12 px, rood, met een GPS-plek (verzonnen,
// bij 52,1 / 6,0), gemaakt met sharp:
//   sharp({ create: { width: 16, height: 12, channels: 3, background: … } })
//     .jpeg().withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 7/1 2400/100", … } })

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const raw = readFileSync(fileURLToPath(new URL("../fixtures/wp17d/gps.jpg", import.meta.url)));
export const GPS_JPEG: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(raw.length));
GPS_JPEG.set(raw);

export function exifGps(bytes: Uint8Array): { isJpeg: boolean; hasGps: boolean } {
  const b = (k: number) => bytes[k] ?? 0;
  if (bytes.length < 4 || b(0) !== 0xff || b(1) !== 0xd8) return { isJpeg: false, hasGps: false };
  let i = 2;
  let hasGps = false;
  while (i + 4 <= bytes.length && b(i) === 0xff) {
    const marker = b(i + 1);
    if (marker === 0xda || marker === 0xd9) break; // beelddata of einde
    const len = (b(i + 2) << 8) | b(i + 3);
    if (marker === 0xe1 && hasGpsPointer(bytes.subarray(i + 4, i + 2 + len))) hasGps = true;
    i += 2 + len;
  }
  return { isJpeg: true, hasGps };
}

function hasGpsPointer(seg: Uint8Array): boolean {
  const header = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  if (seg.length < 14 || header.some((v, k) => seg[k] !== v)) return false;
  const tiff = seg.subarray(6);
  const t = (k: number) => tiff[k] ?? 0;
  const little = t(0) === 0x49; // "II"
  const u16 = (o: number) => (little ? t(o) | (t(o + 1) << 8) : (t(o) << 8) | t(o + 1));
  const u32 = (o: number) =>
    little
      ? (t(o) | (t(o + 1) << 8) | (t(o + 2) << 16) | (t(o + 3) << 24)) >>> 0
      : ((t(o) << 24) | (t(o + 1) << 16) | (t(o + 2) << 8) | t(o + 3)) >>> 0;
  const ifd0 = u32(4);
  if (ifd0 + 2 > tiff.length) return false;
  const n = u16(ifd0);
  for (let k = 0; k < n; k++) {
    const entry = ifd0 + 2 + k * 12;
    if (entry + 2 > tiff.length) break;
    if (u16(entry) === 0x8825) return true;
  }
  return false;
}
