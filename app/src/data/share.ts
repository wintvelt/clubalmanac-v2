import { useAuth } from "@clerk/expo";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as Sharing from "expo-sharing";
import { useCallback } from "react";
import { photoImageUrl } from "../lib/imageUrls";
import { shareEdits } from "../lib/placeShare";
import { useSiteUrl } from "./images";

// WP17d draft-invariant 4 en 5, besluit 3: delen geeft een lokaal bestand aan
// het iOS-deelmenu, geen URL. Het beeld is het formaat *groot* (alleen een foto
// met formaten; zonder zou het origineel met GPS gaan), opgehaald via het
// beeldpad met het token in de header. De app zet de pixels rechtop
// (kernvondst 5) en bewaart een nieuwe JPEG: expo-image-manipulator schrijft
// geen EXIF, dus ook geen plek. De tijdelijke bestanden gaan daarna weg.

const JPEG_QUALITY = 0.9;

export function useSharePhoto() {
  const site = useSiteUrl();
  const { getToken, sessionClaims } = useAuth();
  const forConvex = sessionClaims?.aud === "convex";

  return useCallback(
    async (photo: { photoId: string; exifOrientation?: number }): Promise<"shared" | "unavailable"> => {
      if (!site || !(await Sharing.isAvailableAsync())) return "unavailable";
      const token = forConvex ? await getToken() : await getToken({ template: "convex" });
      if (!token) throw new Error("Geen token");
      const dir = new Directory(Paths.cache, `delen-${Date.now()}`);
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
        try {
          await Sharing.shareAsync(uri, { mimeType: "image/jpeg", UTI: "public.jpeg" });
        } finally {
          try {
            new File(uri).delete();
          } catch {
            // Het tijdelijke bestand is al weg.
          }
        }
        return "shared";
      } finally {
        try {
          dir.delete();
        } catch {
          // De map is al weg.
        }
      }
    },
    [site, forConvex], // eslint-disable-line react-hooks/exhaustive-deps
  );
}
