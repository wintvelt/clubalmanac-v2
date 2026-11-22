import { requireOptionalNativeModule, type NativeModule } from "expo";

// WP37: de lokale Expo-module voor filmpjes (ios/ClubalmanacVideoModule.swift).
// Zonder de module (de webapp, een oude dev-build) is `videoModuleAvailable`
// false en weigert elke functie: de app meldt dan "verkleinen lukte niet".

export type VideoMetadata = {
  /** com.apple.quicktime.creationdate van het origineel, met tijdzone. */
  creationDate: string | null;
  /** ISO 6709, bv. "+52.3676+004.9041+000.000/". */
  location: string | null;
  durationMs: number | null;
};

export type CompressOptions = {
  /** Voor de voortgang en om te stoppen. */
  id: string;
  maxSide: number;
  videoBitrate: number;
  audioBitrate: number;
  maxFps: number;
};

export type CompressedVideo = { uri: string; bytes: number; durationMs: number; width: number; height: number };
export type Poster = { uri: string; width: number; height: number };

type Events = { onProgress: (event: { id: string; progress: number }) => void };

declare class ClubalmanacVideoNative extends NativeModule<Events> {
  readMetadata(uri: string): Promise<VideoMetadata>;
  compress(uri: string, options: CompressOptions): Promise<CompressedVideo>;
  cancel(id: string): Promise<void>;
  makePoster(uri: string): Promise<Poster>;
  remove(uri: string): Promise<void>;
  /** WP39 besluit 10; ontbreekt in een build van vóór WP39. */
  pickerOnScreen?: () => Promise<boolean>;
}

const native = requireOptionalNativeModule<ClubalmanacVideoNative>("ClubalmanacVideo");

export const videoModuleAvailable = native !== null;

function need(): ClubalmanacVideoNative {
  if (!native) throw new Error("ClubalmanacVideo ontbreekt in deze build");
  return native;
}

export function readMetadata(uri: string): Promise<VideoMetadata> {
  return need().readMetadata(uri);
}

/** Comprimeer naar mp4; `onProgress` krijgt 0..1. */
export async function compress(
  uri: string,
  options: CompressOptions,
  onProgress?: (progress: number) => void,
): Promise<CompressedVideo> {
  const mod = need();
  const sub = onProgress
    ? mod.addListener("onProgress", (e) => {
        if (e.id === options.id) onProgress(e.progress);
      })
    : null;
  try {
    return await mod.compress(uri, options);
  } finally {
    sub?.remove();
  }
}

export function cancelCompress(id: string): Promise<void> {
  return native ? native.cancel(id) : Promise.resolve();
}

export function makePoster(uri: string): Promise<Poster> {
  return need().makePoster(uri);
}

/** Een tijdelijk bestand weg; een bestand dat er niet is, is ook weg. */
export function removeFile(uri: string): Promise<void> {
  return native ? native.remove(uri).catch(() => {}) : Promise.resolve();
}

/**
 * WP39 besluit 10: staat er nog een fotokiezer over het scherm? `null` als de
 * build het niet kan zeggen (geen module, een build van vóór WP39, of een fout).
 */
export async function pickerOnScreen(): Promise<boolean | null> {
  if (!native || typeof native.pickerOnScreen !== "function") return null;
  try {
    return (await native.pickerOnScreen()) === true;
  } catch {
    return null;
  }
}
