import { ConvexHttpClient } from "convex/browser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  mintTokenForEmail,
  revokeSessionQuietly,
} from "../_helpers/clerkAuth";
import { makeConvexClient } from "../_helpers/convexClient";
import { assertNotProd } from "../_helpers/safety";

// ---------------------------------------------------------------------------
// WP8 — photo-rotation empirische gate (live integration test). Sessie A, RED.
//
// Bewijst dat de gekozen image-lib (sharp) DAADWERKELIJK draait in de Convex
// "use node"-runtime (de hoog-risico external-dep uit §Risico-assessment —
// native libvips-bindings, deploy-onbewezen op dit platform), end-to-end:
//
//   POST /upload (echte iPhone JPEG, EXIF-Orientation ≠ 1)
//     → extractMetadata vult width/height + exifOrientation
//   photos.rotate({rotation: 90}) → scheduled photoRotation.rotateAction
//     → sharp rotate (incl. EXIF-bake-in, A2) → store nieuwe blob
//     → atomic patch: storageId-swap + exifOrientation=1 + dims-swap
//     → cleanup oude blob
//   download nieuwe blob → sharp decode → dims geswapt + non-corrupt
//   replay rotate(270) → terug bij oorspronkelijke oriëntatie (delta-inverse)
//
// A12: de fixture MOET EXIF-Orientation ≠ 1 hebben (iPhone-foto die normaal
// via CSS-transform rechtop staat) om de bake-in te bewijzen. Zet
// ROTATE_GATE_PHOTO_PATH; valt terug op UPLOAD_GATE_PHOTO_PATH (WP7-fixture).
//
// Niet in CI. Lokaal: `npm run test:integration`.
//
// PRE-REQ:
//   1. `.env.integration`: CONVEX_URL, CLERK_SECRET_KEY,
//      CLERK_TEST_USER_REGULAR_EMAIL, ROTATE_GATE_PHOTO_PATH (JPEG, EXIF
//      Orientation≠1, < 20 MiB, geen HEIC).
//   2. Convex dev-deployment: INTEGRATION_TEST_ENABLED=true (voor _test.*).
//   3. `sharp` geïnstalleerd (B's WP8-dependency) — anders import-fail (RED).
//
// RED tot B `photos.rotate` + `convex/photoRotation.ts` + sharp-dep landt.
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(
      `${name} ontbreekt. Zet 'm in .env.integration (zie .env.integration.example).`,
    );
  }
  return v;
}

function getRotateFixturePath(): string {
  return (
    process.env.ROTATE_GATE_PHOTO_PATH ?? requireEnv("UPLOAD_GATE_PHOTO_PATH")
  );
}

function getConvexSiteBase(): string {
  const cloudUrl = requireEnv("CONVEX_URL");
  assertNotProd(cloudUrl);
  if (!cloudUrl.includes(".convex.cloud")) {
    throw new Error(
      `CONVEX_URL ("${cloudUrl}") heeft geen ".convex.cloud" suffix; ` +
        `kan httpAction-host niet afleiden. Verwacht een dev-deployment URL.`,
    );
  }
  return cloudUrl.replace(".convex.cloud", ".convex.site");
}

type PhotoRow = {
  storageId: Id<"_storage">;
  ownerId: string;
  width?: number;
  height?: number;
  exifOrientation?: number;
};

async function pollPhoto(
  client: ConvexHttpClient,
  photoId: Id<"photos">,
  predicate: (p: PhotoRow) => boolean,
  timeoutMs: number,
): Promise<PhotoRow | null> {
  const deadline = Date.now() + timeoutMs;
  let photo: PhotoRow | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    photo = (await client.query(api.photos.getById, {
      photoId,
    })) as PhotoRow | null;
    if (photo && predicate(photo)) return photo;
  }
  return photo;
}

describe("WP8 — photo-rotation empirische gate", () => {
  let jwt: string;
  let sessionId: string;
  let client: ConvexHttpClient;
  let photoFilePath: string;
  const mimeType = "image/jpeg";
  let photoId: Id<"photos"> | null = null;

  beforeAll(async () => {
    photoFilePath = getRotateFixturePath();
    await fs.access(photoFilePath, fs.constants.R_OK);

    const email = requireEnv("CLERK_TEST_USER_REGULAR_EMAIL");
    const minted = await mintTokenForEmail(email);
    jwt = minted.jwt;
    sessionId = minted.sessionId;
    client = makeConvexClient();
  });

  afterAll(async () => {
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
    "upload → rotate(90) → storage fysiek geroteerd, dims geswapt, exifOrientation=1, replay(270) terug",
    async () => {
      client.setAuth(jwt);

      // 1. Upload de fixture via de productie-pipeline.
      const photoBuffer = await fs.readFile(photoFilePath);
      const blob = new Blob([new Uint8Array(photoBuffer)], { type: mimeType });
      const uploadId = `wp8-gate-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      const filename = path.basename(photoFilePath);

      const siteBase = getConvexSiteBase();
      const uploadRes = await fetch(`${siteBase}/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "X-Upload-Id": uploadId,
          "X-Filename": filename,
          "Content-Type": mimeType,
        },
        body: blob,
      });
      expect(uploadRes.status).toBe(200);
      const uploadBody = (await uploadRes.json()) as { photoId: Id<"photos"> };
      photoId = uploadBody.photoId;

      // 2. Wacht tot extractMetadata dims + exifOrientation gevuld heeft.
      const before = await pollPhoto(
        client,
        photoId,
        (p) => typeof p.width === "number" && typeof p.height === "number",
        15_000,
      );
      expect(before).not.toBeNull();
      const beforeWidth = before!.width!;
      const beforeHeight = before!.height!;
      const beforeStorageId = before!.storageId;
      // A12: de fixture hoort EXIF-Orientation ≠ 1 te hebben (anders bewijst
      // de gate de bake-in niet). Een waarschuwing als dat niet zo is.
      if (before!.exifOrientation === undefined || before!.exifOrientation === 1) {
        console.warn(
          "[WP8-gate] fixture exifOrientation is 1/undefined — bake-in (A2) " +
            "wordt NIET beproefd. Gebruik een iPhone-foto met Orientation≠1.",
        );
      }

      // 3. Roteer 90°.
      await client.mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      });

      // 4. Poll tot de storageId daadwerkelijk gewisseld is (action-async).
      const rotated = await pollPhoto(
        client,
        photoId,
        (p) => p.storageId !== beforeStorageId,
        20_000,
      );
      expect(rotated).not.toBeNull();
      expect(rotated!.storageId).not.toBe(beforeStorageId);
      // EXIF-neutralisatie.
      expect(rotated!.exifOrientation).toBe(1);
      // Dims geswapt op het record.
      expect(rotated!.width).toBe(beforeHeight);
      expect(rotated!.height).toBe(beforeWidth);

      // 5. Download de nieuwe blob en decodeer met sharp → non-corrupt +
      //    werkelijke dims kruis-checken tegen het record.
      const url = await client.query(api._test.storageDownloadUrl, {
        storageId: rotated!.storageId,
      });
      expect(url).not.toBeNull();
      const fileRes = await fetch(url as string);
      expect(fileRes.ok).toBe(true);
      const rotatedBytes = Buffer.from(await fileRes.arrayBuffer());
      const meta = await sharp(rotatedBytes).metadata();
      // Werkelijke pixel-dims geswapt t.o.v. origineel (90°-rotatie).
      expect(meta.width).toBe(beforeHeight);
      expect(meta.height).toBe(beforeWidth);

      // 6. Replay rotate(270) → delta-inverse: terug bij oorspronkelijke
      //    oriëntatie (dims weer als origineel).
      const afterFirstStorageId = rotated!.storageId;
      await client.mutation(api.photos.rotate, {
        photoId,
        rotation: 270,
        flipY: false,
      });
      const back = await pollPhoto(
        client,
        photoId,
        (p) => p.storageId !== afterFirstStorageId,
        20_000,
      );
      expect(back).not.toBeNull();
      expect(back!.width).toBe(beforeWidth);
      expect(back!.height).toBe(beforeHeight);
      expect(back!.exifOrientation).toBe(1);
    },
    60_000,
  );
});
