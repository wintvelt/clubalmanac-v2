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
export function tkhd(width: number, height: number): number[] {
  const matrix = [...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
  return box("tkhd", full(0, 3), u32(0), u32(0), u32(1), u32(0), u32(0), zeros(8), u16(0), u16(0), u16(0), u16(0), matrix, u32(width * 65536), u32(height * 65536));
}
export function hdlr(handler: string): number[] {
  return box("hdlr", full(0), u32(0), ascii(handler), zeros(12), [0]);
}
export function stsd(entry: string): number[] {
  return box("stsd", full(0), u32(1), box(entry, zeros(8)));
}
export function trak(handler: string, entry: string, extra: number[] = [], w = 108, h = 192): number[] {
  const mdhd = box("mdhd", full(0), u32(0), u32(0), u32(600), u32(1200), u16(0x55c4), u16(0));
  return box("trak", tkhd(w, h), box("mdia", mdhd, hdlr(handler), box("minf", box("stbl", stsd(entry)))), extra);
}
/** QuickTime-metadata: `meta` met hdlr `mdta` en `keys`. */
export function mdtaMeta(...keys: string[]): number[] {
  const entries = keys.flatMap((k) => box("mdta", ascii(k)));
  return box("meta", hdlr("mdta"), box("keys", full(0), u32(keys.length), entries));
}
export function mdat(content: number[] = zeros(64)): number[] {
  return box("mdat", content);
}

export type Opts = { brand?: string; timescale?: number; duration?: number; mvhdVersion?: number; tracks?: number[][]; moovExtra?: number[][]; after?: number[]; mdatFirst?: boolean };
export function movie(o: Opts = {}): Uint8Array {
  const tracks = o.tracks ?? [trak("vide", "avc1"), trak("soun", "mp4a")];
  const moov = box("moov", mvhd(o.timescale ?? 600, o.duration ?? 1200, o.mvhdVersion ?? 0), ...tracks, ...(o.moovExtra ?? []));
  const parts = o.mdatFirst ? [ftyp(o.brand ?? "mp42"), mdat(), moov] : [ftyp(o.brand ?? "mp42"), moov, o.after ?? mdat()];
  return new Uint8Array(parts.flat());
}

