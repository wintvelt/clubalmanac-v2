// WP17d — echte beeldbestanden voor de beeldpaden, en een GPS-controle over
// het héle bestand.
//
// Besluit 4 (fix-cyclus 1): een origineel gaat nooit meer ongewijzigd over een
// beeldpad. Een JPEG gaat zonder metadata mee; een bestand dat de schoonmaker
// niet begrijpt (afwijkende structuur, of een niet-JPEG zonder formaten) gaat
// niet ongewijzigd mee. Tekst als "origineel" kan dus niet meer: de tests
// gebruiken hier echte JPEG's. Een formaat (door ons gemaakt, zonder EXIF,
// WP25 invariant 18) gaat wel ongewijzigd mee; daar blijft tekst goed.
//
// Testbestanden in tests/fixtures/wp17d/, gemaakt met sharp 0.34:
//   gps.jpg             16×12, baseline, stand 6 en een verzonnen GPS-plek
//                       (52,1 / 6,0): .jpeg({quality:80}).withExif({IFD0:
//                       {Orientation:"6"}, IFD3:{GPSLatitude…}})
//   gps-progressief.jpg 24×16, progressief (10 scans), dezelfde EXIF
//   schoon.jpg          16×12, baseline, zonder metadata (blauw)
//   schoon-b.jpg        idem, groen (andere bytes)
//
// De GPS-controle zoekt niet segment voor segment (dan zie je niet wat ná de
// beelddata staat, en dat was de blinde vlek van de vorige controle, audit
// S2), maar op elke positie in het bestand naar een TIFF-kop ("II*\0" of
// "MM\0*") met een GPS-wijzer (tag 0x8825) in IFD0, en naar de XMP-namen
// "GPSLatitude"/"GPSLongitude". Zo vindt hij GPS in een tweede beeld, een
// trailer, een MPF-blok en een PNG-eXIf-chunk.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function fixture(name: string): Uint8Array<ArrayBuffer> {
  const raw = readFileSync(fileURLToPath(new URL(`../fixtures/wp17d/${name}`, import.meta.url)));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  out.set(raw);
  return out;
}

export const GPS_JPEG = fixture("gps.jpg");
export const GPS_PROGRESSIEF = fixture("gps-progressief.jpg");
export const SCHOON = fixture("schoon.jpg");
export const SCHOON_B = fixture("schoon-b.jpg");

export function concat(...parts: (Uint8Array | number[] | string)[]): Uint8Array<ArrayBuffer> {
  const arrays = parts.map((p) =>
    typeof p === "string" ? new TextEncoder().encode(p) : p instanceof Uint8Array ? p : new Uint8Array(p),
  );
  const out = new Uint8Array(new ArrayBuffer(arrays.reduce((n, a) => n + a.length, 0)));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, k) => v === b[k]);
}

export function containsBytes(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
}

export async function bytesOf(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

export function isJpeg(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/**
 * Een geldige JPEG met een label in een commentaar-segment (COM) direct na
 * SOI, verder schoon.jpg. Het label is voor de test; een beeldpad mag het
 * weghalen.
 */
export function labeledJpeg(label: string): Uint8Array<ArrayBuffer> {
  const text = new TextEncoder().encode(label);
  const len = text.length + 2;
  return concat([0xff, 0xd8, 0xff, 0xfe, len >> 8, len & 0xff], text, SCHOON.subarray(2));
}

// --- GPS, overal in het bestand -------------------------------------------------------

function tiffHasGps(b: Uint8Array, at: number): boolean {
  const t = (k: number) => b[at + k] ?? 0;
  const little = t(0) === 0x49 && t(1) === 0x49 && t(2) === 0x2a && t(3) === 0x00;
  const big = t(0) === 0x4d && t(1) === 0x4d && t(2) === 0x00 && t(3) === 0x2a;
  if (!little && !big) return false;
  const u16 = (o: number) => (little ? t(o) | (t(o + 1) << 8) : (t(o) << 8) | t(o + 1));
  const u32 = (o: number) =>
    little
      ? (t(o) | (t(o + 1) << 8) | (t(o + 2) << 16) | (t(o + 3) << 24)) >>> 0
      : ((t(o) << 24) | (t(o + 1) << 16) | (t(o + 2) << 8) | t(o + 3)) >>> 0;
  const ifd0 = u32(4);
  if (at + ifd0 + 2 > b.length) return false;
  const n = u16(ifd0);
  for (let k = 0; k < n && at + ifd0 + 2 + k * 12 + 2 <= b.length; k++) {
    if (u16(ifd0 + 2 + k * 12) === 0x8825) return true;
  }
  return false;
}

/** Het aantal plekken in het bestand met GPS: een TIFF-kop met GPS-wijzer, of XMP-GPS. */
export function gpsAnywhere(b: Uint8Array): number {
  let hits = 0;
  for (let i = 0; i + 8 <= b.length; i++) if (tiffHasGps(b, i)) hits++;
  const ascii = new TextDecoder("latin1").decode(b);
  hits += (ascii.match(/GPSLatitude|GPSLongitude/g) ?? []).length;
  return hits;
}

/** Dezelfde vorm als vóór fix-cyclus 1, nu over het hele bestand. */
export function exifGps(b: Uint8Array): { isJpeg: boolean; hasGps: boolean } {
  return { isJpeg: isJpeg(b), hasGps: gpsAnywhere(b) > 0 };
}

// --- Wat staat er na het eerste beeld? ---------------------------------------------------

/**
 * Het aantal bytes na de EOI van het eerste beeld, of `null` als de structuur
 * niet te volgen is (geen JPEG, een lengte buiten het bestand, geen EOI).
 * Volgt alle scans (een progressieve JPEG heeft er meer, met tabellen ertussen).
 * In de beelddata is 0xFF gestuft (FF 00) of een RST-marker (FF D0–D7).
 */
export function afterFirstImage(b: Uint8Array): number | null {
  if (!isJpeg(b)) return null;
  let i = 2;
  for (;;) {
    while (i < b.length && b[i] === 0xff && b[i + 1] === 0xff) i++; // opvulbytes
    if (i + 1 >= b.length || b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xd9) return b.length - (i + 2);
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (i + 3 >= b.length) return null;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2 || i + 2 + len > b.length) return null;
    i += 2 + len;
    if (marker === 0xda) {
      for (;;) {
        if (i + 1 >= b.length) return null;
        if (b[i] === 0xff) {
          const n = b[i + 1]!;
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
    }
  }
}

/**
 * De beelddata van het eerste beeld: van de eerste SOS-marker tot en met de
 * EOI. Een schoonmaker die alleen metadata weghaalt, laat dit stuk heel.
 */
export function imageData(b: Uint8Array): Uint8Array {
  let i = 2;
  while (i + 3 < b.length && b[i] === 0xff && b[i + 1] !== 0xda) i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
  const after = afterFirstImage(b);
  if (after === null || b[i + 1] !== 0xda) throw new Error("imageData: geen te volgen JPEG");
  return b.subarray(i, b.length - after);
}

// --- Bestanden die de schoonmaker moet weerstaan (red-team RT2, RT3; audit S2, N4) ------

/** Het APP1-segment (met marker en lengte) van gps.jpg. */
export function gpsApp1(): Uint8Array {
  const len = (GPS_JPEG[4]! << 8) | GPS_JPEG[5]!;
  return GPS_JPEG.subarray(2, 4 + len);
}

/** De TIFF-blok (zonder "Exif\0\0") met de GPS van gps.jpg. */
export function gpsTiff(): Uint8Array {
  return gpsApp1().subarray(10);
}

/** gps.jpg twee keer achter elkaar: een tweede beeld met eigen EXIF en GPS (RT2). */
export const TWIN = concat(GPS_JPEG, GPS_JPEG);

/** gps.jpg met daarna een trailer met nog een EXIF-blok (zoals een motion photo). */
export const TRAILER = concat(GPS_JPEG, "MotionPhoto_Data", gpsApp1());

/**
 * gps.jpg met een MPF-blok (APP2 "MPF\0", Multi-Picture Format van een camera)
 * na de EXIF, en daarna het tweede beeld waar het blok naar wijst.
 */
export const MPF = (() => {
  const mp = concat(
    "MPF\0",
    [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08], // TIFF, big-endian, IFD op 8
    [0x00, 0x01], // één tag
    [0xb0, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x04], // MPFVersion, UNDEFINED, 4
    "0100",
    [0x00, 0x00, 0x00, 0x00],
  );
  const app2 = concat([0xff, 0xe2, (mp.length + 2) >> 8, (mp.length + 2) & 0xff], mp);
  const app1 = gpsApp1();
  const head = 2 + app1.length;
  return concat(GPS_JPEG.subarray(0, head), app2, GPS_JPEG.subarray(head), GPS_JPEG);
})();

/** Eén opvulbyte (0x00) na SOI: een decoder slaat hem over, een strikte lezer niet (RT3). */
export const ODD_FILL = concat(GPS_JPEG.subarray(0, 2), [0x00], GPS_JPEG.subarray(2));

/** Rommel tussen twee segmenten, na de EXIF. */
export const ODD_GAP = (() => {
  const head = 2 + gpsApp1().length;
  return concat(GPS_JPEG.subarray(0, head), "rommel", GPS_JPEG.subarray(head));
})();

/** Een segment-lengte die buiten het bestand wijst, ná de EXIF. */
export const ODD_LENGTH = (() => {
  const head = 2 + gpsApp1().length;
  return concat(GPS_JPEG.subarray(0, head), [0xff, 0xe3, 0x7f, 0xff], "kort");
})();

/** gps.jpg zonder zijn EOI: halverwege afgebroken. */
export const TRUNCATED = GPS_JPEG.subarray(0, GPS_JPEG.length - 2);

// PNG met een eXIf-chunk met GPS (N4). De CRC's kloppen, zodat het een echte
// PNG is.
const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const v of b) c = CRC_TABLE[(c ^ v) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat(type, data);
  return concat(u32be(data.length), body, u32be(crc32(body)));
}

export const PNG_GPS = concat(
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  pngChunk("IHDR", new Uint8Array([...u32be(1), ...u32be(1), 8, 2, 0, 0, 0])),
  pngChunk("eXIf", gpsTiff()),
  pngChunk("IDAT", new Uint8Array([0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00])),
  pngChunk("IEND", new Uint8Array()),
);

/** Een HEIC-kop (ftyp heic) met daarna een EXIF-blok met GPS. */
export const HEIC_GPS = concat([0x00, 0x00, 0x00, 0x18], "ftypheic", [0, 0, 0, 0], "mif1heic", "Exif\0\0", gpsTiff());
