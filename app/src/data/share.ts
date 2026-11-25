import { useAuth } from "@clerk/expo";
import { useAction } from "convex/react";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as Sharing from "expo-sharing";
import { useCallback } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../convexApi";
import { withOneRetry } from "../lib/actionRetry";
import { photoImageUrl } from "../lib/imageUrls";
import { shareEdits } from "../lib/placeShare";
import { useSiteUrl } from "./images";
import { clearOldShares, KEEP_SHARED_FILE, SHARE_DIR_PREFIX } from "./shareFiles";

// WP17d draft-invariant 4 en 5, besluit 3: delen geeft een lokaal bestand aan
// het iOS-deelmenu, geen URL. Het beeld is het formaat *groot* (alleen een foto
// met formaten; zonder zou het origineel met GPS gaan), opgehaald via het
// beeldpad met het token in de header. De app zet de pixels rechtop
// (kernvondst 5) en bewaart een nieuwe JPEG: expo-image-manipulator schrijft
// geen EXIF, dus ook geen plek. De tijdelijke bestanden gaan daarna weg.
//
// WP37 invariant 9, A-invariant 23: een filmpje deelt het bestand uit R2 (via
// een verse afspeellink), als tijdelijk bestand; daarna weg. Dat bestand heeft
// geen GPS (de backend weigert een filmpje met een locatie, invariant 2).

const JPEG_QUALITY = 0.9;

export function useSharePhoto() {
  const site = useSiteUrl();
  const { getToken, sessionClaims } = useAuth();
  const forConvex = sessionClaims?.aud === "convex";
  const playUrl = useAction(api.videos.playUrl);

  return useCallback(
    async (photo: { photoId: string; exifOrientation?: number; isVideo?: boolean }): Promise<"shared" | "unavailable"> => {
      if (!site || !(await Sharing.isAvailableAsync())) return "unavailable";
      // WP42 A7: op Android gaat het vorige deelbestand nu pas weg (src/data/shareFiles.ts).
      clearOldShares();
      if (photo.isVideo) {
        const { url } = await withOneRetry(() => playUrl({ photoId: photo.photoId as Id<"photos"> }));
        const dir = new Directory(Paths.cache, `${SHARE_DIR_PREFIX}${Date.now()}`);
        dir.create({ intermediates: true, idempotent: true });
        try {
          const file = await File.downloadFileAsync(url, new File(dir, "filmpje.mp4"), { idempotent: true });
          await Sharing.shareAsync(file.uri, { mimeType: "video/mp4", UTI: "public.mpeg-4" });
          return "shared";
        } finally {
          try {
            if (!KEEP_SHARED_FILE) dir.delete();
          } catch {
            // De map is al weg.
          }
        }
      }
      const token = forConvex ? await getToken() : await getToken({ template: "convex" });
      if (!token) throw new Error("Geen token");
      const dir = new Directory(Paths.cache, `${SHARE_DIR_PREFIX}${Date.now()}`);
      dir.create({ intermediates: true, idempotent: true });
      try {
        const downloaded = await File.downloadFileAsync(
          photoImageUrl(site, photo.photoId, "groot"),
          new File(dir, "groot.jpg"),
          { headers: { Authorization: `Bearer ${token}` }, idempotent: true },
        );
        const context = ImageManipulator.manipulate(downloaded.uri);
        for (const step of shareEdits(photo.exifOrientation)) {
          if ("flip" in step) context.flip(step.flip);
          else context.rotate(step.rotate);
        }
        const image = await context.renderAsync();
        let uri: string;
        try {
          uri = (await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY })).uri;
        } finally {
          image.release();
        }
        if (KEEP_SHARED_FILE) {
          // Android: het gedeelde bestand in de map `delen-…`, die blijft; *groot* gaat meteen weg.
          const kept = new File(uri);
          kept.move(dir);
          uri = kept.uri;
          try {
            downloaded.delete();
          } catch {
            // Al weg.
          }
        }
        try {
          await Sharing.shareAsync(uri, { mimeType: "image/jpeg", UTI: "public.jpeg" });
        } finally {
          try {
            if (!KEEP_SHARED_FILE) new File(uri).delete();
          } catch {
            // Het tijdelijke bestand is al weg.
          }
        }
        return "shared";
      } finally {
        try {
          if (!KEEP_SHARED_FILE) dir.delete();
        } catch {
          // De map is al weg.
        }
      }
    },
    [site, forConvex, playUrl], // eslint-disable-line react-hooks/exhaustive-deps
  );
}
