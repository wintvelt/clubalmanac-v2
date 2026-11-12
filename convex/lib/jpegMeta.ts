// WP17d besluit 2 (A-invariant 8): een JPEG zonder metadata voor het openbare
// profielpad. Een gemigreerd origineel draagt EXIF, met GPS (WP18). We halen
// elk segment weg dat een plek kan dragen: APP1 (EXIF en XMP), APP3–APP13
// (o.a. IPTC in APP13), APP15 en commentaar. Wat het beeld nodig heeft om goed
// te decoderen blijft: APP0 (JFIF), APP2 (ICC-profiel), APP14 (Adobe, voor de
// kleurtransformatie) en alle tabellen en beelddata.
//
// De stand (EXIF-tag 0x0112) gaat niet verloren: staat hij op 2..8, dan komt er
// een nieuw, minimaal EXIF-segment met alleen die tag. Zo blijft een los
// profielbeeld rechtop (A's waarschuwing in de spec).
//
// Pure functie zonder bibliotheek (Convex isolate-runtime). Een bestand dat
// niet met SOI begint, geeft `null`. Klopt de structuur verderop niet (een
// lengte buiten het bestand, geen marker waar er een hoort), dan gaat de rest
// ongewijzigd mee: een decoder leest daar ook geen segment meer, en de bekende
// metadata-segmenten staan bij echte camera- en telefoonbeelden ervoor.

const SOI = 0xd8;
const SOS = 0xda;
const EOI = 0xd9;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP14 = 0xee;
const COM = 0xfe;

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === SOI && bytes[2] === 0xff;
}

function keepSegment(marker: number): boolean {
  if (marker === COM) return false;
  if (marker >= APP0 && marker <= 0xef) {
    return marker === APP0 || marker === APP2 || marker === APP14;
  }
  return true;
}

/** De JPEG zonder metadata-segmenten, met alleen de stand terug. `null` = geen JPEG. */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return null;
  const kept: Uint8Array[] = [];
  let orientation: number | undefined;
  let afterApp0 = 0; // index in `kept` waar het stand-segment komt
  let i = 2;
  for (;;) {
    if (i >= bytes.length) break;
    const rest = () => kept.push(bytes.subarray(i));
    if (bytes[i] !== 0xff) {
      rest();
      break;
    }
    // Opvulbytes (0xFF 0xFF …) vóór een marker zijn toegestaan.
    let m = i + 1;
    while (m < bytes.length && bytes[m] === 0xff) m++;
    if (m >= bytes.length) {
      rest();
      break;
    }
    const marker = bytes[m]!;
    if (marker === EOI) {
      kept.push(bytes.subarray(m - 1, m + 1));
      break;
    }
    if (marker === SOS) {
      // Vanaf hier beelddata (en eventuele latere tabellen): ongewijzigd mee.
      kept.push(bytes.subarray(m - 1));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // Losse marker zonder lengte.
      kept.push(bytes.subarray(m - 1, m + 1));
      i = m + 1;
      continue;
    }
    const len = m + 2 < bytes.length ? (bytes[m + 1]! << 8) | bytes[m + 2]! : 0;
    const end = m + 1 + len;
    if (len < 2 || end > bytes.length) {
      rest();
      break;
    }
    if (marker === APP1 && orientation === undefined) {
      orientation = exifOrientation(bytes.subarray(m + 3, end));
    }
    if (keepSegment(marker)) {
      kept.push(bytes.subarray(m - 1, end));
      if (marker === APP0) afterApp0 = kept.length;
    }
    i = end;
  }
  if (orientation !== undefined && orientation >= 2 && orientation <= 8) {
    kept.splice(afterApp0, 0, orientationSegment(orientation));
  }
  const total = 2 + kept.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(total);
  out[0] = 0xff;
  out[1] = SOI;
  let o = 2;
  for (const s of kept) {
    out.set(s, o);
    o += s.length;
  }
  return out;
}

/** De stand uit IFD0 van een EXIF-segment (zonder marker en lengte), of undefined. */
function exifOrientation(seg: Uint8Array): number | undefined {
  const header = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  if (seg.length < 14 || header.some((v, k) => seg[k] !== v)) return undefined;
  const tiff = seg.subarray(6);
  const t = (k: number) => tiff[k] ?? 0;
  const little = t(0) === 0x49 && t(1) === 0x49;
  if (!little && !(t(0) === 0x4d && t(1) === 0x4d)) return undefined;
  const u16 = (o: number) => (little ? t(o) | (t(o + 1) << 8) : (t(o) << 8) | t(o + 1));
  const u32 = (o: number) =>
    little
      ? (t(o) | (t(o + 1) << 8) | (t(o + 2) << 16) | (t(o + 3) << 24)) >>> 0
      : ((t(o) << 24) | (t(o + 1) << 16) | (t(o + 2) << 8) | t(o + 3)) >>> 0;
  const ifd0 = u32(4);
  if (ifd0 + 2 > tiff.length) return undefined;
  const n = u16(ifd0);
  for (let k = 0; k < n; k++) {
    const entry = ifd0 + 2 + k * 12;
    if (entry + 12 > tiff.length) return undefined;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return Number.isInteger(value) ? value : undefined;
    }
  }
  return undefined;
}

/** Een APP1-segment met alleen de stand (big-endian TIFF, IFD0 met één tag). */
function orientationSegment(orientation: number): Uint8Array {
  const body = [
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, // "MM", 42
    0x00, 0x00, 0x00, 0x08, // IFD0 op 8
    0x00, 0x01, // één tag
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // 0x0112, SHORT, 1
    0x00, orientation, 0x00, 0x00, // waarde
    0x00, 0x00, 0x00, 0x00, // geen volgende IFD
  ];
  const len = body.length + 2;
  return new Uint8Array([0xff, APP1, len >> 8, len & 0xff, ...body]);
}
