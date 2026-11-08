import type { convexTest } from "convex-test";
import type { Id } from "../../convex/_generated/dataModel";
import { withUser } from "../_helpers/auth";

// WP18: gedeelde opzet voor de upload-tests (uploadGates, uploadAlbum,
// uploadTakenAt). Bytes die een echt beeld beginnen, en tellers voor "er
// blijft niets achter".

type T = ReturnType<typeof convexTest>;

/** Begin van een JPEG (SOI + APP0 JFIF). */
export const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
]);
/** PNG-handtekening plus het begin van IHDR. */
export const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
/** ISO-BMFF met een `ftyp`-box en het gegeven merk. */
export function ftyp(brand: string): Uint8Array {
  return new Uint8Array([0x00, 0x00, 0x00, 0x18, ...ascii("ftyp"), ...ascii(brand), 0, 0, 0, 0, ...ascii("isom"), ...ascii(brand)]);
}

export function upload(
  t: T,
  subject: string,
  opts: {
    uploadId: string;
    body?: BodyInit | Uint8Array;
    contentType?: string;
    headers?: Record<string, string>;
  },
) {
  return withUser(t, subject).fetch("/upload", {
    method: "POST",
    headers: {
      "Content-Type": opts.contentType ?? "image/jpeg",
      "X-Upload-Id": opts.uploadId,
      ...(opts.headers ?? {}),
    },
    body: (opts.body ?? JPEG) as BodyInit,
  });
}

/** Alles wat een upload kan achterlaten. */
export async function leftovers(t: T, ownerId: Id<"users">) {
  return await t.run(async (ctx) => ({
    photos: (await ctx.db
      .query("photos")
      .filter((q) => q.eq(q.field("ownerId"), ownerId))
      .collect()).length,
    reservations: (await ctx.db.query("uploadIdempotency").collect()).length,
    storage: (await ctx.db.system.query("_storage").collect()).length,
    albumPhotos: (await ctx.db.query("albumPhotos").collect()).length,
    photoCount: (await ctx.db.get(ownerId))!.photoCount,
  }));
}
