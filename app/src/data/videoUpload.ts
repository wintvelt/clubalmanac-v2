import { useAuth } from "@clerk/expo";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { createUploadTask, FileSystemSessionType, FileSystemUploadType } from "expo-file-system/legacy";
import type { ImagePickerAsset } from "expo-image-picker";
import { useCallback, useRef } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  compress,
  makePoster,
  readMetadata,
  removeFile,
  videoModuleAvailable,
  type CompressedVideo,
  type Poster,
} from "../../modules/clubalmanac-video";
import { api } from "../convexApi";
import { UPLOAD_TIMEOUT_MS } from "../lib/upload";
import {
  finishOutcome,
  startRefusalReason,
  VIDEO_TARGET,
  videoMetadataHeaders,
  videoRetryable,
  videoTooLong,
  type VideoFailReason,
  type VideoFinishOutcome,
} from "../lib/videos";
import { useSiteUrl } from "./images";

// WP37: één gekozen filmpje klaarmaken en toevoegen, in de stappen van de
// spec (A-antwoord 5):
//   1. datum en plaats uit het origineel lezen (de module, besluit B2);
//   2. comprimeren naar VIDEO_TARGET en een poster maken (alleen met de app
//      open, besluit B11; het scherm houdt het scherm aan);
//   3. `videos.startUpload`: een ondertekende PUT voor een sleutel die de
//      backend kiest (of het filmpje dat al binnen is);
//   4. het bestand naar R2, in een achtergrond-sessie van iOS (gaat door met
//      de app op de achtergrond of het scherm uit);
//   5. `POST /upload/video` met de poster en datum en plaats als headers.
// Dezelfde upload-id bij opnieuw proberen: dezelfde sleutel, dus geen tweede
// filmpje (invariant 4). Het gecomprimeerde bestand blijft voor een nieuwe
// poging bewaard, tot het filmpje binnen is of een vaste reden kreeg.
//
// De app kent de R2-host niet: de link komt van de backend (A-invariant 11).

export type VideoPhase = "voorbereiden" | "verkleinen" | "versturen" | "afronden";
export type VideoProgress = { phase: VideoPhase; progress: number };

export type VideoUploadRequest = {
  asset: ImagePickerAsset;
  uploadId: string;
  albumId: string;
  /** Na een 401: het token niet uit de cache. */
  freshToken?: boolean;
  onProgress?: (p: VideoProgress) => void;
};

type Prepared = { compressed: CompressedVideo; poster: Poster; headers: Record<string, string> };

// Per upload-id, voor deze app-sessie: opnieuw proberen comprimeert niet opnieuw.
const prepared = new Map<string, Prepared>();

async function forget(uploadId: string): Promise<void> {
  const p = prepared.get(uploadId);
  prepared.delete(uploadId);
  if (p) {
    await removeFile(p.compressed.uri);
    await removeFile(p.poster.uri);
  }
}

async function prepare(
  asset: ImagePickerAsset,
  uploadId: string,
  onProgress?: (p: VideoProgress) => void,
): Promise<Prepared | VideoFailReason> {
  const known = prepared.get(uploadId);
  if (known) return known;
  if (!videoModuleAvailable) return "comprimeren";
  onProgress?.({ phase: "voorbereiden", progress: 0 });
  let headers: Record<string, string> = {};
  try {
    headers = videoMetadataHeaders(await readMetadata(asset.uri));
  } catch {
    // Geen datum of plaats te lezen: het filmpje komt binnen zonder (invariant 3).
  }
  let compressed: CompressedVideo;
  try {
    compressed = await compress(
      asset.uri,
      {
        id: uploadId,
        maxSide: VIDEO_TARGET.maxSide,
        videoBitrate: VIDEO_TARGET.videoBitrate,
        audioBitrate: VIDEO_TARGET.audioBitrate,
        maxFps: VIDEO_TARGET.maxFps,
      },
      (progress) => onProgress?.({ phase: "verkleinen", progress }),
    );
  } catch {
    return "comprimeren";
  }
  if (videoTooLong(compressed.durationMs)) {
    await removeFile(compressed.uri);
    return "te_lang";
  }
  let poster: Poster;
  try {
    poster = await makePoster(compressed.uri);
  } catch {
    await removeFile(compressed.uri);
    return "comprimeren";
  }
  const result = { compressed, poster, headers };
  prepared.set(uploadId, result);
  return result;
}

/** Het bestand naar de ondertekende link; de achtergrond-sessie van iOS. */
async function putToR2(
  url: string,
  fileUri: string,
  onProgress?: (p: VideoProgress) => void,
): Promise<VideoFailReason | null> {
  const task = createUploadTask(
    url,
    fileUri,
    {
      httpMethod: "PUT",
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      sessionType: FileSystemSessionType.BACKGROUND,
      headers: { "Content-Type": "video/mp4" },
    },
    ({ totalBytesSent, totalBytesExpectedToSend }) => {
      if (totalBytesExpectedToSend > 0) {
        onProgress?.({ phase: "versturen", progress: totalBytesSent / totalBytesExpectedToSend });
      }
    },
  );
  try {
    const result = await task.uploadAsync();
    if (!result) return "netwerk";
    // Een verlopen link (403) of een fout van R2: opnieuw proberen haalt een verse.
    return result.status >= 200 && result.status < 300 ? null : "server";
  } catch {
    return "netwerk";
  }
}

export function useVideoUploader() {
  const site = useSiteUrl();
  const auth = useAuth();
  const authRef = useRef(auth);
  authRef.current = auth;
  const startUpload = useAction(api.videos.startUpload);

  return useCallback(
    async ({ asset, uploadId, albumId, freshToken = false, onProgress }: VideoUploadRequest): Promise<VideoFinishOutcome> => {
      const done = async (outcome: VideoFinishOutcome): Promise<VideoFinishOutcome> => {
        if (outcome.ok || !videoRetryable(outcome.reason)) await forget(uploadId);
        return outcome;
      };
      if (site === null) return { ok: false, reason: "server" };
      // De kiezer geeft de duur al: te lang hoeft niet eerst verkleind.
      if (typeof asset.duration === "number" && videoTooLong(asset.duration)) return done({ ok: false, reason: "te_lang" });

      const ready = await prepare(asset, uploadId, onProgress);
      if (typeof ready === "string") return done({ ok: false, reason: ready });

      // Stap 3: de link (of het filmpje dat al binnen is).
      let start: Awaited<ReturnType<typeof startUpload>>;
      try {
        start = await startUpload({
          uploadId,
          albumId: albumId as Id<"albums">,
          durationMs: ready.compressed.durationMs,
          bytes: ready.compressed.bytes,
        });
      } catch (e) {
        const reason = e instanceof ConvexError ? startRefusalReason(e.data) : null;
        return done({ ok: false, reason: reason ?? "server" });
      }
      if (start.kind === "done") return done({ ok: true, photoId: start.photoId });

      // Stap 4: het bestand.
      onProgress?.({ phase: "versturen", progress: 0 });
      const putFailed = await putToR2(start.url, ready.compressed.uri, onProgress);
      if (putFailed) return done({ ok: false, reason: putFailed });

      // Stap 5: afronden met de poster.
      onProgress?.({ phase: "afronden", progress: 1 });
      const { getToken, sessionClaims, isSignedIn } = authRef.current;
      if (!isSignedIn) return done({ ok: false, reason: "uitgelogd" });
      let token: string | null;
      try {
        token =
          sessionClaims?.aud === "convex"
            ? await getToken({ skipCache: freshToken })
            : await getToken({ template: "convex", skipCache: freshToken });
      } catch {
        return done({ ok: false, reason: "netwerk" });
      }
      if (!token) return done({ ok: false, reason: "uitgelogd" });
      let poster: Blob;
      try {
        poster = await (await fetch(ready.poster.uri)).blob();
      } catch {
        // Opnieuw proberen kan: het verkleinde bestand en de poster blijven (A-invariant 33).
        return done({ ok: false, reason: "comprimeren" });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      try {
        let response: Response;
        try {
          response = await fetch(`${site}/upload/video`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "image/jpeg",
              "X-Upload-Id": uploadId,
              ...ready.headers,
            },
            body: poster,
            signal: controller.signal,
          });
        } catch {
          return done(finishOutcome(null, null));
        }
        let json: unknown = null;
        try {
          json = await response.json();
        } catch {
          if (controller.signal.aborted) return done(finishOutcome(null, null));
        }
        return done(finishOutcome(response.status, json));
      } finally {
        clearTimeout(timer);
      }
    },
    [site, startUpload],
  );
}
