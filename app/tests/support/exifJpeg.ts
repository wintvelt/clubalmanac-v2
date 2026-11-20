// WP36: kleine JPEG's met een met de hand gebouwd EXIF-segment (APP1), voor de
// EXIF-lezer van de webapp. Alleen de kop: SOI, APP1, een APP0 erna en EOI. De
// lezer hoeft geen beelddata te decoderen; de echte foto's (gemaakt met sharp)
// staan in tests/fixtures/wp36/.
//
// Een TIFF-blok met IFD0 en, als gevraagd, de EXIF-IFD (0x8769) en de
// GPS-IFD (0x8825). Little-endian ("II") of big-endian ("MM"): camera's
// gebruiken allebei.

type Rational = [number, number];

export type ExifSpec = {
  bigEndian?: boolean;
  /** IFD0 0x0132: de wijzigingsdatum, niet de opnamedatum. */
  dateTime?: string;
  /** EXIF-IFD 0x9003. */
  dateTimeOriginal?: string;
  /** EXIF-IFD 0x9004 (exif-parser: CreateDate). */
  createDate?: string;
  orientation?: number;
  gps?: {
    latRef?: string;
    lat?: [Rational, Rational, Rational];
    lonRef?: string;
    lon?: [Rational, Rational, Rational];
  };
};

type Entry = { tag: number; type: number; count: number; data: number[] };

const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

function u16(v: number, be: boolean): number[] {
  return be ? [(v >> 8) & 0xff, v & 0xff] : [v & 0xff, (v >> 8) & 0xff];
}

function u32(v: number, be: boolean): number[] {
  const b = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  return be ? b : b.reverse();
}

function ascii(text: string): Entry["data"] {
  return [...[...text].map((c) => c.charCodeAt(0)), 0];
}

function rationals(values: Rational[], be: boolean): number[] {
  return values.flatMap(([n, d]) => [...u32(n, be), ...u32(d, be)]);
}

/** Eén IFD op `offset` (vanaf het begin van het TIFF-blok), met zijn data erachter. */
function ifd(entries: Entry[], offset: number, be: boolean): number[] {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const headerSize = 2 + sorted.length * 12 + 4;
  let dataAt = offset + headerSize;
  const head: number[] = [...u16(sorted.length, be)];
  const data: number[] = [];
  for (const e of sorted) {
    head.push(...u16(e.tag, be), ...u16(e.type, be), ...u32(e.count, be));
    if (e.data.length <= 4) {
      head.push(...e.data, ...new Array(4 - e.data.length).fill(0));
    } else {
      head.push(...u32(dataAt, be));
      data.push(...e.data);
      if (e.data.length % 2 === 1) data.push(0);
      dataAt = offset + headerSize + data.length;
    }
  }
  head.push(...u32(0, be));
  return [...head, ...data];
}

function sizeOf(entries: Entry[]): number {
  return (
    2 +
    entries.length * 12 +
    4 +
    entries.reduce((n, e) => n + (e.data.length > 4 ? e.data.length + (e.data.length % 2) : 0), 0)
  );
}

/** Het TIFF-blok (zonder "Exif\0\0"). */
export function tiff(spec: ExifSpec): Uint8Array {
  const be = spec.bigEndian === true;
  const exifEntries: Entry[] = [];
  if (spec.dateTimeOriginal !== undefined) {
    const d = ascii(spec.dateTimeOriginal);
    exifEntries.push({ tag: 0x9003, type: ASCII, count: d.length, data: d });
  }
  if (spec.createDate !== undefined) {
    const d = ascii(spec.createDate);
    exifEntries.push({ tag: 0x9004, type: ASCII, count: d.length, data: d });
  }
  const gpsEntries: Entry[] = [];
  const g = spec.gps;
  if (g?.latRef !== undefined) gpsEntries.push({ tag: 1, type: ASCII, count: 2, data: ascii(g.latRef) });
  if (g?.lat !== undefined) gpsEntries.push({ tag: 2, type: RATIONAL, count: 3, data: rationals(g.lat, be) });
  if (g?.lonRef !== undefined) gpsEntries.push({ tag: 3, type: ASCII, count: 2, data: ascii(g.lonRef) });
  if (g?.lon !== undefined) gpsEntries.push({ tag: 4, type: RATIONAL, count: 3, data: rationals(g.lon, be) });

  const ifd0: Entry[] = [];
  if (spec.orientation !== undefined) {
    ifd0.push({ tag: 0x0112, type: SHORT, count: 1, data: u16(spec.orientation, be) });
  }
  if (spec.dateTime !== undefined) {
    const d = ascii(spec.dateTime);
    ifd0.push({ tag: 0x0132, type: ASCII, count: d.length, data: d });
  }
  // Wijzers met een voorlopige waarde: de maat van IFD0 hangt er niet van af.
  if (exifEntries.length > 0) ifd0.push({ tag: 0x8769, type: LONG, count: 1, data: u32(0, be) });
  if (gpsEntries.length > 0) ifd0.push({ tag: 0x8825, type: LONG, count: 1, data: u32(0, be) });

  const ifd0At = 8;
  const exifAt = ifd0At + sizeOf(ifd0);
  const gpsAt = exifAt + (exifEntries.length > 0 ? sizeOf(exifEntries) : 0);
  for (const e of ifd0) {
    if (e.tag === 0x8769) e.data = u32(exifAt, be);
    if (e.tag === 0x8825) e.data = u32(gpsAt, be);
  }
  const bytes = [
    ...(be ? [0x4d, 0x4d] : [0x49, 0x49]),
    ...u16(42, be),
    ...u32(ifd0At, be),
    ...ifd(ifd0, ifd0At, be),
    ...(exifEntries.length > 0 ? ifd(exifEntries, exifAt, be) : []),
    ...(gpsEntries.length > 0 ? ifd(gpsEntries, gpsAt, be) : []),
  ];
  return new Uint8Array(bytes);
}

const APP0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];

/** SOI, APP1 met "Exif\0\0" + het TIFF-blok, APP0, EOI. */
export function exifJpeg(spec: ExifSpec): Uint8Array {
  const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff(spec)];
  const len = body.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...body, ...APP0, 0xff, 0xd9]);
}

/** Een JPEG zonder APP1. */
export function plainJpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...APP0, 0xff, 0xd9]);
}

/** Een APP1 met XMP (Adobe-naamruimte) en de gegeven tekst, na SOI. */
export function xmpJpeg(xml: string): Uint8Array {
  const ns = [..."http://ns.adobe.com/xap/1.0/\0"].map((c) => c.charCodeAt(0));
  const body = [...ns, ...[...xml].map((c) => c.charCodeAt(0))];
  const len = body.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...body, ...APP0, 0xff, 0xd9]);
}

/** Graden, minuten, seconden als drie rationale getallen. */
export function dms(deg: number, min: number, secTimes100: number): [Rational, Rational, Rational] {
  return [
    [deg, 1],
    [min, 1],
    [secTimes100, 100],
  ];
}
