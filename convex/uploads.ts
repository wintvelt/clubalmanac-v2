import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
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
//   - completed → return bestaande photoId (idempotent hit)
//   - in_progress → 409 Conflict (race-loser of stale handler)
//   - miss → nieuwe reservation, handler gaat door
// Cascade matrix UI1: cleanupOld ruimt completed > 7d en in_progress > 30min op.

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// 30min cutoff geeft veilige marge voor slow mobile uploads + HEIC parsing.
// Audit-12 §2 documenteerde 5min als te krap voor real-world mobile flow.
const STALE_IN_PROGRESS_MS = 30 * MINUTE_MS;
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
export const reserve = internalMutation({
  args: {
    ownerId: v.id("users"),
    clientUploadId: v.string(),
  },
  handler: async (ctx, { ownerId, clientUploadId }) => {
    const existing = await ctx.db
      .query("uploadIdempotency")
      .withIndex("by_owner_and_clientUploadId", (q) =>
        q.eq("ownerId", ownerId).eq("clientUploadId", clientUploadId),
      )
      .first();

    if (existing) {
      if (existing.status === "completed" && existing.photoId) {
        return { kind: "hit" as const, photoId: existing.photoId };
      }
      if (existing.status === "in_progress") {
        return { kind: "conflict" as const };
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
