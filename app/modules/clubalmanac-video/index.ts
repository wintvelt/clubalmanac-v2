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

// WP38b: de uploader voor originelen (ios/OriginalUploader.swift).
export type PartDoneEvent = { originalId: string; partNumber: number; done: number; total: number };
export type PartFailedEvent = {
  originalId: string;
  /** De generatie van de links van de taak (fix-cyclus 1, punt 5). */
  generation: number;
  partNumber: number;
  status: number | null;
  code: string | null;
  /** Mislukte pogingen met de huidige link. */
  attempts: number;
};
export type AllPartsDoneEvent = { originalId: string; generation: number };
export type NativeNetwork = { type: string; expensive: boolean };

type Events = {
  onProgress: (event: { id: string; progress: number }) => void;
  onPartDone: (event: PartDoneEvent) => void;
  onPartFailed: (event: PartFailedEvent) => void;
  onAllPartsDone: (event: AllPartsDoneEvent) => void;
  onFileBroken: (event: { originalId: string }) => void;
  onNetwork: (event: NativeNetwork) => void;
};

export type KeptOriginal = { fileName: string; uri: string; bytes: number };
export type OriginalFileInfo = { uri: string; exists: boolean; bytes: number };
export type UploaderPartView = {
  partNumber: number;
  state: "wacht" | "bezig" | "klaar" | "mislukt";
  status: number | null;
  code: string | null;
  attempts: number;
  size: number;
  sent: number;
  updatedAt: number;
  session?: string;
};
export type UploaderJobView = {
  originalId: string;
  /** De generatie van de laatste links (0: van vóór de generaties). */
  generation: number;
  totalBytes: number;
  expiresAt: number;
  /** Het bewaarde bestand is weg of heeft een andere grootte. */
  broken: boolean;
  parts: UploaderPartView[];
};
export type UploaderSendInput = {
  originalId: string;
  fileName: string;
  generation: number;
  totalBytes: number;
  partSize: number;
  expiresAt: number;
  parts: { partNumber: number; offset: number; size: number; url: string }[];
};
export type UploaderLogEntry = { at: number; net: string; text: string };

declare class ClubalmanacVideoNative extends NativeModule<Events> {
  readMetadata(uri: string): Promise<VideoMetadata>;
  compress(uri: string, options: CompressOptions): Promise<CompressedVideo>;
  cancel(id: string): Promise<void>;
  makePoster(uri: string): Promise<Poster>;
  remove(uri: string): Promise<void>;
  /** WP39 besluit 10; ontbreekt in een build van vóór WP39. */
  pickerOnScreen?: () => Promise<boolean>;
  // WP38b; ontbreken in een build zonder de uploader.
  keepOriginal?: (uri: string) => Promise<KeptOriginal>;
  originalInfo?: (fileName: string) => Promise<OriginalFileInfo>;
  removeOriginal?: (fileName: string) => Promise<void>;
  listOriginals?: () => Promise<string[]>;
  originalSha256?: (fileName: string) => Promise<string>;
  freeBytes?: () => Promise<number | null>;
  partsBytes?: () => Promise<number>;
  networkStatus?: () => Promise<NativeNetwork>;
  readState?: (name: string) => Promise<string | null>;
  writeState?: (name: string, text: string) => Promise<void>;
  uploaderSend?: (job: UploaderSendInput) => Promise<void>;
  uploaderRetryPart?: (originalId: string, partNumber: number) => Promise<void>;
  uploaderForget?: (originalId: string) => Promise<void>;
  uploaderJobs?: () => Promise<string>;
  uploaderWifiOnly?: () => Promise<boolean>;
  uploaderSetWifiOnly?: (on: boolean) => Promise<void>;
  uploaderNote?: (text: string) => Promise<void>;
  uploaderLog?: (limit: number) => Promise<UploaderLogEntry[]>;
  uploaderClearLog?: () => Promise<void>;
  backgroundWorkBegin?: () => Promise<number>;
  backgroundWorkEnd?: (id: number) => Promise<void>;
  /** Alleen voor gate 6 (koud), op het proefscherm van een dev-build. */
  uploaderExitAfterBackgroundSend?: () => Promise<boolean>;
  uploaderSetExitAfterBackgroundSend?: (on: boolean) => Promise<void>;
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

// --- WP38b: originelen ------------------------------------------------------------
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38b.
// De runner (src/data/originals.ts) is de enige die de uploader aanstuurt.

/** Heeft deze build de uploader voor originelen? (De webapp en een oude build niet.) */
export const originalUploaderAvailable = native !== null && typeof native.uploaderSend === "function";

type Originals = Required<
  Pick<
    ClubalmanacVideoNative,
    | "keepOriginal"
    | "originalInfo"
    | "removeOriginal"
    | "listOriginals"
    | "originalSha256"
    | "freeBytes"
    | "partsBytes"
    | "networkStatus"
    | "readState"
    | "writeState"
    | "uploaderSend"
    | "uploaderRetryPart"
    | "uploaderForget"
    | "uploaderJobs"
    | "uploaderWifiOnly"
    | "uploaderSetWifiOnly"
    | "uploaderNote"
    | "uploaderLog"
    | "uploaderClearLog"
    | "backgroundWorkBegin"
    | "backgroundWorkEnd"
  >
>;

function originals(): Originals {
  if (!native || !originalUploaderAvailable) throw new Error("De uploader ontbreekt in deze build");
  return native as unknown as Originals;
}

/** 38b-2: de kopie van de kiezer naar een eigen map in Application Support (verplaatsen, niet kopiëren). */
export const keepOriginal = (uri: string) => originals().keepOriginal(uri);
export const originalInfo = (fileName: string) => originals().originalInfo(fileName);
export const removeOriginal = (fileName: string) => originals().removeOriginal(fileName);
export const listOriginals = () => originals().listOriginals();
/** SHA-256 (hex) van een bewaard origineel, streamend gelezen (proefscherm). */
export const originalSha256 = (fileName: string) => originals().originalSha256(fileName);
/** Vrije ruimte; `null` als iOS het niet zegt. */
export const freeBytes = () => originals().freeBytes();
export const partsBytes = () => originals().partsBytes();
export const networkStatus = () => originals().networkStatus();
export const readOriginalState = (name: string) => originals().readState(name);
export const writeOriginalState = (name: string, text: string) => originals().writeState(name, text);
export const uploaderSend = (job: UploaderSendInput) => originals().uploaderSend(job);
export const uploaderRetryPart = (originalId: string, partNumber: number) => originals().uploaderRetryPart(originalId, partNumber);
export const uploaderForget = (originalId: string) => originals().uploaderForget(originalId);
export const uploaderJobs = async (): Promise<UploaderJobView[]> => {
  const parsed = JSON.parse(await originals().uploaderJobs()) as { jobs?: UploaderJobView[] };
  return Array.isArray(parsed.jobs) ? parsed.jobs : [];
};
export const uploaderWifiOnly = () => originals().uploaderWifiOnly();
export const uploaderSetWifiOnly = (on: boolean) => originals().uploaderSetWifiOnly(on);
/** Een regel in het log van de uploader. Nooit een link, sleutel of pad (38b-16). */
export const uploaderNote = (text: string) => originals().uploaderNote(text);
export const uploaderLog = (limit: number) => originals().uploaderLog(limit);
export const uploaderClearLog = () => originals().uploaderClearLog();

/**
 * Gate 6, koud (alleen het proefscherm van een dev-build): stopt de app
 * zichzelf direct nadat hij op de achtergrond delen aan iOS gaf? Eén keer;
 * daarna staat hij weer uit. `null`: deze build kan het niet.
 */
export async function uploaderExitAfterBackgroundSend(): Promise<boolean | null> {
  if (!native?.uploaderExitAfterBackgroundSend) return null;
  return native.uploaderExitAfterBackgroundSend();
}

export async function uploaderSetExitAfterBackgroundSend(on: boolean): Promise<void> {
  if (!native?.uploaderSetExitAfterBackgroundSend) throw new Error("Deze build kan dat niet");
  await native.uploaderSetExitAfterBackgroundSend(on);
}

/** Houd de app even wakker op de achtergrond zolang `work` loopt (afronden met het scherm op slot). */
export async function withBackgroundWork<T>(work: () => Promise<T>): Promise<T> {
  let id = 0;
  try {
    id = await originals().backgroundWorkBegin();
  } catch {
    // Geen extra tijd: dan gewoon proberen.
  }
  try {
    return await work();
  } finally {
    if (id) void originals().backgroundWorkEnd(id).catch(() => {});
  }
}

/** Luister naar de events van de uploader; geeft een functie om te stoppen. */
export function listenUploader(handlers: {
  partDone?: (e: PartDoneEvent) => void;
  partFailed?: (e: PartFailedEvent) => void;
  allPartsDone?: (e: AllPartsDoneEvent) => void;
  fileBroken?: (e: { originalId: string }) => void;
  network?: (e: NativeNetwork) => void;
}): () => void {
  if (!native || !originalUploaderAvailable) return () => {};
  const subs = [
    handlers.partDone && native.addListener("onPartDone", handlers.partDone),
    handlers.partFailed && native.addListener("onPartFailed", handlers.partFailed),
    handlers.allPartsDone && native.addListener("onAllPartsDone", handlers.allPartsDone),
    handlers.fileBroken && native.addListener("onFileBroken", handlers.fileBroken),
    handlers.network && native.addListener("onNetwork", handlers.network),
  ];
  return () => {
    for (const s of subs) s?.remove();
  };
}
