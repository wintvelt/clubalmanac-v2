import { v } from "convex/values";
import { internalAction, query } from "./_generated/server";

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

// U7: best-effort storage cleanup voor photos die door cascade
// (users.deleteSelf, photos.delete) verwijderd zijn. Mutation is
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
