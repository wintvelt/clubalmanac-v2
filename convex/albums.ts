import { ConvexError, v, type Infer } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getMembership,
  NOT_MEMBER,
  requireMember,
  requireMemberForRead,
} from "./groups";
import { requireCurrentUser } from "./users";
import {
  getAccessiblePhoto,
  isPublishedInAlbum,
} from "./lib/photoAccess";
import {
  album,
  albumFields,
  albumPhoto,
  albumPhotoFields,
  group,
  groupFields,
  photo,
  pick,
  publicProfile,
  publicProfileFields,
} from "./lib/shapes";
import { avatarFieldsOf } from "./lib/profilePhoto";
import { photoView } from "./lib/formatSet";
import { recomputeRatingAggregate } from "./ratings";

async function requireAlbum(
  ctx: { db: { get: (id: Id<"albums">) => Promise<Doc<"albums"> | null> } },
  albumId: Id<"albums">,
): Promise<Doc<"albums">> {
  const album = await ctx.db.get(albumId);
  if (!album) throw new Error("Album bestaat niet");
  return album;
}

// WP23: toegang voor album-reads. Eén error voor "album bestaat niet" en
// "geen lid van de groep" (invariant 4: geen bestaans-orakel).
// WP24 invariant 3 + A-keuze 3: ook markSeen, update en addPhoto. remove en
// removePhoto houden requireAlbum + requireMember (orakel-backlog).
const NO_ALBUM_ACCESS = "Geen toegang tot dit album";

// WP24 A-keuze 1: alleen de eigenaar zet een foto in een album. Eén error voor
// onbekend id, geen toegang en wel toegang maar niet eigenaar (invariant 3).
const NOT_PHOTO_OWNER = "Alleen de eigenaar kan deze foto in een album zetten";

// WP24 A-keuze 2: een album-cover staat in dát album. Ook voor een onbekend id.
const COVER_NOT_IN_ALBUM = "Cover moet een foto uit dit album zijn";

async function requireAlbumAccess(
  ctx: QueryCtx | MutationCtx,
  albumId: Id<"albums">,
) {
  const user = await requireCurrentUser(ctx);
  const album = await ctx.db.get(albumId);
  const membership = album
    ? await getMembership(ctx, user._id, album.groupId)
    : null;
  if (!album || !membership) throw new Error(NO_ALBUM_ACCESS);
  return { user, album, membership };
}

// WP17a invariant 7 (WP16 backlog N3): de reads achter het albumscherm geven
// bij geen lid en bij een onbekend of gewist album dezelfde ConvexError met
// code NOT_MEMBER, zoals de groep-reads (requireMemberForRead). De app
// herkent hem aan de code. Mutations houden requireAlbumAccess.
async function requireAlbumAccessForRead(
  ctx: QueryCtx,
  albumId: Id<"albums">,
) {
  const user = await requireCurrentUser(ctx);
  const album = await ctx.db.get(albumId);
  const membership = album
    ? await getMembership(ctx, user._id, album.groupId)
    : null;
  if (!album || !membership) throw new ConvexError(NOT_MEMBER);
  return { user, album, membership };
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
  returns: album,
  handler: async (ctx, { albumId }) => {
    const { album: row } = await requireAlbumAccessForRead(ctx, albumId);
    return pick(row, albumFields);
  },
});

// Cat-1 join-on-read: album + group data, vervangt denormalized
// group-velden op albums uit DynamoDB. Cascade matrix row G2.
export const getWithGroup = query({
  args: { albumId: v.id("albums") },
  returns: v.object({ ...albumFields, group: v.union(group, v.null()) }),
  handler: async (ctx, { albumId }) => {
    const { album: row } = await requireAlbumAccessForRead(ctx, albumId);
    const g = await ctx.db.get(row.groupId);
    return { ...pick(row, albumFields), group: g ? pick(g, groupFields) : null };
  },
});

// Cat-1 join-on-read: album + cover photo. Cascade matrix row P2.
// Cover als foto-vorm (geen GPS, filename of flag-velden), en alleen met
// foto-toegang, anders `null` (invariant 10).
export const getWithCover = query({
  args: { albumId: v.id("albums") },
  returns: v.object({ ...albumFields, cover: v.union(photo, v.null()) }),
  handler: async (ctx, { albumId }) => {
    const { user, album: row } = await requireAlbumAccessForRead(ctx, albumId);
    const cover = await getAccessiblePhoto(ctx, user._id, row.coverPhotoId);
    return {
      ...pick(row, albumFields),
      cover: cover ? await photoView(ctx, cover) : null,
    };
  },
});

export const listByGroup = query({
  args: { groupId: v.id("groups") },
  returns: v.array(album),
  handler: async (ctx, { groupId }) => {
    await requireMemberForRead(ctx, groupId);
    const rows = await ctx.db
      .query("albums")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    return rows.map((a) => pick(a, albumFields));
  },
});

// Live unread-count per album in een groep (vervangt seenPics array,
// cascade matrix AP1 + AP2). Voor elke album:
//   effectiveLastSeen = albumLastSeen?.lastSeenAt
//                     ?? max(album.createdAt, membership.joinedAt)
//   unreadCount = aantal albumPhotos.by_album_added(albumId, addedAt > eff)
//                  waarvan photo.ownerId != currentUserId
// `sortDate` telt niet mee (WP16 besluit 3).
async function effectiveLastSeen(
  ctx: QueryCtx,
  userId: Id<"users">,
  membership: Doc<"memberships">,
  album: Doc<"albums">,
): Promise<number> {
  const lastSeen = await ctx.db
    .query("albumLastSeen")
    .withIndex("by_user_album", (q) =>
      q.eq("userId", userId).eq("albumId", album._id),
    )
    .unique();
  // Strict > overal: foto met addedAt === effectiveLastSeen is niet unread.
  // Zowel lastSeen-pad ("ik heb gezien wat tot T zichtbaar was") als
  // fallback-pad (max-cutoff) gebruiken zelfde semantiek. Zie design-doc
  // sectie "Unread-count per album per user > Strict > semantiek".
  return lastSeen?.lastSeenAt ?? Math.max(album.createdAt, membership.joinedAt);
}

/**
 * WP17a invariant 11: één definitie van "nieuw" voor de teller hieronder en
 * `isNew` in `listPhotos`. Van een ander, en toegevoegd na het effectieve
 * laatste bezoek (strict).
 */
function isNewFor(
  userId: Id<"users">,
  effective: number,
  ap: Doc<"albumPhotos">,
  photo: Doc<"photos"> | null,
): boolean {
  return photo !== null && photo.ownerId !== userId && ap.addedAt > effective;
}

async function unreadInAlbum(
  ctx: QueryCtx,
  userId: Id<"users">,
  membership: Doc<"memberships">,
  album: Doc<"albums">,
): Promise<number> {
  const effective = await effectiveLastSeen(ctx, userId, membership, album);

  const candidates = await ctx.db
    .query("albumPhotos")
    .withIndex("by_album_added", (q) =>
      q.eq("albumId", album._id).gt("addedAt", effective),
    )
    .collect();

  let unreadCount = 0;
  for (const ap of candidates) {
    const photo = await ctx.db.get(ap.photoId);
    if (isNewFor(userId, effective, ap, photo)) unreadCount++;
  }
  return unreadCount;
}

async function albumsOfGroup(ctx: QueryCtx, groupId: Id<"groups">) {
  return await ctx.db
    .query("albums")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
}

// WP16 invariant 10: de teller per groep (groups.listMine) is de som van de
// tellers hieronder. Eén definitie van "nieuw".
export async function sumUnreadInGroup(
  ctx: QueryCtx,
  userId: Id<"users">,
  membership: Doc<"memberships">,
): Promise<number> {
  const albums = await albumsOfGroup(ctx, membership.groupId);
  const counts = await Promise.all(
    albums.map((a) => unreadInAlbum(ctx, userId, membership, a)),
  );
  return counts.reduce((n, c) => n + c, 0);
}

export const listByGroupWithUnread = query({
  args: { groupId: v.id("groups") },
  returns: v.array(v.object({ ...albumFields, unreadCount: v.number() })),
  handler: async (ctx, { groupId }) => {
    const { user, membership } = await requireMemberForRead(ctx, groupId);
    const albums = await albumsOfGroup(ctx, groupId);
    return await Promise.all(
      albums.map(async (album) => ({
        ...pick(album, albumFields),
        unreadCount: await unreadInAlbum(ctx, user._id, membership, album),
      })),
    );
  },
});

// Markeer één album als gezien voor de huidige user.
export const markSeen = mutation({
  args: { albumId: v.id("albums") },
  handler: async (ctx, { albumId }) => {
    const { user } = await requireAlbumAccess(ctx, albumId);
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

// WP17a: per foto ook de eigenaar (publiek profiel, voor het detail) en
// `isNew` voor de caller (de markering in het raster). `isNew` volgt dezelfde
// definitie als de teller (isNewFor, invariant 11). Zonder foto-rij: geen
// eigenaar en niet nieuw.
export const listPhotos = query({
  args: { albumId: v.id("albums") },
  returns: v.array(
    v.object({
      albumPhoto,
      photo: v.union(photo, v.null()),
      owner: v.union(publicProfile, v.null()),
      isNew: v.boolean(),
    }),
  ),
  handler: async (ctx, { albumId }) => {
    const { user, album, membership } = await requireAlbumAccessForRead(
      ctx,
      albumId,
    );
    const effective = await effectiveLastSeen(ctx, user._id, membership, album);

    const albumPhotos = await ctx.db
      .query("albumPhotos")
      .withIndex("by_album", (q) => q.eq("albumId", albumId))
      .collect();

    // Per eigenaar één keer: het publieke profiel met de stand van de avatar.
    const owners = new Map<Id<"users">, Promise<Infer<typeof publicProfile> | null>>();
    const ownerOf = (ownerId: Id<"users">) => {
      if (!owners.has(ownerId)) {
        owners.set(
          ownerId,
          ctx.db.get(ownerId).then(async (u) =>
            u ? { ...pick(u, publicProfileFields), ...(await avatarFieldsOf(ctx, u)) } : null,
          ),
        );
      }
      return owners.get(ownerId)!;
    };

    return await Promise.all(
      albumPhotos.map(async (ap) => {
        const p = await ctx.db.get(ap.photoId);
        const owner = p ? await ownerOf(p.ownerId) : null;
        return {
          albumPhoto: pick(ap, albumPhotoFields),
          photo: p ? await photoView(ctx, p) : null,
          owner,
          isNew: isNewFor(user._id, effective, ap, p),
        };
      }),
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
    const { user, album, membership } = await requireAlbumAccess(
      ctx,
      albumId,
    );
    const isCreator = album.createdBy === user._id;
    const isAdmin = membership.role === "admin";
    if (!isCreator && !isAdmin) {
      throw new Error("Alleen creator of groep-admin kan album wijzigen");
    }
    // WP24 invariant 2 + A-keuze 2. Alleen als de cover wordt gezet: een
    // bestaande cover die niet meer in het album staat, blokkeert geen
    // naamswijziging.
    if (
      rest.coverPhotoId !== undefined &&
      !(await isPublishedInAlbum(ctx, rest.coverPhotoId, albumId))
    ) {
      throw new Error(COVER_NOT_IN_ALBUM);
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
    const { user, album } = await requireAlbumAccess(ctx, albumId);

    // WP24 invariant 2 + A-keuze 1: eigenaar (dus foto-toegang). Vóór de
    // "zit al in album"-check, zodat die niets lekt aan een niet-eigenaar.
    const photo = await ctx.db.get(photoId);
    if (!photo || photo.ownerId !== user._id) {
      throw new Error(NOT_PHOTO_OWNER);
    }

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

