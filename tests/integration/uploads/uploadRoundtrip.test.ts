import { ConvexHttpClient } from "convex/browser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  mintTokenForEmail,
  revokeSessionQuietly,
} from "../_helpers/clerkAuth";
import { makeConvexClient } from "../_helpers/convexClient";
import { getConvexSiteBase, requireEnv } from "../_helpers/convexSite";

// ---------------------------------------------------------------------------
// WP7: upload-pipeline empirische gate — live integration test
//
// Pin't de complete pipeline op een echte iPhone-foto met EXIF/GPS:
//   POST /upload (Clerk JWT + X-Upload-Id + binary)
//     → reservation pattern
//     → ctx.storage.store
//     → internal.photos.createFromUploadInternal (atomic photo+reservation+schedule)
//     → scheduler.runAfter(0, internal.photoMetadata.extractMetadata)
//     → exif-parser (takenAt + GPS)
//     → reverseGeocode via Photon (locationLabel)
//
// Architectuur:
//   - mintTokenForEmail levert echte Clerk JWT voor de regular-test-user
//     (cross-ref: tests/integration/clerk/jwtRoundtrip.test.ts).
//   - Binary fetch naar `<deployment>.<region>.convex.site/upload`.
//   - Poll `api.photos.getById` tot `takenAt` gevuld is (scheduler-async).
//   - Cleanup: photos.remove via dezelfde JWT (best-effort).
//
// Niet in CI. Lokaal: `npm run test:integration`.
//
// PRE-REQ:
//   1. `.env.integration` vol per `.env.integration.example`:
//      - CONVEX_URL, CLERK_SECRET_KEY, CLERK_TEST_USER_REGULAR_EMAIL
//      - UPLOAD_GATE_PHOTO_PATH = absolute path naar een echte JPEG
//        met EXIF + GPS metadata. iPhone-foto (geen HEIC — HEIC gaat
//        graceful-no-op door extractMetadata, kan deze gate niet
//        beproeven). Foto < 20 MiB (Convex platform-limit).
//      - UPLOAD_GATE_PHOTO_MIMETYPE = `image/jpeg` (default als ongezet).
//   2. Op Convex dev-deployment: `INTEGRATION_TEST_ENABLED=true`.
//   3. Regular test-user heeft Convex users-row (via WP4 setup of WP6
//      registerFromSession-flow).
// ---------------------------------------------------------------------------

describe("WP7 — upload-pipeline empirische gate", () => {
  let jwt: string;
  let sessionId: string;
  let client: ConvexHttpClient;
  let photoFilePath: string;
  let mimeType: string;
  let photoId: Id<"photos"> | null = null;

  beforeAll(async () => {
    photoFilePath = requireEnv("UPLOAD_GATE_PHOTO_PATH");
    mimeType = process.env.UPLOAD_GATE_PHOTO_MIMETYPE ?? "image/jpeg";

    // Stat-check: bestand bestaat + lees-baar
    await fs.access(photoFilePath, fs.constants.R_OK);

    const email = requireEnv("CLERK_TEST_USER_REGULAR_EMAIL");
    const minted = await mintTokenForEmail(email);
    jwt = minted.jwt;
    sessionId = minted.sessionId;

    client = makeConvexClient();
  });

  afterAll(async () => {
    // Best-effort cleanup: verwijder photo + revoke Clerk-session.
    // Falen is OK — gate-result staat dan al vast.
    if (photoId !== null) {
      try {
        client.setAuth(jwt);
        await client.mutation(api.photos.remove, { photoId });
      } catch {
        // best-effort
      }
    }
    await revokeSessionQuietly(sessionId);
  });

  it(
    "POST /upload met JPEG+EXIF+GPS → 200 + extractMetadata vult takenAt + locationLabel via Photon",
    async () => {
      const photoBuffer = await fs.readFile(photoFilePath);
      const blob = new Blob([new Uint8Array(photoBuffer)], { type: mimeType });

      const uploadId = `wp7-gate-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      const filename = path.basename(photoFilePath);

      const siteBase = getConvexSiteBase();
      const res = await fetch(`${siteBase}/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "X-Upload-Id": uploadId,
          "X-Filename": filename,
          "Content-Type": mimeType,
        },
        body: blob,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { photoId: Id<"photos"> };
      expect(body.photoId).toBeDefined();
      photoId = body.photoId;

      // Scheduler-async: extractMetadata draait via runAfter(0, ...).
      // In praktijk binnen 1-3s klaar; poll max 15s.
      type PhotoRow = {
        takenAt?: number;
        latitude?: number;
        longitude?: number;
        locationLabel?: string;
        exifOrientation?: number;
        storageId: string;
        ownerId: string;
      };
      let photo: PhotoRow | null = null;
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        photo = (await client.query(api.photos.getById, {
          photoId: body.photoId,
        })) as PhotoRow | null;
        if (photo?.takenAt !== undefined) break;
      }

      expect(photo).not.toBeNull();
      // Basis: row bestaat
      expect(photo!.storageId).toBeDefined();
      expect(photo!.ownerId).toBeDefined();
      // EXIF: DateTimeOriginal of CreateDate is gevuld
      expect(photo!.takenAt).toBeDefined();
      expect(typeof photo!.takenAt).toBe("number");
      expect(photo!.takenAt!).toBeGreaterThan(0);
      // GPS coords uit EXIF
      expect(photo!.latitude).toBeDefined();
      expect(photo!.longitude).toBeDefined();
      // Photon reverse-geocode-roundtrip levert iets bruikbaars
      expect(photo!.locationLabel).toBeDefined();
      expect(typeof photo!.locationLabel).toBe("string");
      expect(photo!.locationLabel!.length).toBeGreaterThan(0);
    },
    30_000,
  );
});
