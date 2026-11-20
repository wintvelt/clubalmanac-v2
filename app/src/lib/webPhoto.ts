// WP36: de pure logica achter uploaden in de browser. Geen DOM, geen React;
// het omzetten op een canvas staat in src/data/webPick.web.ts.
//
// - U3 `webMetadataHeaders`: datum en plaats uit de EXIF van het gekozen
//   bestand, als dezelfde headers als de iPhone-app.
// - U4 `isSafeToSend`: de controle over het héle bestand vóór het versturen.
// - U5 `webPickProblem`: een reden per bestand, vóór het decoderen.
// - U6 `WEB_MAX_PIXELS`, `tooManyPixels`, `imageHeaderSize`: de grens, uit de
//   kop van het bestand.
// - U7 `webAssetId`: een vaste id uit de inhoud.
// - U8 `profileSquare`: het vierkant uit het midden voor de profielfoto.
//
// Spec: docs/work-packages/WP36-webapp-uploaden.md §Spec-criticus aanvullingen.

/** Hoeveel van het begin van een bestand de webapp leest: EXIF, kop en id. */
export const WEB_HEAD_BYTES = 128 * 1024;

/** B3: boven dit aantal pixels "te groot", zonder te decoderen. 50 MP kan. */
export const WEB_MAX_PIXELS = 100_000_000;

export function tooManyPixels(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  return width * height > WEB_MAX_PIXELS;
}

// --- Bytes lezen, altijd binnen de grenzen -----------------------------------

class Reader {
  private readonly bytes: Uint8Array;
  private readonly base: number;
  private readonly end: number;
  readonly bigEndian: boolean;

  constructor(bytes: Uint8Array, base: number, end: number, bigEndian: boolean) {
    this.bytes = bytes;
    this.base = base;
    this.end = end;
    this.bigEndian = bigEndian;
  }

  has(offset: number, length: number): boolean {
    return offset >= 0 && length >= 0 && this.base + offset + length <= this.end;
  }

  u8(offset: number): number {
    if (!this.has(offset, 1)) throw new RangeError("buiten het blok");
    return this.bytes[this.base + offset]!;
  }

  u16(offset: number): number {
    const a = this.u8(offset);
    const b = this.u8(offset + 1);
    return this.bigEndian ? (a << 8) | b : (b << 8) | a;
  }

  u32(offset: number): number {
    const a = this.u16(offset);
    const b = this.u16(offset + 2);
    return this.bigEndian ? a * 0x10000 + b : b * 0x10000 + a;
  }
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

type IfdEntry = { tag: number; type: number; count: number; valueOffset: number };

/** De velden van één IFD. `valueOffset`: waar de waarde staat (inline of via de wijzer). */
function readIfd(r: Reader, offset: number): IfdEntry[] {
  const n = r.u16(offset);
  const entries: IfdEntry[] = [];
  for (let i = 0; i < n; i += 1) {
    const at = offset + 2 + i * 12;
    if (!r.has(at, 12)) break;
    const tag = r.u16(at);
    const type = r.u16(at + 2);
    const count = r.u32(at + 4);
    const size = (TYPE_SIZE[type] ?? 0) * count;
    const valueOffset = size <= 4 ? at + 8 : r.u32(at + 8);
    entries.push({ tag, type, count, valueOffset });
  }
  return entries;
}

function asciiOf(r: Reader, e: IfdEntry | undefined): string | undefined {
  if (!e || e.type !== 2 || !r.has(e.valueOffset, e.count)) return undefined;
  let s = "";
  for (let i = 0; i < e.count; i += 1) {
    const c = r.u8(e.valueOffset + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function rationalsOf(r: Reader, e: IfdEntry | undefined): number[] | undefined {
  if (!e || e.type !== 5 || e.count < 3 || !r.has(e.valueOffset, 24)) return undefined;
  const out: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const num = r.u32(e.valueOffset + i * 8);
    const den = r.u32(e.valueOffset + i * 8 + 4);
    if (den === 0) return undefined;
    out.push(num / den);
  }
  return out;
}

/** Een TIFF-blok (na "Exif\0\0"), of null als de kop niet klopt. */
function tiffReader(bytes: Uint8Array, start: number, end: number): { r: Reader; ifd0: number } | null {
  if (start + 8 > end) return null;
  const a = bytes[start];
  const b = bytes[start + 1];
  let bigEndian: boolean;
  if (a === 0x49 && b === 0x49) bigEndian = false;
  else if (a === 0x4d && b === 0x4d) bigEndian = true;
  else return null;
  const r = new Reader(bytes, start, end, bigEndian);
  if (r.u16(2) !== 42) return null;
  return { r, ifd0: r.u32(4) };
}

const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

function startsWith(bytes: Uint8Array, at: number, sig: readonly number[]): boolean {
  if (at < 0 || at + sig.length > bytes.length) return false;
  for (let i = 0; i < sig.length; i += 1) if (bytes[at + i] !== sig[i]) return false;
  return true;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

type Segment = { marker: number; start: number; end: number };

/** De segmenten van een JPEG tot het beeld (SOS), binnen de gegeven bytes. */
function jpegSegments(bytes: Uint8Array): Segment[] {
  const out: Segment[] = [];
  if (!isJpeg(bytes)) return out;
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) break;
    const marker = bytes[p + 1]!;
    // Opvulling (0xFF 0xFF) overslaan.
    if (marker === 0xff) {
      p += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    // Markers zonder lengte.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    const length = (bytes[p + 2]! << 8) | bytes[p + 3]!;
    if (length < 2) break;
    const start = p + 4;
    const end = Math.min(p + 2 + length, bytes.length);
    out.push({ marker, start, end });
    p += 2 + length;
  }
  return out;
}

// --- U3: datum en plaats -------------------------------------------------------

const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_CREATE_DATE = 0x9004;

function degrees(dms: number[] | undefined, ref: string | undefined, negative: "S" | "W"): number | undefined {
  if (!dms) return undefined;
  const [d, m, s] = dms as [number, number, number];
  const value = d + m / 60 + s / 3600;
  if (!Number.isFinite(value)) return undefined;
  return ref?.trim().toUpperCase() === negative ? -value : value;
}

/**
 * U3: de headers `X-Taken-At`, `X-Latitude` en `X-Longitude` uit de EXIF van
 * een JPEG (het begin van het bestand is genoeg). Opnamedatum:
 * `DateTimeOriginal`, anders `CreateDate`; nooit de wijzigingsdatum. Plaats
 * alleen met breedte én lengte, binnen bereik, en niet 0/0 (wat de fotokiezer
 * van Android achterlaat). Wat niet te lezen is, gaat niet mee; nooit een fout.
 */
export function webMetadataHeaders(bytes: Uint8Array): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const app1 = jpegSegments(bytes).find((s) => s.marker === 0xe1 && startsWith(bytes, s.start, EXIF_ID));
    if (!app1) return headers;
    const tiff = tiffReader(bytes, app1.start + EXIF_ID.length, app1.end);
    if (!tiff) return headers;
    const { r } = tiff;
    const ifd0 = readIfd(r, tiff.ifd0);
    const exifPtr = ifd0.find((e) => e.tag === TAG_EXIF_IFD);
    const gpsPtr = ifd0.find((e) => e.tag === TAG_GPS_IFD);

    if (exifPtr) {
      try {
        const exif = readIfd(r, r.u32(exifPtr.valueOffset));
        const pick = (tag: number) => asciiOf(r, exif.find((e) => e.tag === tag))?.trim();
        const taken = [pick(TAG_DATE_TIME_ORIGINAL), pick(TAG_CREATE_DATE)].find((v) => v !== undefined && v !== "");
        if (taken) headers["X-Taken-At"] = taken;
      } catch {
        // Een kapotte EXIF-IFD: geen datum.
      }
    }

    if (gpsPtr) {
      try {
        const gps = readIfd(r, r.u32(gpsPtr.valueOffset));
        const field = (tag: number) => gps.find((e) => e.tag === tag);
        const lat = degrees(rationalsOf(r, field(2)), asciiOf(r, field(1)), "S");
        const lon = degrees(rationalsOf(r, field(4)), asciiOf(r, field(3)), "W");
        if (
          lat !== undefined &&
          lon !== undefined &&
          Math.abs(lat) <= 90 &&
          Math.abs(lon) <= 180 &&
          !(lat === 0 && lon === 0)
        ) {
          headers["X-Latitude"] = String(lat);
          headers["X-Longitude"] = String(lon);
        }
      } catch {
        // Een kapotte GPS-IFD: geen plaats.
      }
    }
  } catch {
    return {};
  }
  return headers;
}

// --- U4: geen GPS in wat de browser verstuurt ---------------------------------

const XMP_GPS = ["GPSLatitude", "GPSLongitude", "GPSPosition", "GPSCoordinates"].map((s) =>
  Array.from(s, (c) => c.charCodeAt(0)),
);

/** Draagt een TIFF-blok een GPS-IFD? Fail-closed: een kapot blok telt als ja. */
function tiffHasGps(bytes: Uint8Array, start: number): boolean {
  try {
    const tiff = tiffReader(bytes, start, bytes.length);
    if (!tiff) return true;
    return readIfd(tiff.r, tiff.ifd0).some((e) => e.tag === TAG_GPS_IFD);
  } catch {
    return true;
  }
}

/**
 * U4: mag deze JPEG de deur uit? Alleen een JPEG, en nergens in het bestand
 * (ook niet na het beeld) een EXIF-blok met GPS of een GPS-veld in XMP. Een
 * stand-tag zonder GPS mag. Bij twijfel: nee.
 */
export function isSafeToSend(bytes: Uint8Array): boolean {
  if (!isJpeg(bytes)) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b === 0x45 && startsWith(bytes, i, EXIF_ID)) {
      if (tiffHasGps(bytes, i + EXIF_ID.length)) return false;
    } else if (b === 0x47 && XMP_GPS.some((sig) => startsWith(bytes, i, sig))) {
      return false;
    }
  }
  return true;
}

// --- U5: een reden per bestand, vóór het decoderen ----------------------------

const IMAGE_NAME = /\.(jpe?g|jfif|png|gif|webp|avif|heic|heif|bmp)$/i;
const NO_TYPE = new Set(["", "application/octet-stream"]);

/**
 * U5: "geen_foto" voor een bestand dat geen foto kan zijn (geen beeldtype,
 * een vector, leeg); anders null en beslist het decoderen. Zonder type telt
 * de naam.
 */
export function webPickProblem(file: { type: string; name: string; size: number }): "geen_foto" | null {
  if (!(file.size > 0)) return "geen_foto";
  const type = file.type.trim().toLowerCase();
  if (NO_TYPE.has(type)) return IMAGE_NAME.test(file.name.trim()) ? null : "geen_foto";
  if (!type.startsWith("image/")) return "geen_foto";
  if (type.startsWith("image/svg")) return "geen_foto";
  return null;
}

// --- U6: de maat uit de kop ---------------------------------------------------

/**
 * De maat in pixels uit de kop van een JPEG, PNG, GIF of WebP, zonder te
 * decoderen; `{0, 0}` als die niet in de gegeven bytes staat.
 */
export function imageHeaderSize(bytes: Uint8Array): { width: number; height: number } {
  const none = { width: 0, height: 0 };
  try {
    if (isJpeg(bytes)) {
      for (const s of jpegSegments(bytes)) {
        const sof = s.marker >= 0xc0 && s.marker <= 0xcf && s.marker !== 0xc4 && s.marker !== 0xc8 && s.marker !== 0xcc;
        if (sof && s.start + 5 <= s.end) {
          const height = (bytes[s.start + 1]! << 8) | bytes[s.start + 2]!;
          const width = (bytes[s.start + 3]! << 8) | bytes[s.start + 4]!;
          return { width, height };
        }
      }
      return none;
    }
    const be = new Reader(bytes, 0, bytes.length, true);
    const le = new Reader(bytes, 0, bytes.length, false);
    if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47]) && bytes.length >= 24) {
      return { width: be.u32(16), height: be.u32(20) };
    }
    if (startsWith(bytes, 0, [0x47, 0x49, 0x46, 0x38]) && bytes.length >= 10) {
      return { width: le.u16(6), height: le.u16(8) };
    }
    if (startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
      const chunk = String.fromCharCode(...bytes.subarray(12, 16));
      if (chunk === "VP8X" && bytes.length >= 30) {
        const w = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
        const h = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
        return { width: w, height: h };
      }
      if (chunk === "VP8 " && bytes.length >= 30) {
        return { width: le.u16(26) & 0x3fff, height: le.u16(28) & 0x3fff };
      }
      if (chunk === "VP8L" && bytes.length >= 25) {
        const bits = le.u32(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    return none;
  }
  return none;
}

// --- U7: een vaste id uit de inhoud -------------------------------------------

/**
 * U7: een id per foto uit de maat en het begin van de bytes (niet uit de naam
 * of de wijzigingsdatum). Twee onafhankelijke 32-bits hashes over de bytes.
 */
export function webAssetId(size: number, head: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9 ^ size;
  for (let i = 0; i < head.length; i += 1) {
    const b = head[i]!;
    h1 = Math.imul(h1 ^ b, 0x01000193);
    h2 = Math.imul(h2 ^ b, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return `web-${size.toString(36)}-${head.length.toString(36)}-${hex(h1)}${hex(h2)}`;
}

// --- U8: profielfoto ------------------------------------------------------------

/** U8 (B6): het grootste vierkant uit het midden van de rechtop-foto. */
export function profileSquare(
  width: number,
  height: number,
): { originX: number; originY: number; width: number; height: number } {
  const side = Math.min(width, height);
  return {
    originX: Math.floor((width - side) / 2),
    originY: Math.floor((height - side) / 2),
    width: side,
    height: side,
  };
}
