import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";

// Default upload-limiet voor nieuwe users. Mocht een admin een hogere limiet
// willen geven, dan kan dat via directe DB patch (geen public mutation in
// fase 2 — admin flows komen later).
export const DEFAULT_PHOTO_LIMIT = 1000;

export async function getBySubject(
  ctx: QueryCtx,
  subject: string,
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_subject", (q) => q.eq("subject", subject))
    .unique();
}

export async function requireCurrentUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Niet ingelogd");
  const user = await getBySubject(ctx, identity.subject);
  if (!user) throw new Error("User record bestaat niet");
  return user;
}

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await getBySubject(ctx, identity.subject);
  },
});

export const getById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

export const register = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, { email, name }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Niet ingelogd");

    const existing = await getBySubject(ctx, identity.subject);
    if (existing) return existing._id;

    const byEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (byEmail) throw new Error("Email is al in gebruik");

    return await ctx.db.insert("users", {
      subject: identity.subject,
      email,
      name,
      photoCount: 0,
      photoLimit: DEFAULT_PHOTO_LIMIT,
      createdAt: Date.now(),
    });
  },
});

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    profilePhotoStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const patch: Partial<Doc<"users">> = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.profilePhotoStorageId !== undefined) {
      patch.profilePhotoStorageId = args.profilePhotoStorageId;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(user._id, patch);
    }
  },
});

export const recordVisit = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    await ctx.db.patch(user._id, { lastVisitAt: Date.now() });
  },
});

export const deleteSelf = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);

    // U6: cascade ratings die deze user gegeven heeft.
    const ratings = await ctx.db
      .query("ratings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const r of ratings) await ctx.db.delete(r._id);

    // U7: cascade photos die deze user uploadde + queue storage cleanup.
    // Records weg in dezelfde transactie; storage delete loopt async via action.
    const photos = await ctx.db
      .query("photos")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    const storageIds = photos.map((p) => p.storageId);
    for (const p of photos) await ctx.db.delete(p._id);
    if (storageIds.length > 0) {
      await ctx.scheduler.runAfter(0, internal.photos.cleanupStorage, {
        storageIds,
      });
    }

    // U8: cascade memberships. Admin-successie (M2) wordt nog niet
    // toegepast — wordt geadresseerd wanneer memberships-domein landt
    // en deze cascade dan via memberships.deleteOne loopt.
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const m of memberships) await ctx.db.delete(m._id);

    await ctx.db.delete(user._id);
  },
});

// Internal: aangeroepen vanuit photos.create / photos.delete in latere fase.
// Transactioneel met de photo-mutation, dus geen race condities.
export const incrementPhotoCount = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User bestaat niet");
    if (user.photoCount >= user.photoLimit) {
      throw new Error("Photo limiet bereikt");
    }
    await ctx.db.patch(userId, { photoCount: user.photoCount + 1 });
  },
});

export const decrementPhotoCount = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User bestaat niet");
    await ctx.db.patch(userId, {
      photoCount: Math.max(0, user.photoCount - 1),
    });
  },
});
