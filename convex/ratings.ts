import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireCurrentUser } from "./users";

// Cascade matrix row R1: na elke rating insert/update/delete moeten
// photo.ratingAverage en photo.ratingCount transactioneel herrekend
// worden. Helper hieronder, aangeroepen vanuit upsert + remove en (in
// een latere fase) vanuit photos.remove cascade.
export async function recomputeRatingAggregate(
  ctx: MutationCtx,
  photoId: Id<"photos">,
): Promise<void> {
  const all = await ctx.db
    .query("ratings")
    .withIndex("by_photo", (q) => q.eq("photoId", photoId))
    .collect();

  if (all.length === 0) {
    await ctx.db.patch(photoId, {
      ratingCount: 0,
      ratingAverage: undefined,
    });
    return;
  }

  const sum = all.reduce((acc, r) => acc + r.value, 0);
  await ctx.db.patch(photoId, {
    ratingCount: all.length,
    ratingAverage: sum / all.length,
  });
}

export const upsert = mutation({
  args: {
    photoId: v.id("photos"),
    value: v.number(),
  },
  handler: async (ctx, { photoId, value }) => {
    const user = await requireCurrentUser(ctx);

    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error("Foto bestaat niet");

    const existing = await ctx.db
      .query("ratings")
      .withIndex("by_photo_and_user", (q) =>
        q.eq("photoId", photoId).eq("userId", user._id),
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { value, updatedAt: now });
    } else {
      await ctx.db.insert("ratings", {
        photoId,
        userId: user._id,
        value,
        createdAt: now,
        updatedAt: now,
      });
    }

    await recomputeRatingAggregate(ctx, photoId);
  },
});

export const remove = mutation({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    const user = await requireCurrentUser(ctx);

    const existing = await ctx.db
      .query("ratings")
      .withIndex("by_photo_and_user", (q) =>
        q.eq("photoId", photoId).eq("userId", user._id),
      )
      .unique();
    if (!existing) return;

    await ctx.db.delete(existing._id);
    await recomputeRatingAggregate(ctx, photoId);
  },
});

export const listForPhoto = query({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    return await ctx.db
      .query("ratings")
      .withIndex("by_photo", (q) => q.eq("photoId", photoId))
      .collect();
  },
});
