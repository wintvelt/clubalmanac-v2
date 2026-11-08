import { useAuth } from "@clerk/expo";
import type { ImagePickerAsset } from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useCallback, useRef } from "react";
import {
  UPLOAD_TIMEOUT_MS,
  fitWithin,
  metadataHeaders,
  uploadOutcome,
  type UploadOutcome,
} from "../lib/upload";
import { useSiteUrl } from "./images";

// WP18: één gekozen foto omzetten en naar POST /upload sturen.
//
// A-keuze 3: elke foto wordt een JPEG met langste zijde hooguit 4032, nooit
// groter. Het omzetten schrijft geen EXIF mee: geen GPS en geen stand-tag in
// de bytes; de pixels staan rechtop. Datum en locatie gaan als headers mee
// (A-keuze 2, vraag 2), uit de EXIF van de kiezer.
//
// Het verzoek draagt het Clerk-token voor Convex (zoals het beeldpad,
// src/data/images.tsx). Na een 401 haalt de volgende poging een vers token.

const JPEG_QUALITY = 0.85;

export type UploadRequest = {
  asset: ImagePickerAsset;
  uploadId: string;
  /** Zonder album: de profielfoto. */
  albumId?: string;
  /** Na een 401: het token niet uit de cache. */
  freshToken?: boolean;
};

/** Zet een gekozen beeld om naar een JPEG zonder EXIF, binnen de grens. */
export async function toUploadJpeg(asset: ImagePickerAsset): Promise<string> {
  const context = ImageManipulator.manipulate(asset.uri);
  if (asset.width > 0 && asset.height > 0) {
    const fit = fitWithin(asset.width, asset.height);
    if (fit.width !== asset.width || fit.height !== asset.height) context.resize(fit);
  }
  const image = await context.renderAsync();
  try {
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
    return saved.uri;
  } finally {
    image.release();
  }
}

export function useUploader() {
  const site = useSiteUrl();
  const auth = useAuth();
  // Clerk's useAuth is niet gememoïseerd; de laatste versie telt.
  const authRef = useRef(auth);
  authRef.current = auth;

  return useCallback(
    async ({ asset, uploadId, albumId, freshToken = false }: UploadRequest): Promise<UploadOutcome> => {
      if (site === null) return { ok: false, reason: "server" };

      let jpegUri: string;
      try {
        jpegUri = await toUploadJpeg(asset);
      } catch {
        // Niet te lezen als beeld (of niet van iCloud te halen): vaste reden.
        return { ok: false, reason: "geen_foto" };
      }

      const { getToken, sessionClaims, isSignedIn } = authRef.current;
      if (!isSignedIn) return { ok: false, reason: "uitgelogd" };
      let token: string | null;
      try {
        token =
          sessionClaims?.aud === "convex"
            ? await getToken({ skipCache: freshToken })
            : await getToken({ template: "convex", skipCache: freshToken });
      } catch {
        return { ok: false, reason: "netwerk" };
      }
      if (!token) return { ok: false, reason: "uitgelogd" };

      let body: Blob;
      try {
        body = await (await fetch(jpegUri)).blob();
      } catch {
        return { ok: false, reason: "geen_foto" };
      }

      // Fix-cyclus 1, invariant 20: één termijn voor versturen én het
      // antwoord lezen. Daarna wordt het verzoek gestopt en is de uitkomst
      // "netwerk"; een herhaling met dezelfde id geeft de foto als de server
      // hem toch al had.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("termijn")), { once: true });
      });
      aborted.catch(() => {});
      try {
        let response: Response;
        try {
          response = await Promise.race([
            fetch(`${site}/upload`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "image/jpeg",
                "X-Upload-Id": uploadId,
                ...(albumId ? { "X-Album-Id": albumId } : {}),
                ...metadataHeaders(asset.exif),
              },
              body,
              signal: controller.signal,
            }),
            aborted,
          ]);
        } catch {
          return uploadOutcome(null, null);
        }
        let json: unknown = null;
        try {
          json = await Promise.race([response.json(), aborted]);
        } catch {
          // Na de termijn: geen antwoord. Anders geen JSON: de status beslist.
          if (controller.signal.aborted) return uploadOutcome(null, null);
        }
        return uploadOutcome(response.status, json);
      } finally {
        clearTimeout(timer);
      }
    },
    [site],
  );
}
