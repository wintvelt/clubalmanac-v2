import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { getMembership } from "./groups";

// Internal helpers voor de POST /upload httpAction (convex/http.ts) en
// voor de dagelijkse cleanup-cron (convex/crons.ts).
//
// Reservation pattern (audit-cyclus-1): de uploadIdempotency-row wordt
// vóór photo-creatie ingeschreven met status="in_progress" (reserve mutation).
// Photo-creatie gebeurt in `internal.photos.createFromUploadInternal` —
// die mutation patcht de reservation naar status="completed" in dezelfde
// transactie als de photo-insert (atomair). Dubbele POST met zelfde
// (ownerId, clientUploadId):
//   - completed → return bestaande photoId (idempotent hit), als de foto
//     nog bestaat (WP18 A-invariant 22)
//   - in_progress → 409 Conflict (race-loser), tot 30 min (A-invariant 23)
//   - miss → nieuwe reservation, handler gaat door
// Cascade matrix UI1: cleanupOld ruimt completed > 7d en in_progress > 30min op.

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// 30min cutoff geeft veilige marge voor slow mobile uploads + HEIC parsing.
// Audit-12 §2 documenteerde 5min als te krap voor real-world mobile flow.
export const STALE_IN_PROGRESS_MS = 30 * MINUTE_MS;
const RETENTION_COMPLETED_MS = 7 * DAY_MS;

// Reservation lookup + insert in één mutation, zodat parallelle handlers
// op (ownerId, clientUploadId) een transaction-conflict triggeren: de loser
// retry'd, ziet bij retry de in_progress reservation van de winnaar, en
// returnt {kind:"conflict"}. Geen race-window meer waarin beide aan
// photo-creatie toekomen.
//
// WP18 A-invariant 12: de limiet komt ná het opzoeken van de upload-id. Een
// herhaling van een upload waarvan de foto al gemaakt is, geeft die foto
// terug, ook als de user nu op of over zijn limiet zit. Alleen een nieuwe id
// op de limiet krijgt {kind:"limit"}, zonder reservering.
//
// WP18 A-invariant 22: een reservering die naar een gewiste foto wijst (van
// vóór de cascade in `internalRemovePhoto`) telt als geen reservering. Nooit
// een hit met een photoId dat niet bestaat.
// WP18 A-invariant 23: een "nog bezig"-reservering van STALE_IN_PROGRESS_MS
// of ouder telt ook als geen reservering. De oude regel gaat weg en de
// herhaling krijgt een verse; een late stap van de oude poging vindt haar
// reservering dan niet meer (`createFromUploadInternal`).
// WP18 A-invariant 24: met `albumId` zet een hit de bestaande foto in dat
// album als hij er niet (meer) in staat, in deze transactie. Het lidmaatschap
// wordt hier opnieuw getoetst ({kind:"noAlbum"} → 404). De limiet speelt bij
// een hit geen rol.
export const reserve = internalMutation({
  args: {
    ownerId: v.id("users"),
    clientUploadId: v.string(),
    albumId: v.optional(v.id("albums")),
  },
  handler: async (ctx, { ownerId, clientUploadId, albumId }) => {
    const existing = await ctx.db
      .query("uploadIdempotency")
      .withIndex("by_owner_and_clientUploadId", (q) =>
        q.eq("ownerId", ownerId).eq("clientUploadId", clientUploadId),
      )
      .first();

    if (existing) {
      const now = Date.now();
      if (existing.status === "in_progress") {
        if (now - existing.createdAt < STALE_IN_PROGRESS_MS) {
          return { kind: "conflict" as const };
        }
        await ctx.db.delete(existing._id);
      } else {
        const photo = existing.photoId
          ? await ctx.db.get(existing.photoId)
          : null;
        if (photo) {
          if (albumId) {
            const placed = await placeInAlbum(ctx, ownerId, albumId, photo._id);
            if (!placed) return { kind: "noAlbum" as const };
          }
          return { kind: "hit" as const, photoId: photo._id };
        }
        await ctx.db.delete(existing._id);
      }
    }

    const owner = await ctx.db.get(ownerId);
    if (!owner) throw new Error("User bestaat niet");
    if (owner.photoCount >= owner.photoLimit) {
      return { kind: "limit" as const };
    }

    const reservationId = await ctx.db.insert("uploadIdempotency", {
      ownerId,
      clientUploadId,
      status: "in_progress",
      createdAt: Date.now(),
    });
    return { kind: "reserved" as const, reservationId };
  },
});

// A-invariant 24: de bestaande foto in het album, als lid. Staat hij er al,
// dan niets. De uploader is de toevoeger; `addedAt` laat de teller bij de
// andere leden oplopen (invariant 8).
async function placeInAlbum(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  albumId: Id<"albums">,
  photoId: Id<"photos">,
): Promise<boolean> {
  const album = await ctx.db.get(albumId);
  if (!album) return false;
  const membership = await getMembership(ctx, ownerId, album.groupId);
  if (!membership) return false;
  const present = await ctx.db
    .query("albumPhotos")
    .withIndex("by_album", (q) => q.eq("albumId", albumId))
    .filter((q) => q.eq(q.field("photoId"), photoId))
    .first();
  if (!present) {
    await ctx.db.insert("albumPhotos", {
      albumId,
      photoId,
      groupId: album.groupId,
      addedAt: Date.now(),
      addedBy: ownerId,
    });
  }
  return true;
}

// WP18 A-invariant 15: het album van een upload met `X-Album-Id`. Alleen een
// album van een groep waar de uploader lid van is (toestemmingslijst). Geen
// lid, onbekend, gewist, misvormd of een id van een andere tabel: null, zodat
// de httpAction één antwoord geeft (geen bestaans-orakel). De transactie in
// `photos.createFromUploadInternal` toetst het opnieuw.
export const uploadAlbum = internalQuery({
  args: { ownerId: v.id("users"), albumId: v.string() },
  returns: v.union(v.id("albums"), v.null()),
  handler: async (ctx, { ownerId, albumId }) => {
    const id = ctx.db.normalizeId("albums", albumId);
    if (!id) return null;
    const album = await ctx.db.get(id);
    if (!album) return null;
    const membership = await getMembership(ctx, ownerId, album.groupId);
    return membership ? id : null;
  },
});

// Cleanup-on-failure: handler crasht tussen reserve en photo-creatie, óf
// createFromUploadInternal throw't (bv. PHOTO_LIMIT_REACHED race). De
// reservation moet weg zodat een retry niet 409't tot stale-cleanup. Aparte
// mutation zodat httpAction 'm via runMutation kan aanroepen.
export const deleteReservation = internalMutation({
  args: { reservationId: v.id("uploadIdempotency") },
  handler: async (ctx, { reservationId }) => {
    const r = await ctx.db.get(reservationId);
    if (r) await ctx.db.delete(reservationId);
  },
});

// UI1: dagelijkse cron (zie convex/crons.ts). Twee thresholds in één run:
//   completed   ouder dan 7d   → retry-safety horizon
//   in_progress ouder dan 30min → stale-reservation cleanup (audit-12 §2)
// Boundary <= cutoff (consistent met FL1 + invites).
export const cleanupOld = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const completedCutoff = now - RETENTION_COMPLETED_MS;
    const inProgressCutoff = now - STALE_IN_PROGRESS_MS;

    const staleCompleted = await ctx.db
      .query("uploadIdempotency")
      .withIndex("by_status_and_createdAt", (q) =>
        q.eq("status", "completed").lte("createdAt", completedCutoff),
      )
      .collect();
    for (const r of staleCompleted) await ctx.db.delete(r._id);

    const staleInProgress = await ctx.db
      .query("uploadIdempotency")
      .withIndex("by_status_and_createdAt", (q) =>
        q.eq("status", "in_progress").lte("createdAt", inProgressCutoff),
      )
      .collect();
    for (const r of staleInProgress) await ctx.db.delete(r._id);
  },
});
