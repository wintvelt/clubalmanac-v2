import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./groups";

async function requireAlbum(
  ctx: { db: { get: (id: Id<"albums">) => Promise<Doc<"albums"> | null> } },
  albumId: Id<"albums">,
): Promise<Doc<"albums">> {
  const album = await ctx.db.get(albumId);
  if (!album) throw new Error("Album bestaat niet");
  return album;
}

export const create = mutation({
  args: {
    groupId: v.id("groups"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.id("albums"),
  handler: async (ctx, { groupId, name, description }) => {
    const { user } = await requireMember(ctx, groupId);
    return await ctx.db.insert("albums", {
      groupId,
      name,
      description,
      createdBy: user._id,
      createdAt: Date.now(),
    });
  },
});

export const getById = query({
  args: { albumId: v.id("albums") },
  handler: async (ctx, { albumId }) => {
    const album = await requireAlbum(ctx, albumId);
    await requireMember(ctx, album.groupId);
    return album;
  },
});

// Cat-1 join-on-read: album + group data, vervangt denormalized
// group-velden op albums uit DynamoDB. Cascade matrix row G2.
export const getWithGroup = query({
  args: { albumId: v.id("albums") },
  handler: async (ctx, { albumId }) => {
    const album = await requireAlbum(ctx, albumId);
    await requireMember(ctx, album.groupId);
    const group = await ctx.db.get(album.groupId);
    return { ...album, group };
  },
});

export const listByGroup = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    await requireMember(ctx, groupId);
    return await ctx.db
      .query("albums")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
  },
});

export const listPhotos = query({
  args: { albumId: v.id("albums") },
  handler: async (ctx, { albumId }) => {
    const album = await requireAlbum(ctx, albumId);
    await requireMember(ctx, album.groupId);

    const albumPhotos = await ctx.db
      .query("albumPhotos")
      .withIndex("by_album", (q) => q.eq("albumId", albumId))
      .collect();

    return await Promise.all(
      albumPhotos.map(async (ap) => ({
        albumPhoto: ap,
        photo: await ctx.db.get(ap.photoId),
      })),
    );
  },
});

export const update = mutation({
  args: {
    albumId: v.id("albums"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    coverPhotoId: v.optional(v.id("photos")),
  },
  handler: async (ctx, { albumId, ...rest }) => {
    const album = await requireAlbum(ctx, albumId);
    const { user, membership } = await requireMember(ctx, album.groupId);
    const isCreator = album.createdBy === user._id;
    const isAdmin = membership.role === "admin";
    if (!isCreator && !isAdmin) {
      throw new Error("Alleen creator of groep-admin kan album wijzigen");
    }

    const patch: Partial<Doc<"albums">> = {};
    if (rest.name !== undefined) patch.name = rest.name;
    if (rest.description !== undefined) patch.description = rest.description;
    if (rest.coverPhotoId !== undefined) patch.coverPhotoId = rest.coverPhotoId;
    if (Object.keys(patch).length > 0) await ctx.db.patch(albumId, patch);
  },
});

export const remove = mutation({
  args: { albumId: v.id("albums") },
  handler: async (ctx, { albumId }) => {
    const album = await requireAlbum(ctx, albumId);
    const { user, membership } = await requireMember(ctx, album.groupId);
    const isCreator = album.createdBy === user._id;
    const isAdmin = membership.role === "admin";
    if (!isCreator && !isAdmin) {
      throw new Error("Alleen creator of groep-admin kan album verwijderen");
    }

    const albumPhotos = await ctx.db
      .query("albumPhotos")
      .withIndex("by_album", (q) => q.eq("albumId", albumId))
      .collect();
    for (const ap of albumPhotos) await ctx.db.delete(ap._id);

    await ctx.db.delete(albumId);
  },
});

export const addPhoto = mutation({
  args: {
    albumId: v.id("albums"),
    photoId: v.id("photos"),
  },
  handler: async (ctx, { albumId, photoId }) => {
    const album = await requireAlbum(ctx, albumId);
    const { user } = await requireMember(ctx, album.groupId);

    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error("Foto bestaat niet");

    const existing = await ctx.db
      .query("albumPhotos")
      .withIndex("by_album", (q) => q.eq("albumId", albumId))
      .filter((q) => q.eq(q.field("photoId"), photoId))
      .unique();
    if (existing) throw new Error("Foto zit al in dit album");

    await ctx.db.insert("albumPhotos", {
      albumId,
      photoId,
      groupId: album.groupId,
      addedAt: Date.now(),
      addedBy: user._id,
    });
  },
});

export const removePhoto = mutation({
  args: {
    albumId: v.id("albums"),
    photoId: v.id("photos"),
  },
  handler: async (ctx, { albumId, photoId }) => {
    const album = await requireAlbum(ctx, albumId);
    const { user, membership } = await requireMember(ctx, album.groupId);

    const ap = await ctx.db
      .query("albumPhotos")
      .withIndex("by_album", (q) => q.eq("albumId", albumId))
      .filter((q) => q.eq(q.field("photoId"), photoId))
      .unique();
    if (!ap) throw new Error("Foto zit niet in dit album");

    const isAdder = ap.addedBy === user._id;
    const isAdmin = membership.role === "admin";
    if (!isAdder && !isAdmin) {
      throw new Error(
        "Alleen wie de foto toevoegde of een groep-admin kan deze verwijderen",
      );
    }

    await ctx.db.delete(ap._id);
  },
});

