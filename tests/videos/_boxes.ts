// WP37 — met de hand gebouwde ISO-BMFF-blokken (mp4/mov), als onafhankelijke
// bron naast de testfilmpjes van AVFoundation. Alleen wat de controle in de
// backend leest: ftyp, mvhd, sporen (tkhd, hdlr, stsd), udta en meta.

export const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0) & 0xff);
export const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
export const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
export const u64 = (n: number) => [...u32(Math.floor(n / 2 ** 32)), ...u32(n % 2 ** 32)];
export const zeros = (n: number) => new Array<number>(n).fill(0);

/** Een blok: grootte, type (4 tekens, `\xa9` voor ©), inhoud. */
export function box(type: string, ...parts: (number[] | Uint8Array)[]): number[] {
  const body = parts.flatMap((p) => [...p]);
  return [...u32(8 + body.length), ...ascii(type), ...body];
}
export const full = (version: number, flags = 0) => [version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff];

export function ftyp(brand: string): number[] {
  return box("ftyp", ascii(brand), u32(0), ascii(brand), ascii("isom"));
}
export function mvhd(timescale: number, duration: number, version = 0): number[] {
  const times = version === 1 ? [...u64(0), ...u64(0), ...u32(timescale), ...u64(duration)] : [...u32(0), ...u32(0), ...u32(timescale), ...u32(duration)];
  return box("mvhd", full(version), times, u32(0x00010000), u16(0x0100), zeros(10), zeros(36), zeros(24), u32(3));
}
/** `duration` in de tijdschaal van de film (mvhd). */
export function tkhd(width: number, height: number, duration = 0): number[] {
  const matrix = [...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
  return box("tkhd", full(0, 3), u32(0), u32(0), u32(1), u32(0), u32(duration), zeros(8), u16(0), u16(0), u16(0), u16(0), matrix, u32(width * 65536), u32(height * 65536));
}
export function hdlr(handler: string): number[] {
  return box("hdlr", full(0), u32(0), ascii(handler), zeros(12), [0]);
}
export function stsd(entry: string): number[] {
  return box("stsd", full(0), u32(1), box(entry, zeros(8)));
}
export type TrakTiming = {
  /** mdhd: [tijdschaal, duur]. Standaard 1 ms, zodat de duur van de film uit mvhd komt. */
  mdhd?: [number, number];
  /** tkhd-duur in de tijdschaal van de film; standaard 0. */
  tkhdDuration?: number;
  /** Extra blokken in stbl, minf of mdia (ná de gewone kinderen). */
  stblExtra?: number[];
  minfExtra?: number[];
  mdiaExtra?: number[];
};
export function trak(handler: string, entry: string, extra: number[] = [], w = 108, h = 192, timing: TrakTiming = {}): number[] {
  const [ts, dur] = timing.mdhd ?? [1000, 1];
  const mdhd = box("mdhd", full(0), u32(0), u32(0), u32(ts), u32(dur), u16(0x55c4), u16(0));
  const stbl = box("stbl", stsd(entry), timing.stblExtra ?? []);
  const minf = box("minf", stbl, timing.minfExtra ?? []);
  return box("trak", tkhd(w, h, timing.tkhdDuration ?? 0), box("mdia", mdhd, hdlr(handler), minf, timing.mdiaExtra ?? []), extra);
}

/** Losse bytes: een kop die zegt "4 bytes groot" (kleiner dan een kop kan zijn). */
export const BAD_SIZE = [...u32(4), ...ascii("junk")];

/** Bytes aan elkaar, als Uint8Array (voor grote bestanden zonder number[]-kopieën). */
export function bytes(...parts: (number[] | Uint8Array)[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Een groot blok met nullen (of met `tail` aan het eind), zonder number[]. */
export function bigBox(type: string, size: number, tail: number[] = []): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(size));
  out.set(u32(size), 0);
  out.set(ascii(type), 4);
  out.set(tail, size - tail.length);
  return out;
}

/**
 * `depth` blokken van type `type` in elkaar, met `inner` in het diepste.
 * Rechtstreeks in een Uint8Array: 60.000 lagen zijn 480 kB.
 */
export function nested(type: string, depth: number, inner: number[] = []): Uint8Array<ArrayBuffer> {
  const total = depth * 8 + inner.length;
  const out = new Uint8Array(new ArrayBuffer(total));
  const t = ascii(type);
  for (let i = 0; i < depth; i++) {
    out.set(u32(total - i * 8), i * 8);
    out.set(t, i * 8 + 4);
  }
  out.set(inner, depth * 8);
  return out;
}
/** QuickTime-metadata: `meta` met hdlr `mdta` en `keys`. */
export function mdtaMeta(...keys: string[]): number[] {
  const entries = keys.flatMap((k) => box("mdta", ascii(k)));
  return box("meta", hdlr("mdta"), box("keys", full(0), u32(keys.length), entries));
}
export function mdat(content: number[] = zeros(64)): number[] {
  return box("mdat", content);
}

export type Opts = {
  brand?: string;
  timescale?: number;
  duration?: number;
  mvhdVersion?: number;
  tracks?: number[][];
  moovExtra?: number[][];
  /** Blokken tussen ftyp en moov. */
  beforeMoov?: number[][];
  after?: number[];
  mdatFirst?: boolean;
};
export function movie(o: Opts = {}): Uint8Array<ArrayBuffer> {
  const tracks = o.tracks ?? [trak("vide", "avc1"), trak("soun", "mp4a")];
  const moov = box("moov", mvhd(o.timescale ?? 600, o.duration ?? 1200, o.mvhdVersion ?? 0), ...tracks, ...(o.moovExtra ?? []));
  const head = [ftyp(o.brand ?? "mp42"), ...(o.beforeMoov ?? [])];
  const parts = o.mdatFirst ? [...head, mdat(), moov] : [...head, moov, o.after ?? mdat()];
  return bytes(...parts);
}

/** ftyp + moov (zoals `movie`, zonder beelddata), om zelf iets achter te zetten. */
export function movieHead(o: Omit<Opts, "after" | "mdatFirst"> = {}): Uint8Array<ArrayBuffer> {
  return movie({ ...o, after: [] });
}

