// WP37: de backend bekijkt een filmpje zelf (invariant 2 en 7, A-invariant
// 12, 13 en 25). Puur, zonder Convex-runtime: `inspectMp4` krijgt het begin
// van het bestand zoals de backend het met een range-verzoek uit R2 leest, en
// ontleedt de index (`moov`): de duur (`mvhd`), de sporen (`tkhd`, `hdlr`,
// `stsd`) en de metadata. `videoProblem` zegt of het filmpje erin mag.
//
// - De index moet vooraan staan (A-invariant 25): staat de beelddata (`mdat`)
//   eerder, of valt de index buiten deze bytes, dan `index_achteraan`.
// - Locatie in elke vorm (A-invariant 13): `©xyz`, `loci`, een metadata-
//   sleutel met "location", en ook "ISO6709" of "gps" ergens in een
//   metadata-blok (`udta`, `meta`, `uuid`), op film- of spoor-niveau. Een
//   spoor dat geen beeld of geluid is (een metadata-spoor, ondertitels,
//   tijdcode), telt ook als locatie: een toestemmingslijst, geen
//   verbodslijst. De beelddata zelf en de tabellen van de sporen worden niet
//   doorzocht.
// - Nooit een exception op kapotte bytes: elke onleesbare vorm is een
//   weigering.

import { MAX_VIDEO_BYTES, videoTooLong } from "./constants";

export type Mp4Info = {
  /** Het hoofdmerk uit `ftyp` (`mp42`, `isom`, `qt  `, …). */
  brand: string;
  /** Uit `mvhd`, afgerond op de milliseconde. */
  durationMs: number;
  /** Het eerste beeldspoor: codec (`avc1`, `hvc1`, …) en maat uit `tkhd`. */
  video: { codec: string; width: number; height: number } | null;
  /** Het eerste geluidsspoor (`mp4a`, …). */
  audio: { codec: string } | null;
  hasLocation: boolean;
};

export type Mp4Inspection =
  | { ok: true; info: Mp4Info }
  | { ok: false; reason: "geen_mp4" | "index_achteraan" };

export type VideoProblem = "geen_mp4" | "index_achteraan" | "te_lang" | "te_groot" | "codec" | "locatie";

/** A-keuze: mp4-merken die overal spelen; QuickTime (`qt  `) niet. */
const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V "]);
/** H.264 (met de parameters in de sample-beschrijving of in de stroom). */
const H264 = new Set(["avc1", "avc3"]);
const AAC = "mp4a";

/** Blokken waarin metadata staat; hun bytes worden doorzocht op een locatie. */
const METADATA_BOXES = new Set(["udta", "meta", "uuid"]);

type Box = { type: string; start: number; payload: number; end: number };
type BoxRead = Box | "short" | "bad";

function ascii(b: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let i = from; i < to; i++) s += String.fromCharCode(b[i]!);
  return s;
}

function u32(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}

function u64(b: Uint8Array, at: number): number {
  return u32(b, at) * 2 ** 32 + u32(b, at + 4);
}

/**
 * Eén blok vanaf `offset`, binnen `limit`. `end` kan voorbij de bytes liggen
 * (een blok dat hier niet heel staat). Grootte 0: tot het einde van de
 * omgeving; op het hoogste niveau is dat onbekend (oneindig).
 */
function readBox(b: Uint8Array, offset: number, limit: number, topLevel: boolean): BoxRead {
  if (offset + 8 > limit) return "short";
  let size = u32(b, offset);
  const type = ascii(b, offset + 4, offset + 8);
  let header = 8;
  if (size === 1) {
    if (offset + 16 > limit) return "short";
    size = u64(b, offset + 8);
    header = 16;
  } else if (size === 0) {
    return { type, start: offset, payload: offset + header, end: topLevel ? Number.POSITIVE_INFINITY : limit };
  }
  if (size < header) return "bad";
  return { type, start: offset, payload: offset + header, end: offset + size };
}

/** De kinderen van een blok, zolang ze heel binnen het blok staan. */
function children(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let offset = from;
  while (offset + 8 <= to) {
    const box = readBox(b, offset, to, false);
    if (typeof box === "string" || box.end > to) break;
    out.push(box);
    offset = box.end;
  }
  return out;
}

const LOCATION_PATTERNS: number[][] = [
  [0xa9, 0x78, 0x79, 0x7a], // ©xyz
  ...["loci", "location", "iso6709", "gps"].map((s) => [...s].map((c) => c.charCodeAt(0))),
];

function lower(byte: number): number {
  return byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
}

/** Staat er in deze bytes (een metadata-blok) iets dat op een locatie wijst? */
function mentionsLocation(b: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    for (const p of LOCATION_PATTERNS) {
      if (i + p.length > to) continue;
      let hit = true;
      for (let j = 0; j < p.length; j++) {
        if (lower(b[i + j]!) !== p[j]) {
          hit = false;
          break;
        }
      }
      if (hit) return true;
    }
  }
  return false;
}

type Track = { handler: string | null; codec: string | null; width: number; height: number; hasLocation: boolean };

function parseTrack(b: Uint8Array, trak: Box): Track {
  const track: Track = { handler: null, codec: null, width: 0, height: 0, hasLocation: false };
  const visit = (box: Box, parent: string) => {
    if (METADATA_BOXES.has(box.type)) {
      if (mentionsLocation(b, box.start, box.end)) track.hasLocation = true;
      return;
    }
    switch (box.type) {
      case "tkhd":
        // Breedte en hoogte (16.16) zijn de laatste acht bytes, in versie 0 en 1.
        if (box.end - box.payload >= 8) {
          track.width = Math.floor(u32(b, box.end - 8) / 65536);
          track.height = Math.floor(u32(b, box.end - 4) / 65536);
        }
        return;
      case "hdlr":
        // Alleen die van `mdia`: in QuickTime heeft `minf` een eigen hdlr
        // (de data-handler, bv. `alis`), die zegt niets over het spoor.
        if (parent === "mdia" && box.payload + 12 <= box.end) track.handler = ascii(b, box.payload + 8, box.payload + 12);
        return;
      case "stsd": {
        const entry = box.payload + 8;
        if (entry + 8 <= box.end) track.codec = ascii(b, entry + 4, entry + 8);
        return;
      }
      case "mdia":
      case "minf":
      case "stbl":
      case "edts":
        for (const child of children(b, box.payload, box.end)) visit(child, box.type);
        return;
      default:
        return;
    }
  };
  for (const child of children(b, trak.payload, trak.end)) visit(child, "trak");
  return track;
}

/** De top-level blokken tot en met de index. */
function findIndex(b: Uint8Array): { brand: string; moov: Box; before: Box[] } | "geen_mp4" | "index_achteraan" {
  const first = readBox(b, 0, b.length, true);
  if (typeof first === "string" || first.type !== "ftyp" || first.end > b.length || first.end - first.start < 16) {
    return "geen_mp4";
  }
  const brand = ascii(b, first.payload, first.payload + 4);
  const before: Box[] = [];
  let offset = first.end;
  for (;;) {
    const box = readBox(b, offset, b.length, true);
    if (box === "short") return "index_achteraan";
    if (box === "bad") return "geen_mp4";
    if (box.type === "mdat") return "index_achteraan";
    if (box.end > b.length) return "index_achteraan";
    if (box.type === "moov") return { brand, moov: box, before };
    before.push(box);
    offset = box.end;
  }
}

/**
 * Waar de index eindigt, als hij vooraan staat (voor het range-verzoek); ook
 * als dat voorbij deze bytes ligt. `null`: geen mp4, of de beelddata komt eerst.
 */
export function mp4IndexEnd(b: Uint8Array): number | null {
  const first = readBox(b, 0, b.length, true);
  if (typeof first === "string" || first.type !== "ftyp") return null;
  let offset = first.end;
  for (;;) {
    const box = readBox(b, offset, b.length, true);
    if (typeof box === "string" || box.type === "mdat") return null;
    if (box.type === "moov") return Number.isFinite(box.end) ? box.end : null;
    if (!Number.isFinite(box.end)) return null;
    offset = box.end;
  }
}

/** Bekijk het begin van een filmpje (zie de kop van dit bestand). */
export function inspectMp4(b: Uint8Array): Mp4Inspection {
  const found = findIndex(b);
  if (typeof found === "string") return { ok: false, reason: found };
  const { brand, moov, before } = found;

  let hasLocation = before.some((box) => METADATA_BOXES.has(box.type) && mentionsLocation(b, box.start, box.end));
  let durationMs: number | null = null;
  let video: Mp4Info["video"] = null;
  let audio: Mp4Info["audio"] = null;

  for (const box of children(b, moov.payload, moov.end)) {
    if (box.type === "mvhd") {
      const version = b[box.payload];
      const need = version === 1 ? 32 : 20;
      if (box.payload + need > box.end) continue;
      const timescale = version === 1 ? u32(b, box.payload + 20) : u32(b, box.payload + 12);
      const duration = version === 1 ? u64(b, box.payload + 24) : u32(b, box.payload + 16);
      if (timescale > 0) durationMs = Math.round((duration * 1000) / timescale);
    } else if (box.type === "trak") {
      const t = parseTrack(b, box);
      if (t.hasLocation) hasLocation = true;
      if (t.handler === "vide") {
        if (!video) video = { codec: t.codec ?? "", width: t.width, height: t.height };
      } else if (t.handler === "soun") {
        if (!audio) audio = { codec: t.codec ?? "" };
      } else {
        // Een metadata-spoor (of iets anders dan beeld en geluid): wat erin
        // staat, weten we niet, dus het telt als locatie (A-invariant 13).
        hasLocation = true;
      }
    } else if (METADATA_BOXES.has(box.type)) {
      if (mentionsLocation(b, box.start, box.end)) hasLocation = true;
    }
  }

  if (durationMs === null) return { ok: false, reason: "geen_mp4" };
  return { ok: true, info: { brand, durationMs, video, audio, hasLocation } };
}

/** Mag dit filmpje erin? `null`, of één reden (A-invariant 12). */
export function videoProblem(inspection: Mp4Inspection, sizeBytes: number): VideoProblem | null {
  if (!inspection.ok) return inspection.reason;
  const info = inspection.info;
  if (!MP4_BRANDS.has(info.brand)) return "geen_mp4";
  if (sizeBytes > MAX_VIDEO_BYTES) return "te_groot";
  if (videoTooLong(info.durationMs)) return "te_lang";
  if (!info.video || !H264.has(info.video.codec)) return "codec";
  if (info.audio && info.audio.codec !== AAC) return "codec";
  if (info.hasLocation) return "locatie";
  return null;
}
