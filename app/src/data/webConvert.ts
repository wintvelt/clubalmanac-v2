import { fitWithin, type FailReason } from "../lib/upload";
import {
  WEB_HEAD_BYTES,
  imageSizeOfFile,
  isSafeToSend,
  profileSquare,
  tooManyPixels,
  webAssetId,
  webMetadataHeaders,
  webPickProblem,
} from "../lib/webPhoto";
import type { WebPhoto } from "./upload";

// WP36: kiezen en omzetten in de browser. Alleen voor het web: alleen
// `*.web.tsx`-bestanden en webPick.web.ts importeren dit, dus de iOS-bundel
// bevat het niet.
//
// - U9: de kiezer (`<input type="file" multiple accept="image/*">`) opent in
//   de tik zelf; een browser blokkeert hem daarna stil.
// - Vraag 2: een `<img>` decodeert rechtop (de EXIF-stand), dus niet zelf
//   draaien. In één stap tekenen op een canvas met de doelmaat (≤ 4032), op
//   wit (doorzichtig wordt wit), JPEG 0,85 zoals de app. Een canvas schrijft
//   geen EXIF; `isSafeToSend` controleert het toch (U4).
// - U6: één foto tegelijk omzetten; daarna het canvas leeg, de `<img>` los en
//   de `blob:`-URL vrij. Boven `WEB_MAX_PIXELS` (uit de kop) niet decoderen.
// - U7: een vaste id uit de maat en het begin van het bestand.

const JPEG_QUALITY = 0.85;
/** Zelfde grens als de backend (`MAX_UPLOAD_BYTES`, 15 MiB). */
const MAX_JPEG_BYTES = 15 * 1024 * 1024;
const THUMB_SIDE = 128;
const THUMB_QUALITY = 0.7;

/**
 * De kiezer van de browser. Roep hem aan in de tik zelf (U9). `null`:
 * geannuleerd. Een oudere browser meldt annuleren niet; dan blijft de belofte
 * open en staat de knop "Foto's kiezen" er nog.
 */
export function openFilePicker(multiple: boolean): Promise<File[] | null> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = multiple;
  input.style.display = "none";
  document.body.appendChild(input);
  return new Promise((resolve) => {
    const done = (files: File[] | null) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener(
      "change",
      () => {
        const files = input.files ? Array.from(input.files) : [];
        done(files.length > 0 ? files : null);
      },
      { once: true },
    );
    input.addEventListener("cancel", () => done(null), { once: true });
    input.click();
  });
}

/** `size` null: een JPEG zonder maat; weigeren, niet decoderen (U6). */
type HeadInfo = {
  assetId: string | null;
  headers: Record<string, string>;
  size: { width: number; height: number } | null;
};

async function readHead(file: File): Promise<HeadInfo> {
  try {
    const head = new Uint8Array(await file.slice(0, WEB_HEAD_BYTES).arrayBuffer());
    const size = await imageSizeOfFile(head, file.size, async (offset, length) =>
      new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
    );
    return { assetId: webAssetId(file.size, head), headers: webMetadataHeaders(head), size };
  } catch {
    return { assetId: null, headers: {}, size: { width: 0, height: 0 } };
  }
}

// Eén omzetting tegelijk (U6), ook met twee uploads tegelijk.
let queue: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

type Converted = Awaited<ReturnType<WebPhoto["prepare"]>>;

const fail = (reason: FailReason): Converted => ({ ok: false, reason });

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    } catch {
      resolve(null);
    }
  });
}

async function thumbOf(source: HTMLCanvasElement): Promise<string | null> {
  const thumb = document.createElement("canvas");
  try {
    const side = Math.min(source.width, source.height);
    thumb.width = THUMB_SIDE;
    thumb.height = THUMB_SIDE;
    const ctx = thumb.getContext("2d");
    if (!ctx || side <= 0) return null;
    ctx.drawImage(
      source,
      Math.floor((source.width - side) / 2),
      Math.floor((source.height - side) / 2),
      side,
      side,
      0,
      0,
      THUMB_SIDE,
      THUMB_SIDE,
    );
    const blob = await toBlob(thumb, THUMB_QUALITY);
    return blob ? URL.createObjectURL(blob) : null;
  } finally {
    thumb.width = 0;
    thumb.height = 0;
  }
}

async function convert(
  file: File,
  info: HeadInfo,
  profile: boolean,
  onThumb: ((url: string) => void) | undefined,
): Promise<Converted> {
  if (!info.size) return fail("formaat");
  if (tooManyPixels(info.size.width, info.size.height)) return fail("te_groot");
  const url = URL.createObjectURL(file);
  const img = new Image();
  const canvas = document.createElement("canvas");
  try {
    img.decoding = "async";
    img.src = url;
    try {
      await img.decode();
    } catch {
      // HEIC in Chrome, of een kapot bestand.
      return fail("formaat");
    }
    // Rechtop-maten: de browser past de EXIF-stand al toe.
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!(width > 0 && height > 0)) return fail("formaat");
    if (tooManyPixels(width, height)) return fail("te_groot");
    const src = profile ? profileSquare(width, height) : { originX: 0, originY: 0, width, height };
    const fit = fitWithin(src.width, src.height);
    canvas.width = fit.width;
    canvas.height = fit.height;
    const ctx = canvas.getContext("2d");
    // Geen canvas van deze maat: te weinig geheugen.
    if (!ctx) return fail("te_groot");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, fit.width, fit.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, src.originX, src.originY, src.width, src.height, 0, 0, fit.width, fit.height);
    // Het origineel is getekend: los.
    img.removeAttribute("src");
    URL.revokeObjectURL(url);
    if (onThumb) {
      const thumb = await thumbOf(canvas);
      if (thumb) onThumb(thumb);
    }
    const blob = await toBlob(canvas, JPEG_QUALITY);
    if (!blob) return fail("te_groot");
    if (blob.size > MAX_JPEG_BYTES) return fail("te_groot");
    // Een browser zonder JPEG-omzetter geeft PNG terug.
    if (blob.type !== "image/jpeg") return fail("formaat");
    // U4: fail-closed. Een canvas maakt geen EXIF; komt er toch GPS in, dan
    // gaat de foto niet.
    if (!isSafeToSend(new Uint8Array(await blob.arrayBuffer()))) return fail("locatie");
    return { ok: true, body: blob, headers: profile ? {} : info.headers };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    img.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}

export type WebPicked = {
  /** U7: vast per inhoud; null als het bestand niet te lezen is (dan een nieuwe id). */
  assetId: string | null;
  photo: WebPhoto;
};

/**
 * Een gekozen bestand als foto voor `useUploader`. Leest alleen de kop (id,
 * datum en plaats, maat); het omzetten gebeurt pas bij de upload, opnieuw bij
 * elke poging. De profielfoto (`profile`): een vierkant uit het midden (U8,
 * B6), zonder datum en plaats (U3). `onThumb`: een kleine tegel, gemaakt
 * tijdens het omzetten (U6); de ontvanger geeft de URL vrij.
 */
export async function webPhotoOf(
  file: File,
  opts: { profile: boolean; onThumb?: (url: string) => void },
): Promise<WebPicked> {
  const problem = webPickProblem(file);
  if (problem) {
    return { assetId: null, photo: { web: true, prepare: async () => fail(problem) } };
  }
  const info = await readHead(file);
  return {
    assetId: info.assetId,
    photo: { web: true, prepare: () => oneAtATime(() => convert(file, info, opts.profile, opts.onThumb)) },
  };
}
