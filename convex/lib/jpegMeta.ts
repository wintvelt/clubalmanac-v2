// WP17d: een JPEG zonder metadata voor de beeldpaden (besluit 2 en 4,
// A-invariant 8, 9 en 10). Een gemigreerd origineel draagt EXIF, met GPS
// (WP18). We houden alleen wat het beeld nodig heeft om goed te decoderen:
// APP0 (JFIF/JFXX), APP2 met een ICC-profiel, APP14 (Adobe, voor de
// kleurtransformatie) en alle tabellen en beelddata. Weg: APP1 (EXIF en XMP),
// APP2 met iets anders (o.a. MPF), APP3–APP13 (o.a. IPTC in APP13), APP15 en
// commentaar.
//
// De stand (EXIF-tag 0x0112) gaat niet verloren: staat hij op 2..8, dan komt er
// een nieuw, minimaal EXIF-segment met alleen die tag. Zo blijft een los
// profielbeeld rechtop.
//
// Fail-closed (besluit 4, A-invariant 10): de schoonmaker volgt elk segment en
// elke scan tot de EOI van het eerste beeld. Wat daarna komt (een tweede beeld,
// het MPF-beeld, een motion-photo-trailer) gaat niet mee. Klopt de structuur
// niet (geen SOI, een byte waar een marker hoort, een lengte buiten het
// bestand, geen EOI), dan geeft hij `null`: dan gaat er niets naar buiten.
//
// Pure functie zonder bibliotheek (Convex isolate-runtime).

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

function startsWith(seg: Uint8Array, text: string): boolean {
  if (seg.length < text.length) return false;
  for (let k = 0; k < text.length; k++) if (seg[k] !== text.charCodeAt(k)) return false;
  return true;
}

/** Blijft dit segment staan? `payload` is de inhoud zonder marker en lengte. */
function keepSegment(marker: number, payload: Uint8Array): boolean {
  if (marker === COM) return false;
  if (marker >= APP0 && marker <= 0xef) {
    if (marker === APP0) return startsWith(payload, "JFIF\0") || startsWith(payload, "JFXX\0");
    if (marker === APP2) return startsWith(payload, "ICC_PROFILE\0");
    if (marker === APP14) return startsWith(payload, "Adobe");
    return false;
  }
  return true;
}

/** RST0–RST7 en TEM: markers zonder lengte. */
function standalone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

/**
 * Het eerste beeld van de JPEG zonder metadata-segmenten, met alleen de stand
 * terug. `null` als het geen JPEG is of de structuur niet te volgen is.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return null;
  const kept: Uint8Array[] = [];
  let orientation: number | undefined;
  let afterApp0 = 0; // index in `kept` waar het stand-segment komt
  let i = 2;
  for (;;) {
    if (i >= bytes.length || bytes[i] !== 0xff) return null;
    // Opvulbytes (0xFF 0xFF …) vóór een marker zijn toegestaan.
    let m = i + 1;
    while (m < bytes.length && bytes[m] === 0xff) m++;
    if (m >= bytes.length) return null;
    const marker = bytes[m]!;
    if (marker === EOI) {
      kept.push(bytes.subarray(m - 1, m + 1));
      break;
    }
    if (marker === 0x00 || marker === SOI) return null;
    if (standalone(marker)) {
      kept.push(bytes.subarray(m - 1, m + 1));
      i = m + 1;
      continue;
    }
    if (m + 2 >= bytes.length) return null;
    const len = (bytes[m + 1]! << 8) | bytes[m + 2]!;
    const end = m + 1 + len;
    if (len < 2 || end > bytes.length) return null;
    const payload = bytes.subarray(m + 3, end);
    if (marker === APP1 && orientation === undefined) {
      orientation = exifOrientation(payload);
    }
    if (marker === SOS) {
      // Kop van de scan, daarna de beelddata tot de volgende echte marker. In
      // de beelddata is 0xFF gestuft (FF 00) of een RST-marker (FF D0–D7).
      let k = end;
      for (;;) {
        if (k + 1 >= bytes.length) return null;
        if (bytes[k] === 0xff) {
          const n = bytes[k + 1]!;
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) {
            k += 2;
            continue;
          }
          break;
        }
        k++;
      }
      kept.push(bytes.subarray(m - 1, k));
      i = k;
      continue;
    }
    if (keepSegment(marker, payload)) {
      kept.push(bytes.subarray(m - 1, end));
      if (marker === APP0) afterApp0 = kept.length;
    }
    i = end;
  }
  if (orientation !== undefined && orientation >= 2 && orientation <= 8) {
    kept.splice(afterApp0, 0, orientationSegment(orientation));
  }
  const total = 2 + kept.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
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
  if (seg.length < 14 || !startsWith(seg, "Exif\0\0")) return undefined;
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
    if (u16(entry) === 0x0112) return u16(entry + 8);
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
