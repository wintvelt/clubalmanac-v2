import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

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
// Cascade matrix UI1: cleanupOld ruimt completed > 7d en in_progress > 5min op.

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_IN_PROGRESS_MS = 5 * MINUTE_MS;
const RETENTION_COMPLETED_MS = 7 * DAY_MS;

// Reservation lookup + insert in één mutation, zodat parallelle handlers
// op (ownerId, clientUploadId) een transaction-conflict triggeren: de loser
// retry'd, ziet bij retry de in_progress reservation van de winnaar, en
// returnt {kind:"conflict"}. Geen race-window meer waarin beide aan
// photo-creatie toekomen.
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

    const reservationId = await ctx.db.insert("uploadIdempotency", {
      ownerId,
      clientUploadId,
      status: "in_progress",
      createdAt: Date.now(),
    });
    return { kind: "reserved" as const, reservationId };
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
//   completed   ouder dan 7d  → retry-safety horizon
//   in_progress ouder dan 5min → stale-reservation cleanup
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
