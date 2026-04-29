import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireCurrentUser } from "./users";
import { requireWebmaster } from "./lib/auth";

const DAY_MS = 24 * 60 * 60 * 1000;
const FLAG_DELETE_DAYS = 14;
const DENY_DELETE_DAYS = 7;

// Cat-1 join-on-read: photo + owner data, vervangt denormalized
// user-velden op photos uit DynamoDB. Cascade matrix row U3.
export const getWithOwner = query({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    const photo = await ctx.db.get(photoId);
    if (!photo) return null;
    const owner = await ctx.db.get(photo.ownerId);
    return { ...photo, owner };
  },
});

export const getById = query({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    return await ctx.db.get(photoId);
  },
});

export const listByOwner = query({
  args: { ownerId: v.id("users") },
  handler: async (ctx, { ownerId }) => {
    return await ctx.db
      .query("photos")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
  },
});

// P6: photo create increments user.photoCount (cat-2 transactional aggregate).
export const create = mutation({
  args: {
    storageId: v.id("_storage"),
    filename: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    takenAt: v.optional(v.number()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    locationLabel: v.optional(v.string()),
  },
  returns: v.id("photos"),
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    if (user.photoCount >= user.photoLimit) {
      throw new Error("Photo limiet bereikt");
    }

    const photoId = await ctx.db.insert("photos", {
      ownerId: user._id,
      storageId: args.storageId,
      filename: args.filename,
      mimeType: args.mimeType,
      width: args.width,
      height: args.height,
      takenAt: args.takenAt,
      latitude: args.latitude,
      longitude: args.longitude,
      locationLabel: args.locationLabel,
      ratingCount: 0,
      createdAt: Date.now(),
    });

    await ctx.db.patch(user._id, { photoCount: user.photoCount + 1 });

    return photoId;
  },
});

// Owner-only update — gebruikt voor manuele EXIF/locatie correctie of
// async geocoding-action. Strict subset van velden, owner check binnen.
export const update = mutation({
  args: {
    photoId: v.id("photos"),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    takenAt: v.optional(v.number()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    locationLabel: v.optional(v.string()),
  },
  handler: async (ctx, { photoId, ...rest }) => {
    const user = await requireCurrentUser(ctx);
    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error("Foto bestaat niet");
    if (photo.ownerId !== user._id) {
      throw new Error("Alleen eigenaar kan foto wijzigen");
    }

    const patch: Partial<Doc<"photos">> = {};
    for (const k of [
      "width",
      "height",
      "takenAt",
      "latitude",
      "longitude",
      "locationLabel",
    ] as const) {
      if (rest[k] !== undefined) (patch[k] as unknown) = rest[k];
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(photoId, patch);
  },
});

// Internal helper: doet de volle cascade voor één photo. Aangeroepen
// door photos.remove (na auth check) en door users.deleteSelf voor
// transitieve cascade door alle photos van de user heen.
//
// Cascade matrix rows P3, P4, P5, P7 + storage cleanup queue (U7).
export async function internalRemovePhoto(
  ctx: MutationCtx,
  photoId: Id<"photos">,
): Promise<void> {
  const photo = await ctx.db.get(photoId);
  if (!photo) return;

  // P3: cascade albumPhotos die naar deze photo verwijzen
  const aps = await ctx.db
    .query("albumPhotos")
    .withIndex("by_photo", (q) => q.eq("photoId", photoId))
    .collect();
  for (const ap of aps) await ctx.db.delete(ap._id);

  // P4: cascade ratings op deze photo
  const ratings = await ctx.db
    .query("ratings")
    .withIndex("by_photo", (q) => q.eq("photoId", photoId))
    .collect();
  for (const r of ratings) await ctx.db.delete(r._id);

  // P5: clear cover-refs op groups/albums die deze photo als cover hadden.
  // Geen index op coverPhotoId (low cardinality, volle scan acceptabel
  // bij huidige schaal — zie cascade-matrix.md voor performance-note).
  const groups = await ctx.db.query("groups").collect();
  for (const g of groups) {
    if (g.coverPhotoId === photoId) {
      await ctx.db.patch(g._id, { coverPhotoId: undefined });
    }
  }
  const albums = await ctx.db.query("albums").collect();
  for (const a of albums) {
    if (a.coverPhotoId === photoId) {
      await ctx.db.patch(a._id, { coverPhotoId: undefined });
    }
  }

  // P7: decrement owner.photoCount (eigenaar kan al gedeleted zijn als
  // we vanuit users.deleteSelf komen — dan slaan we 'm gewoon over).
  const owner = await ctx.db.get(photo.ownerId);
  if (owner) {
    await ctx.db.patch(photo.ownerId, {
      photoCount: Math.max(0, owner.photoCount - 1),
    });
  }

  // U7-style storage cleanup (best-effort async).
  await ctx.scheduler.runAfter(0, internal.photos.cleanupStorage, {
    storageIds: [photo.storageId],
  });

  await ctx.db.delete(photoId);
}

export const remove = mutation({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    const user = await requireCurrentUser(ctx);
    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error("Foto bestaat niet");
    if (photo.ownerId !== user._id) {
      throw new Error("Alleen eigenaar kan foto verwijderen");
    }
    await internalRemovePhoto(ctx, photoId);
  },
});

// U7: best-effort storage cleanup voor photos die door cascade
// (users.deleteSelf, photos.remove) verwijderd zijn. Mutation is
// transactioneel; deze action draait erna en kan idempotent gefaald
// worden. Orphans in storage worden door integrity check opgemerkt.
export const cleanupStorage = internalAction({
  args: { storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, { storageIds }) => {
    for (const id of storageIds) {
      try {
        await ctx.storage.delete(id);
      } catch {
        // Best-effort. Volgende integrity-check ruimt deze op.
      }
    }
  },
});

// FL2: non-owner kan andermans photo flaggen. Idempotent — tweede flag
// op al-geflagde photo is no-op (eerste flagger en timestamps blijven).
// Sets countdown van 14 dagen. Bron: oude AWS handler flagPhoto.js.
export const flag = mutation({
  args: {
    photoId: v.id("photos"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { photoId, reason }) => {
    const user = await requireCurrentUser(ctx);
    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error("Foto bestaat niet");
    if (photo.ownerId === user._id) {
      throw new Error("Eigen foto kan niet geflagd worden");
    }
    if (photo.flaggedAt !== undefined) return;

    const now = Date.now();
    await ctx.db.patch(photoId, {
      flaggedAt: now,
      flaggedBy: user._id,
      flagReason: reason,
      flaggedDeleteDate: now + FLAG_DELETE_DAYS * DAY_MS,
    });
  },
});

// FL2: owner gaat in beroep tegen een flag. Pauzeert countdown door
// flaggedDeleteDate te clearen. Niet meer mogelijk na een denied
// appeal (anders kan owner countdown oneindig pauzeren).
// Bron: oude AWS handler flagPhotoAppeal.js.
export const appeal = mutation({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    const user = await requireCurrentUser(ctx);
    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error("Foto bestaat niet");
    if (photo.ownerId !== user._id) {
      throw new Error("Alleen eigenaar kan in beroep gaan");
    }
    if (photo.flaggedAt === undefined) {
      throw new Error("Foto is niet geflagd");
    }
    if (photo.flaggedAppealDenyDate !== undefined) {
      throw new Error("Beroep is al afgewezen");
    }
    if (photo.flaggedAppealDate !== undefined) return;

    await ctx.db.patch(photoId, {
      flaggedAppealDate: Date.now(),
      flaggedDeleteDate: undefined,
    });
  },
});

// FL2: webmaster beslist over een appeal.
//   approve = clear alle flag-velden (volledige clean state)
//   deny    = set flaggedAppealDenyDate, restart 7d countdown,
//             queue email-action naar owner
// Bron: oude AWS handler flagPhotoDecide.js. Afwijking van oude code:
// alleen email bij deny (cascade-matrix FL2).
export const decideFlag = mutation({
  args: {
    photoId: v.id("photos"),
    approve: v.boolean(),
  },
  handler: async (ctx, { photoId, approve }) => {
    await requireWebmaster(ctx);

    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error("Foto bestaat niet");
    if (photo.flaggedAt === undefined) {
      throw new Error("Foto is niet geflagd");
    }
    if (photo.flaggedAppealDate === undefined) {
      throw new Error("Geen appeal om over te beslissen");
    }

    if (approve) {
      await ctx.db.patch(photoId, {
        flaggedAt: undefined,
        flaggedBy: undefined,
        flagReason: undefined,
        flaggedDeleteDate: undefined,
        flaggedAppealDate: undefined,
        flaggedAppealDenyDate: undefined,
      });
      return;
    }

    const now = Date.now();
    await ctx.db.patch(photoId, {
      flaggedAppealDenyDate: now,
      flaggedDeleteDate: now + DENY_DELETE_DAYS * DAY_MS,
    });
    await ctx.scheduler.runAfter(0, internal.photos.sendFlagDecisionEmail, {
      photoId,
      approve: false,
    });
  },
});

// Eigen photos die door anderen geflagd zijn (Inappropriate.jsx).
export const listMyFlagged = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const owned = await ctx.db
      .query("photos")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    return owned.filter((p) => p.flaggedAt !== undefined);
  },
});

// Webmaster queue: alle photos waar flaggedAt gezet is
// (InappropriateAdmin.jsx).
export const listAllFlagged = query({
  args: {},
  handler: async (ctx) => {
    await requireWebmaster(ctx);
    const all = await ctx.db.query("photos").withIndex("by_flagged").collect();
    return all.filter((p) => p.flaggedAt !== undefined);
  },
});

// FL1: dagelijkse cron. Verwijdert photos waar flaggedDeleteDate < now.
// Photos onder appeal hebben flaggedDeleteDate undefined (door appeal
// gewist) en zijn dus niet zichtbaar in de sparse `by_flagged_delete`
// index — geen aparte filter nodig. internalRemovePhoto verzorgt de
// transitieve cascade (P3-P5+P7) + storage cleanup.
export const cleanupFlaggedPhotos = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const ripe = await ctx.db
      .query("photos")
      .withIndex("by_flagged_delete", (q) => q.lt("flaggedDeleteDate", now))
      .collect();
    for (const photo of ripe) {
      if (photo.flaggedDeleteDate === undefined) continue;
      await internalRemovePhoto(ctx, photo._id);
    }
  },
});

// FL2: stub. Echte Mailjet-implementatie volgt in email-werkpakket
// (zie migratie-plan §Email infrastructure). Hier alleen action-shape
// + signature, zodat decideFlag 'm kan schedulen en de tests een
// zichtbare scheduled function zien.
export const sendFlagDecisionEmail = internalAction({
  args: {
    photoId: v.id("photos"),
    approve: v.boolean(),
  },
  handler: async () => {
    // TODO email-werkpakket: Mailjet template + send. Per cascade-matrix
    // FL2 sturen we alleen bij deny — caller (decideFlag) regelt dat.
  },
});
