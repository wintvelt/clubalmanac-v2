"use node";

// WP25 — de pixels van een formaat (invariant 6 en 18, A-kernvondst 1).
//
// Eén origineel in, twee JPEG's uit: *groot* (langste zijde hooguit 1600) en
// *klein* (hooguit 512), nooit opgeschaald. Een formaat bevat alleen pixels:
// sRGB, geen EXIF, geen ICC-profiel, geen oriëntatie-tag, transparantie wit,
// van een animatie het eerste beeld.
//
// De pixels worden NIET gedraaid. De stand komt terug als `exifOrientation`,
// ten opzichte van die ruwe pixels; de app past hem toe (WP8, WP17a inv. 4).
//   - JPEG, PNG, WebP, …: de tag uit het bestand (1–8), of geen.
//   - HEIC: geen. libheif past `irot`/`imir` bij het decoderen al toe, en een
//     HEIC van Apple draagt daarnaast nog de EXIF-tag. Die tag nog eens laten
//     gelden draait het beeld dubbel (kernvondst 1).
// `width`/`height` zijn de afmetingen van de gedecodeerde pixels op volle
// grootte, vóór de draaiing (bij HEIC dus al rechtop).
//
// Geheugen (spike): één decode per foto, *klein* uit *groot*. Piek ~260–390 MB
// bij 20 MB-originelen, onder de 512 MB van een Node-action. Eén foto tegelijk.
// Een HEIC decodeert naar RGBA in WASM en groeit met de pixels: boven
// HEIC_MAX_PIXELS valt de action om. De maat komt daarom eerst uit de kop, en
// een te grote HEIC wordt niet gedecodeerd (A-invariant 20, besluit 7).
//
// sharp en heic-decode worden pas in de functie geladen: elke module in
// `convex/` wordt in de tests in de edge-runtime geladen (WP25 §Edge cases),
// en daar is geen native code of WASM nodig om te laden.

import type SharpModule from "sharp";

export const KLEIN_MAX = 512;
export const GROOT_MAX = 1600;
/**
 * 4032×3024 (12,2 MP) erdoor, 5712×4284 (24,5 MP) niet (A-invariant 20).
 * Gelijk aan scripts/wp25/prod-tel.mjs.
 *
 * Een vangnet, geen garantie: bij een vaste maat blijft een warme action onder
 * 512 MB, maar komt een grotere HEIC na kleinere in dezelfde action (3× 12 MP,
 * dan 2× 13 MP), dan loopt hij erboven (~585 MB op Convex). Invariant 21 vangt
 * dat op (foto voor foto, zo nodig mislukt en afgetekend). Prod heeft 0 HEIC's;
 * de echte oplossing is JPEG bij de upload (WP18).
 */
export const HEIC_MAX_PIXELS = 13_000_000;
const JPEG_OPTIONS = { quality: 80, mozjpeg: true } as const;
const WHITE = { r: 255, g: 255, b: 255 };

export type FormatImages = {
  klein: Uint8Array;
  groot: Uint8Array;
  width: number;
  height: number;
  exifOrientation?: number;
};

// HEIF-familie met HEVC-inhoud, herkend aan de eerste bytes (ISO-BMFF `ftyp`
// plus merk). AVIF (`avif`, `avis`) leest sharp zelf.
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

function isHeicLike(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  return ascii(4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(8, 12));
}

/** Kinderen van een ISO-BMFF-box tussen [start, end). */
function* boxes(b: Uint8Array, start: number, end: number) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o);
    const type = String.fromCharCode(...b.subarray(o + 4, o + 8));
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) return;
      size = Number(dv.getBigUint64(o + 8));
      header = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < header || o + size > end) return;
    yield { type, start: o + header, end: o + size };
    o += size;
  }
}

/**
 * De maat van het primaire beeld van een HEIF: de `ispe` van het item uit
 * `pitm` (bij tegels het `grid`-item, dus het hele beeld). `null` als de kop
 * die niet (leesbaar) bevat.
 */
export function heifSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const meta = [...boxes(b, 0, b.length)].find((x) => x.type === "meta");
  if (!meta) return null;
  const inner = [...boxes(b, meta.start + 4, meta.end)]; // meta is een full box
  const pitm = inner.find((x) => x.type === "pitm");
  const iprp = inner.find((x) => x.type === "iprp");
  if (!pitm || !iprp) return null;
  const primary = b[pitm.start] === 0 ? dv.getUint16(pitm.start + 4) : dv.getUint32(pitm.start + 4);
  const props = [...boxes(b, iprp.start, iprp.end)];
  const ipco = props.find((x) => x.type === "ipco");
  const ipma = props.find((x) => x.type === "ipma");
  if (!ipco || !ipma) return null;
  const list = [...boxes(b, ipco.start, ipco.end)];
  const version = b[ipma.start]!;
  const wideIndex = (b[ipma.start + 3]! & 1) === 1;
  let o = ipma.start + 4;
  const count = dv.getUint32(o);
  o += 4;
  for (let i = 0; i < count && o < ipma.end; i++) {
    const itemId = version < 1 ? dv.getUint16(o) : dv.getUint32(o);
    o += version < 1 ? 2 : 4;
    const n = b[o]!;
    o += 1;
    for (let j = 0; j < n; j++) {
      const index = wideIndex ? dv.getUint16(o) & 0x7fff : b[o]! & 0x7f;
      o += wideIndex ? 2 : 1;
      if (itemId !== primary || index === 0) continue;
      const prop = list[index - 1];
      if (prop?.type === "ispe" && prop.start + 12 <= prop.end) {
        return { width: dv.getUint32(prop.start + 4), height: dv.getUint32(prop.start + 8) };
      }
    }
  }
  return null;
}

/** Gooit als een HEIC te groot is om in de action te decoderen, of zijn maat onbekend is. */
function assertHeicFits(bytes: Uint8Array): void {
  const size = heifSize(bytes);
  if (!size || size.width <= 0 || size.height <= 0) throw new Error("HEIC: maat onbekend");
  const pixels = size.width * size.height;
  if (pixels > HEIC_MAX_PIXELS) {
    throw new Error(`te groot (${(pixels / 1e6).toFixed(1)} MP, grens ${HEIC_MAX_PIXELS / 1e6} MP)`);
  }
}

type Sharp = typeof SharpModule;
type RawInput = { data: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 };

async function loadSharp(): Promise<Sharp> {
  const mod = (await import("sharp")) as unknown as { default?: Sharp } & Sharp;
  const sharp = mod.default ?? mod;
  // Geen cache van decodes tussen aanroepen: een warme action verwerkt in de
  // backfill honderden foto's na elkaar.
  sharp.cache(false);
  return sharp;
}

/** HEIC → RGBA-pixels, al gedraaid volgens `irot`/`imir`. */
async function decodeHeic(bytes: Uint8Array): Promise<RawInput> {
  const mod = (await import("heic-decode")) as unknown as {
    default?: (o: { buffer: Uint8Array }) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
  } & ((o: { buffer: Uint8Array }) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>);
  const decode = mod.default ?? mod;
  const { width, height, data } = await decode({ buffer: bytes });
  return { data: Buffer.from(data.buffer, data.byteOffset, data.byteLength), width, height, channels: 4 };
}

function validOrientation(o: unknown): number | undefined {
  return typeof o === "number" && Number.isInteger(o) && o >= 1 && o <= 8 ? o : undefined;
}

/**
 * Maakt *klein* en *groot* uit de bytes van een origineel. Gooit bij bytes die
 * geen beeld zijn; dan is er geen formaat (invariant 18).
 */
export async function makeFormatImages(bytes: Uint8Array): Promise<FormatImages> {
  const sharp = await loadSharp();

  let source: ReturnType<Sharp>;
  let width: number;
  let height: number;
  let exifOrientation: number | undefined;

  let heic: RawInput | null = null;
  if (isHeicLike(bytes)) {
    assertHeicFits(bytes);
    try {
      heic = await decodeHeic(bytes);
    } catch {
      // Een HEIF-merk dat libheif niet leest (bv. AVIF onder `mif1`): sharp
      // probeert het hieronder.
      heic = null;
    }
  }

  if (heic) {
    source = sharp(heic.data, { raw: { width: heic.width, height: heic.height, channels: heic.channels } });
    width = heic.width;
    height = heic.height;
    exifOrientation = undefined;
  } else {
    // Alleen het eerste beeld van een animatie (`pages: 1` is de standaard).
    source = sharp(bytes, { pages: 1 });
    const meta = await source.metadata();
    if (!meta.width || !meta.height) throw new Error("geen beeld: afmetingen onbekend");
    width = meta.width;
    height = meta.height;
    exifOrientation = validOrientation(meta.orientation);
  }

  // Eén decode: *groot* als ruwe sRGB-pixels zonder alfa, zonder metadata.
  // Geen `.rotate()`: de pixels blijven zoals ze in het bestand staan.
  const grootRaw = await source
    .flatten({ background: WHITE })
    .toColourspace("srgb")
    .resize(GROOT_MAX, GROOT_MAX, { fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const raw = {
    width: grootRaw.info.width,
    height: grootRaw.info.height,
    channels: grootRaw.info.channels as 1 | 2 | 3 | 4,
  };
  const groot = await sharp(grootRaw.data, { raw }).jpeg(JPEG_OPTIONS).toBuffer();
  const klein = await sharp(grootRaw.data, { raw })
    .resize(KLEIN_MAX, KLEIN_MAX, { fit: "inside", withoutEnlargement: true })
    .jpeg(JPEG_OPTIONS)
    .toBuffer();

  return {
    klein: new Uint8Array(klein),
    groot: new Uint8Array(groot),
    width,
    height,
    ...(exifOrientation !== undefined ? { exifOrientation } : {}),
  };
}
