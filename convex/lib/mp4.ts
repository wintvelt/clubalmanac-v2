// WP37: de backend bekijkt een filmpje zelf (invariant 2 en 7, A-invariant
// 12, 13, 25, 28–31). Puur, zonder Convex-runtime: `inspectMp4` krijgt het
// begin van het bestand zoals de backend het met een range-verzoek uit R2 leest,
// en ontleedt de index (`moov`): de duur, de sporen en de metadata.
// `videoProblem` zegt of het filmpje erin mag. Wat ná de index staat, loopt de
// route af met kleine range-verzoeken (`afterIndexHeader`, A-invariant 31).
//
// - Strikt lezen (A-invariant 28): wat de backend niet helemaal kan lezen,
//   weigert hij. In `moov`, `trak`, `mdia`, `minf`, `stbl` en `edts` moet elk
//   kind heel in zijn ouder passen en de ouder precies vullen. Vóór `moov`
//   alleen `ftyp`, `free`, `skip` en `wide`. Een onbekend kind in een van die
//   blokken wordt doorzocht op een locatie; een bekend containerblok op een
//   plek waar het niet hoort (of een tweede `mdia`), weigert hij. De diepte is
//   begrensd. Nooit een exception naar buiten: een fout is `geen_mp4`.
// - Index vooraan (A-invariant 25): staat de beelddata (`mdat`) eerder, of
//   valt de index buiten deze bytes, dan `index_achteraan`.
// - Locatie in elke vorm (A-invariant 13): `©xyz`, `loci`, "location",
//   "ISO6709" of "gps" in een metadata-blok of een onbekend blok; en een
//   metadata-spoor (toestemmingslijst, geen verbodslijst). De tabellen van de
//   sporen worden niet doorzocht.
// - Elk spoor telt (A-invariant 29) en de duur is de langste die het bestand
//   noemt: `mvhd`, en per spoor `tkhd` en `mdhd` (A-invariant 30). `mvhd` met
//   duur 0 of een gefragmenteerd bestand (`mvex`): weigeren.

import { MAX_VIDEO_BYTES, videoTooLong } from "./constants";

export type Mp4Track = { handler: string; codec: string };

export type Mp4Info = {
  /** Het hoofdmerk uit `ftyp` (`mp42`, `isom`, `qt  `, …). */
  brand: string;
  /** De langste duur in het bestand, afgerond op de milliseconde. */
  durationMs: number;
  /** Het eerste beeldspoor: codec (`avc1`, `hvc1`, …) en maat uit `tkhd`. */
  video: { codec: string; width: number; height: number } | null;
  /** Het eerste geluidsspoor (`mp4a`, …). */
  audio: { codec: string } | null;
  /** Elk spoor, met zijn soort (`vide`, `soun`, …) en codec. */
  tracks: Mp4Track[];
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
/** De blokken die strikt gelezen worden. Elders dan op hun plek: weigeren. */
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "mvex", "moof", "traf"]);
/** Vóór de index op het hoogste niveau (na `ftyp`). */
const BEFORE_INDEX = new Set(["free", "skip", "wide"]);
/** Na de index op het hoogste niveau (A-invariant 31). */
export const AFTER_INDEX = new Set(["mdat", "free", "skip"]);
const MAX_DEPTH = 8;

type Box = { type: string; start: number; payload: number; end: number };
type BoxRead = Box | "short" | "bad";

/** Intern: weigeren met een reden. Komt nooit buiten `inspectMp4`. */
class Refusal extends Error {
  constructor(readonly reason: "geen_mp4" | "index_achteraan") {
    super(reason);
  }
}

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
 * (een blok dat hier niet heel staat). Grootte 0 op het hoogste niveau: tot
 * het einde van het bestand (onbekend, oneindig); dieper is dat ongeldig.
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
    if (!topLevel) return "bad";
    return { type, start: offset, payload: offset + header, end: Number.POSITIVE_INFINITY };
  }
  if (size < header) return "bad";
  return { type, start: offset, payload: offset + header, end: offset + size };
}

/** De kinderen van een strikt blok: elk heel erin, en samen precies het blok. */
function strictChildren(b: Uint8Array, parent: Box): Box[] {
  const out: Box[] = [];
  let offset = parent.payload;
  while (offset < parent.end) {
    const box = readBox(b, offset, parent.end, false);
    if (typeof box === "string" || box.end > parent.end) throw new Refusal("geen_mp4");
    out.push(box);
    offset = box.end;
  }
  if (offset !== parent.end) throw new Refusal("geen_mp4");
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

/** Het leesresultaat van de index; `location` gaat mee naar `hasLocation`. */
type State = { location: boolean; maxMs: number; timescale: number };

/** Een kind dat de lijst van zijn ouder niet kent: een container is fout, de rest doorzoeken. */
function unknownChild(b: Uint8Array, box: Box, s: State): void {
  if (CONTAINERS.has(box.type)) throw new Refusal("geen_mp4");
  if (mentionsLocation(b, box.start, box.end)) s.location = true;
}

function durationMs(duration: number, timescale: number): number {
  return timescale > 0 ? Math.round((duration * 1000) / timescale) : 0;
}

type Track = { handler: string | null; codec: string | null; width: number; height: number };

function parseTrack(b: Uint8Array, trak: Box, s: State, depth: number): Track {
  const track: Track = { handler: null, codec: null, width: 0, height: 0 };
  let mdia = 0;
  let tkhd = 0;
  const leafs = new Set(["tref", "tapt", "load", "imap", "clip", "matt", "kmat"]);

  const visit = (box: Box, parent: string, level: number): void => {
    if (level > MAX_DEPTH) throw new Refusal("geen_mp4");
    if (METADATA_BOXES.has(box.type)) {
      if (mentionsLocation(b, box.start, box.end)) s.location = true;
      return;
    }
    switch (`${parent}/${box.type}`) {
      case "trak/tkhd": {
        tkhd += 1;
        const version = b[box.payload];
        const len = box.end - box.payload;
        if (tkhd > 1 || len < 84) throw new Refusal("geen_mp4");
        const dur = version === 1 ? u64(b, box.payload + 28) : u32(b, box.payload + 20);
        s.maxMs = Math.max(s.maxMs, durationMs(dur, s.timescale));
        // Breedte en hoogte (16.16) zijn de laatste acht bytes, in versie 0 en 1.
        track.width = Math.floor(u32(b, box.end - 8) / 65536);
        track.height = Math.floor(u32(b, box.end - 4) / 65536);
        return;
      }
      case "trak/mdia":
        mdia += 1;
        if (mdia > 1) throw new Refusal("geen_mp4");
        for (const child of strictChildren(b, box)) visit(child, "mdia", level + 1);
        return;
      case "trak/edts":
        for (const child of strictChildren(b, box)) visit(child, "edts", level + 1);
        return;
      case "edts/elst":
        return;
      case "mdia/mdhd": {
        const version = b[box.payload];
        const need = version === 1 ? 32 : 20;
        if (box.payload + need > box.end) throw new Refusal("geen_mp4");
        const timescale = version === 1 ? u32(b, box.payload + 20) : u32(b, box.payload + 12);
        const dur = version === 1 ? u64(b, box.payload + 24) : u32(b, box.payload + 16);
        s.maxMs = Math.max(s.maxMs, durationMs(dur, timescale));
        return;
      }
      case "mdia/hdlr":
        if (box.payload + 12 > box.end) throw new Refusal("geen_mp4");
        track.handler = ascii(b, box.payload + 8, box.payload + 12);
        return;
      case "mdia/minf":
        for (const child of strictChildren(b, box)) visit(child, "minf", level + 1);
        return;
      case "minf/stbl":
        for (const child of strictChildren(b, box)) visit(child, "stbl", level + 1);
        return;
      case "stbl/stsd": {
        const entry = box.payload + 8;
        if (entry + 8 > box.end) throw new Refusal("geen_mp4");
        track.codec = ascii(b, entry + 4, entry + 8);
        return;
      }
      default:
        if (parent === "trak" && leafs.has(box.type)) return;
        // In QuickTime heeft `minf` een eigen hdlr (de data-handler): geen soort spoor.
        if (parent === "minf" && /^(vmhd|smhd|nmhd|gmhd|hmhd|sthd|dinf|hdlr)$/.test(box.type)) return;
        if (parent === "mdia" && box.type === "elng") return;
        if (parent === "stbl" && box.type !== "stsd" && !CONTAINERS.has(box.type)) return;
        unknownChild(b, box, s);
    }
  };
  for (const child of strictChildren(b, trak)) visit(child, "trak", depth + 1);
  if (mdia !== 1 || tkhd !== 1) throw new Refusal("geen_mp4");
  return track;
}

/** De top-level blokken tot en met de index. */
function findIndex(b: Uint8Array): { brand: string; moov: Box; before: Box[] } {
  const first = readBox(b, 0, b.length, true);
  if (typeof first === "string" || first.type !== "ftyp" || first.end > b.length || first.end - first.start < 16) {
    throw new Refusal("geen_mp4");
  }
  const brand = ascii(b, first.payload, first.payload + 4);
  const before: Box[] = [];
  let offset = first.end;
  for (let n = 0; n < 64; n++) {
    const box = readBox(b, offset, b.length, true);
    if (box === "short") throw new Refusal("index_achteraan");
    if (box === "bad") throw new Refusal("geen_mp4");
    if (box.type === "mdat") throw new Refusal("index_achteraan");
    if (box.end > b.length) throw new Refusal("index_achteraan");
    if (box.type === "moov") return { brand, moov: box, before };
    if (!BEFORE_INDEX.has(box.type)) throw new Refusal("geen_mp4");
    before.push(box);
    offset = box.end;
  }
  throw new Refusal("geen_mp4");
}

/**
 * Waar de index eindigt, als hij vooraan staat (voor het range-verzoek); ook
 * als dat voorbij deze bytes ligt. `null`: geen mp4, of de beelddata komt eerst.
 */
export function mp4IndexEnd(b: Uint8Array): number | null {
  const first = readBox(b, 0, b.length, true);
  if (typeof first === "string" || first.type !== "ftyp") return null;
  let offset = first.end;
  for (let n = 0; n < 64; n++) {
    const box = readBox(b, offset, b.length, true);
    if (typeof box === "string" || box.type === "mdat") return null;
    if (box.type === "moov") return Number.isFinite(box.end) ? box.end : null;
    if (!Number.isFinite(box.end)) return null;
    offset = box.end;
  }
  return null;
}

function inspect(b: Uint8Array): Mp4Info {
  const { brand, moov, before } = findIndex(b);
  const s: State = { location: false, maxMs: 0, timescale: 0 };
  for (const box of before) if (mentionsLocation(b, box.start, box.end)) s.location = true;

  const children = strictChildren(b, moov);
  const mvhds = children.filter((c) => c.type === "mvhd");
  if (mvhds.length !== 1) throw new Refusal("geen_mp4");
  const mvhd = mvhds[0]!;
  const version = b[mvhd.payload];
  if (mvhd.payload + (version === 1 ? 32 : 20) > mvhd.end) throw new Refusal("geen_mp4");
  s.timescale = version === 1 ? u32(b, mvhd.payload + 20) : u32(b, mvhd.payload + 12);
  const movieDuration = version === 1 ? u64(b, mvhd.payload + 24) : u32(b, mvhd.payload + 16);
  if (s.timescale === 0 || movieDuration === 0) throw new Refusal("geen_mp4");
  s.maxMs = durationMs(movieDuration, s.timescale);

  const tracks: Mp4Track[] = [];
  let video: Mp4Info["video"] = null;
  let audio: Mp4Info["audio"] = null;
  for (const box of children) {
    switch (box.type) {
      case "mvhd":
      case "iods":
        break;
      case "mvex":
        // Gefragmenteerd: de index zegt niet wat er komt (A-invariant 30).
        throw new Refusal("geen_mp4");
      case "trak": {
        const t = parseTrack(b, box, s, 1);
        if (t.handler === null) throw new Refusal("geen_mp4");
        const codec = t.codec ?? "";
        tracks.push({ handler: t.handler, codec });
        if (t.handler === "vide" && !video) video = { codec, width: t.width, height: t.height };
        else if (t.handler === "soun" && !audio) audio = { codec };
        else if (t.handler !== "vide" && t.handler !== "soun") {
          // Een metadata-spoor (of iets anders dan beeld en geluid): wat erin
          // staat, weten we niet, dus het telt als locatie (A-invariant 13).
          s.location = true;
        }
        break;
      }
      default:
        if (METADATA_BOXES.has(box.type)) {
          if (mentionsLocation(b, box.start, box.end)) s.location = true;
        } else {
          unknownChild(b, box, s);
        }
    }
  }
  return { brand, durationMs: s.maxMs, video, audio, tracks, hasLocation: s.location };
}

/** Bekijk het begin van een filmpje (zie de kop van dit bestand). Gooit nooit. */
export function inspectMp4(b: Uint8Array): Mp4Inspection {
  try {
    return { ok: true, info: inspect(b) };
  } catch (e) {
    return { ok: false, reason: e instanceof Refusal ? e.reason : "geen_mp4" };
  }
}

/** Mag dit filmpje erin? `null`, of één reden (A-invariant 12, 29). */
export function videoProblem(inspection: Mp4Inspection, sizeBytes: number): VideoProblem | null {
  if (!inspection.ok) return inspection.reason;
  const info = inspection.info;
  if (!MP4_BRANDS.has(info.brand)) return "geen_mp4";
  if (sizeBytes > MAX_VIDEO_BYTES) return "te_groot";
  if (videoTooLong(info.durationMs)) return "te_lang";
  const tracks = info.tracks ?? [];
  const videos = tracks.filter((t) => t.handler === "vide");
  if (videos.length !== 1 || !H264.has(videos[0]!.codec)) return "codec";
  if (tracks.some((t) => t.handler === "soun" && t.codec !== AAC)) return "codec";
  if (info.hasLocation) return "locatie";
  return null;
}

/**
 * A-invariant 31: één kop op het hoogste niveau ná de index, gelezen op
 * `offset` (hooguit 16 bytes). `size` is de grootte van het object. Geeft het
 * einde van het blok, of `null` als het er niet mag staan of niet klopt.
 */
export function afterIndexHeader(head: Uint8Array, offset: number, size: number): number | null {
  if (head.byteLength < 8 || offset + 8 > size) return null;
  let boxSize = u32(head, 0);
  const type = ascii(head, 4, 8);
  let header = 8;
  if (boxSize === 1) {
    if (head.byteLength < 16) return null;
    boxSize = u64(head, 8);
    header = 16;
  } else if (boxSize === 0) {
    boxSize = size - offset;
  }
  if (boxSize < header || !AFTER_INDEX.has(type)) return null;
  const end = offset + boxSize;
  return end <= size ? end : null;
}
