import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./groups";
import { recomputeRatingAggregate } from "./ratings";

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

// Cat-1 join-on-read: album + cover photo. Cascade matrix row P2.
export const getWithCover = query({
  args: { albumId: v.id("albums") },
  handler: async (ctx, { albumId }) => {
    const album = await requireAlbum(ctx, albumId);
    await requireMember(ctx, album.groupId);
    const cover = album.coverPhotoId
      ? await ctx.db.get(album.coverPhotoId)
      : null;
    return { ...album, cover };
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

// Live unread-count per album in een groep (vervangt seenPics array,
// cascade matrix AP1 + AP2). Voor elke album:
//   effectiveLastSeen = albumLastSeen?.lastSeenAt
//                     ?? max(album.createdAt, membership.joinedAt)
//   unreadCount = aantal albumPhotos.by_album_added(albumId, addedAt > eff)
//                  waarvan photo.ownerId != currentUserId
export const listByGroupWithUnread = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    const { user, membership } = await requireMember(ctx, groupId);
    const albums = await ctx.db
      .query("albums")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();

    return await Promise.all(
      albums.map(async (album) => {
        const lastSeen = await ctx.db
          .query("albumLastSeen")
          .withIndex("by_user_album", (q) =>
            q.eq("userId", user._id).eq("albumId", album._id),
          )
          .unique();
        // Strict > overal: foto met addedAt === effectiveLastSeen is niet unread.
        // Zowel lastSeen-pad ("ik heb gezien wat tot T zichtbaar was") als
        // fallback-pad (max-cutoff) gebruiken zelfde semantiek. Zie design-doc
        // sectie "Unread-count per album per user > Strict > semantiek".
        const effective =
          lastSeen?.lastSeenAt ??
          Math.max(album.createdAt, membership.joinedAt);

        const candidates = await ctx.db
          .query("albumPhotos")
          .withIndex("by_album_added", (q) =>
            q.eq("albumId", album._id).gt("addedAt", effective),
          )
          .collect();

        let unreadCount = 0;
        for (const ap of candidates) {
          const photo = await ctx.db.get(ap.photoId);
          if (photo && photo.ownerId !== user._id) unreadCount++;
        }

        return { ...album, unreadCount };
      }),
    );
  },
});

// Markeer één album als gezien voor de huidige user.
export const markSeen = mutation({
  args: { albumId: v.id("albums") },
  handler: async (ctx, { albumId }) => {
    const album = await requireAlbum(ctx, albumId);
    const { user } = await requireMember(ctx, album.groupId);
    await upsertAlbumLastSeen(ctx, user._id, albumId, Date.now());
  },
});

async function upsertAlbumLastSeen(
  ctx: MutationCtx,
  userId: Id<"users">,
  albumId: Id<"albums">,
  lastSeenAt: number,
): Promise<void> {
  const existing = await ctx.db
    .query("albumLastSeen")
    .withIndex("by_user_album", (q) =>
      q.eq("userId", userId).eq("albumId", albumId),
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { lastSeenAt });
  } else {
    await ctx.db.insert("albumLastSeen", { userId, albumId, lastSeenAt });
  }
}

// Re-export helper voor groups.markAllAlbumsSeen.
export { upsertAlbumLastSeen };

// Helper aangeroepen door cascades (A2, M3). U9 is eliminated — cleanup
// gaat transitief via M3 vanuit internalRemoveMember (U8).
export async function deleteAlbumLastSeenByAlbum(
  ctx: MutationCtx,
  albumId: Id<"albums">,
): Promise<void> {
  const records = await ctx.db
    .query("albumLastSeen")
    .withIndex("by_album", (q) => q.eq("albumId", albumId))
    .collect();
  for (const r of records) await ctx.db.delete(r._id);
}

// M3: delete albumLastSeen records voor (user × albums in déze group).
export async function deleteAlbumLastSeenForUserInGroup(
  ctx: MutationCtx,
  userId: Id<"users">,
  groupId: Id<"groups">,
): Promise<void> {
  const userRecords = await ctx.db
    .query("albumLastSeen")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const r of userRecords) {
    const album = await ctx.db.get(r.albumId);
    if (album?.groupId === groupId) await ctx.db.delete(r._id);
  }
}

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

    // A2: cascade albumLastSeen voor dit album.
    await deleteAlbumLastSeenByAlbum(ctx, albumId);

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

    // AP3: ruim ratings op van users die toegang verliezen tot deze photo na
    // publicatie-removal. Iteratie via by_photo (alle ratings), per rater
    // checken of er nog access bestaat via owner-status of overige memberships.
    // [GAP] Iteratie-shape verschilt van AWS groupPhotoDelToRating.js (die
    // itereerde over group-members). Convex-aanpak is strikter: ruimt ook
    // orphan-ratings op van ex-members wier rating-rows bleven hangen na
    // membership-delete. Bewuste verbetering, geen functionele regression.
    const ratingsOnPhoto = await ctx.db
      .query("ratings")
      .withIndex("by_photo", (q) => q.eq("photoId", photoId))
      .collect();

    let deletedAny = false;
    if (ratingsOnPhoto.length > 0) {
      const photo = await ctx.db.get(photoId);
      const remainingPubs = await ctx.db
        .query("albumPhotos")
        .withIndex("by_photo", (q) => q.eq("photoId", photoId))
        .collect();

      for (const r of ratingsOnPhoto) {
        if (photo && r.userId === photo.ownerId) continue; // owner houdt access
        const userMemberships = await ctx.db
          .query("memberships")
          .withIndex("by_user", (q) => q.eq("userId", r.userId))
          .collect();
        const userGroupIds = new Set(userMemberships.map((m) => m.groupId));
        const stillHasAccess = remainingPubs.some((p) =>
          userGroupIds.has(p.groupId),
        );
        if (stillHasAccess) continue;
        await ctx.db.delete(r._id);
        deletedAny = true;
      }
    }
    if (deletedAny) {
      await recomputeRatingAggregate(ctx, photoId);
    }

    // AP4: clear album cover als deze publicatie cover was.
    if (album.coverPhotoId === photoId) {
      await ctx.db.patch(albumId, { coverPhotoId: undefined });
    }

    // AP4: clear group cover als de photo group-cover was én er geen
    // andere publicatie van deze photo in déze group meer overblijft.
    // Matcht AWS groupPhotoDelToCover.js regel 20-31 (clear cover wanneer
    // laatste publication weg). by_photo geeft alle resterende publicaties
    // van deze photo (de huidige ap is hierboven al gedelete); daarvan
    // filteren we op groupId. Andere groups blijven onaangeroerd.
    const group = await ctx.db.get(album.groupId);
    if (group?.coverPhotoId === photoId) {
      const remainingInGroup = await ctx.db
        .query("albumPhotos")
        .withIndex("by_photo", (q) => q.eq("photoId", photoId))
        .filter((q) => q.eq(q.field("groupId"), album.groupId))
        .first();
      if (!remainingInGroup) {
        await ctx.db.patch(group._id, { coverPhotoId: undefined });
      }
    }
  },
});

