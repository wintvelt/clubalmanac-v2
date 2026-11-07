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
//
// sharp en heic-decode worden pas in de functie geladen: elke module in
// `convex/` wordt in de tests in de edge-runtime geladen (WP25 §Edge cases),
// en daar is geen native code of WASM nodig om te laden.

import type SharpModule from "sharp";

export const KLEIN_MAX = 512;
export const GROOT_MAX = 1600;
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
