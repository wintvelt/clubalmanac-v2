"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

// Server-side EXIF + geocoding voor een net geüploade photo. Async gequeued
// door createFromUploadInternal in `photos.ts`.
//
// Aparte file met `"use node";` directive: exif-parser (npm) vereist
// Node's Buffer-global die in de standaard Convex isolate-runtime ontbreekt
// (gevonden via WP7 integration-gate 2026-05-18 op echte iPhone-JPEG).
// "use node" forceert Node-runtime voor deze file; daarbinnen alleen
// actions/httpActions toegestaan, geen mutations/queries. Patch + lookups
// blijven dus in `photos.ts` en worden via `internal.photos.*` aangeroepen.
//
// Bron-mapping (oude AWS lib-geodata.js):
//   DateTimeOriginal ?? CreateDate → takenAt (audit-10 §1: iOS prominent op
//                                   DateTimeOriginal, Android op CreateDate)
//   GPSLatitude / GPSLongitude    → latitude / longitude
//   tags.Orientation              → exifOrientation (audit-9)
//   imageSize.width/height        → width / height
//
// Graceful degradation (audit-10 §3 — granulaire try/catch met logging):
//   - photo verwijderd / storage weg → silent no-op (cleanup-race)
//   - HEIC bytes                     → log "unsupported" + skip EXIF
//   - exif-parser import-fail        → log + skip EXIF (lib niet beschikbaar)
//   - exif-parser create/parse fail  → log + skip EXIF (corrupt bytes)
//   - reverseGeocode fail            → label undefined, lat/lon behouden

// HEIC detection via ISO-BMFF magic bytes. iPhone uploads landen vaak als
// HEIC; exif-parser kan ze niet decoderen. Audit-10 §5: graceful no-op met
// expliciete log ipv stille parse-fail. Brand-codes: heic/heix/heim/heis +
// mif1/msf1 (HEIF-variants die exif-parser ook niet aankan).
function isHeicLike(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  // bytes 4..8 = "ftyp"
  if (
    bytes[4] !== 0x66 ||
    bytes[5] !== 0x74 ||
    bytes[6] !== 0x79 ||
    bytes[7] !== 0x70
  ) {
    return false;
  }
  const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
  return (
    brand === "heic" ||
    brand === "heix" ||
    brand === "heim" ||
    brand === "heis" ||
    brand === "hevc" ||
    brand === "hevx" ||
    brand === "mif1" ||
    brand === "msf1"
  );
}

export const extractMetadata = internalAction({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    const photo: Doc<"photos"> | null = await ctx.runQuery(
      internal.photos.getByIdInternal,
      { photoId },
    );
    if (!photo) return;

    const blob = await ctx.storage.get(photo.storageId);
    if (!blob) return;

    // Convex runtime's Blob.slice() gaf RangeError bij arrayBuffer()
    // (WP7-gate 2026-05-18). Workaround: full buffer eerst, dan Uint8Array
    // subarray voor HEIC-sniff. We hebben de buffer toch zo nodig voor
    // exif-parser, dus geen extra geheugen-kost.
    const fullBuffer = await blob.arrayBuffer();
    const headerBytes = new Uint8Array(fullBuffer, 0, Math.min(12, fullBuffer.byteLength));
    if (isHeicLike(headerBytes)) {
      console.log(
        `[extractMetadata] unsupported format (HEIC) photoId=${photoId}, skipping EXIF`,
      );
      return;
    }

    let width: number | undefined;
    let height: number | undefined;
    let takenAt: number | undefined;
    let latitude: number | undefined;
    let longitude: number | undefined;
    let exifOrientation: number | undefined;

    try {
      // Lazy import: graceful failure als pakket niet laadt (rare maar
      // expliciet gelogd ipv stille fail).
      const { default: ExifParser } = await import("exif-parser");
      try {
        const buf = Buffer.from(fullBuffer);
        const result = ExifParser.create(buf).parse();

        const tags = (result.tags ?? {}) as Record<string, unknown>;

        // takenAt: DateTimeOriginal wint, fallback op CreateDate. Beide in
        // Unix-seconds → *1000 voor ms.
        const dto = tags.DateTimeOriginal;
        const cd = tags.CreateDate;
        if (typeof dto === "number") {
          takenAt = dto * 1000;
        } else if (typeof cd === "number") {
          takenAt = cd * 1000;
        }

        const lat = tags.GPSLatitude;
        const lon = tags.GPSLongitude;
        if (typeof lat === "number") latitude = lat;
        if (typeof lon === "number") longitude = lon;

        const orient = tags.Orientation;
        if (typeof orient === "number" && orient >= 1 && orient <= 8) {
          exifOrientation = orient;
        }

        const size = result.imageSize as
          | { width?: number; height?: number }
          | undefined;
        if (size) {
          if (typeof size.width === "number") width = size.width;
          if (typeof size.height === "number") height = size.height;
        }
      } catch (e) {
        console.error(
          `[extractMetadata] EXIF parse failed photoId=${photoId}`,
          e,
        );
      }
    } catch (e) {
      // Audit-13 §3: bewust niet automated getest. vi.mock("exif-parser")
      // simuleert geen import-failure → dit pad is in unit-tests onbereikbaar
      // (dead branch onder mock). Real-world failure zou een Convex deploy-
      // issue zijn (ontbrekende dependency in bundle). Smoke-test pad in
      // fase 4A2 / integration tests tegen echte deployment dekt dit af.
      // Catch blijft staan als pure defensieve laag: liever een log-regel
      // dan een silent crash van de hele extract-pipeline.
      console.error(`[extractMetadata] exif-parser import failed`, e);
    }

    // Als EXIF geen GPS opleverde maar het record had handmatig gepatchte
    // coords (bv. uit test-setup of eerder backfill-pad), gebruik die voor
    // geocoding.
    const finalLat = latitude ?? photo.latitude;
    const finalLon = longitude ?? photo.longitude;

    let locationLabel: string | null = null;
    if (typeof finalLat === "number" && typeof finalLon === "number") {
      try {
        locationLabel = await ctx.runAction(internal.photos.reverseGeocode, {
          latitude: finalLat,
          longitude: finalLon,
        });
      } catch (e) {
        // reverseGeocode swallowt zelf alle errors → null. Deze catch is
        // defensief voor onverwachte transport-fouten via runAction.
        console.error(
          `[extractMetadata] geocoding runAction failed photoId=${photoId}`,
          e,
        );
      }
    }

    await ctx.runMutation(internal.photos.patchMetadata, {
      photoId,
      width,
      height,
      takenAt,
      latitude,
      longitude,
      // Lege string niet als label opslaan: empty results → undefined.
      locationLabel:
        typeof locationLabel === "string" && locationLabel.length > 0
          ? locationLabel
          : undefined,
      exifOrientation,
    });
  },
});
