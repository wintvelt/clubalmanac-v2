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
  groupOrAlbumName,
  refuse,
  requireAdminForWrite,
  requireDate,
  requireFounder,
  requireMemberForRead,
} from "./groups";
import { requireCurrentUser } from "./users";
import {
  canAccessPhoto,
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
import { afterUnpublish } from "./lib/unpublish";

// WP23: toegang tot een album. Eén weigering voor "album bestaat niet" en
// "geen lid van de groep" (invariant 4: geen bestaans-orakel). Sinds WP28
// fix-cyclus 1 (A-invariant 11) de ConvexError NOT_MEMBER, voor markSeen,
// addPhoto en removePhoto, zoals de reads hieronder en de beheer-paden.
async function requireAlbumAccess(
  ctx: QueryCtx | MutationCtx,
  albumId: Id<"albums">,
) {
  const user = await requireCurrentUser(ctx);
  const album = await ctx.db.get(albumId);
  const membership = album
    ? await getMembership(ctx, user._id, album.groupId)
    : null;
  if (!album || !membership) refuse("NOT_MEMBER");
  return { user, album, membership };
}

// WP17a invariant 7 (WP16 backlog N3): de reads achter het albumscherm geven
// bij geen lid en bij een onbekend of gewist album dezelfde ConvexError met
// code NOT_MEMBER, zoals de groep-reads (requireMemberForRead). De app
// herkent hem aan de code.
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
    // WP28 besluit 2: alleen een admin maakt een album.
    const { user } = await requireAdminForWrite(ctx, groupId);
    const trimmed = groupOrAlbumName(name);
    return await ctx.db.insert("albums", {
      groupId,
      name: trimmed,
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

// WP17d A-invariant 1 en 5: de kaart van een album. Poort zoals listPhotos
// (geen lid, onbekend of gewist album: NOT_MEMBER). Toestemmingslijst: de
// foto's van dit album met beide coördinaten, elke foto één keer; een
// publicatie zonder foto-rij telt niet. Per foto alleen id en exacte plek
// (besluit 1), geen plaatsnaam of andere velden.
export const listLocations = query({
  args: { albumId: v.id("albums") },
  returns: v.array(
    v.object({
      photoId: v.id("photos"),
      latitude: v.number(),
      longitude: v.number(),
    }),
  ),
  handler: async (ctx, { albumId }) => {
    await requireAlbumAccessForRead(ctx, albumId);
    const albumPhotos = await ctx.db
      .query("albumPhotos")
      .withIndex("by_album", (q) => q.eq("albumId", albumId))
      .collect();
    const photoIds = [...new Set(albumPhotos.map((ap) => ap.photoId))];
    const rows = await Promise.all(
      photoIds.map(async (photoId) => {
        const p = await ctx.db.get(photoId);
        if (!p || p.latitude === undefined || p.longitude === undefined) return null;
        return { photoId: p._id, latitude: p.latitude, longitude: p.longitude };
      }),
    );
    return rows.filter((r) => r !== null);
  },
});

// WP17c A-invariant 9 en 10: "in welke albums" in het foto-detail. De poort
// is foto-toegang (dezelfde NOT_MEMBER als photos.getById voor geen toegang,
// onbekend en gewist). Daarna een toestemmingslijst: alleen albums uit
// groepen waar de caller nu lid van is, elk één keer; een album dat weg is,
// telt niet. Van andere publicaties komt niets terug, ook geen aantal.
export const listForPhoto = query({
  args: { photoId: v.id("photos") },
  returns: v.array(
    v.object({
      albumId: v.id("albums"),
      albumName: v.string(),
      groupId: v.id("groups"),
      groupName: v.string(),
    }),
  ),
  handler: async (ctx, { photoId }) => {
    const user = await requireCurrentUser(ctx);
    const photo = await ctx.db.get(photoId);
    if (!photo || !(await canAccessPhoto(ctx, user._id, photo))) {
      throw new ConvexError(NOT_MEMBER);
    }
    const publications = await ctx.db
      .query("albumPhotos")
      .withIndex("by_photo", (q) => q.eq("photoId", photoId))
      .collect();
    const albumIds = [...new Set(publications.map((ap) => ap.albumId))];
    const entries = await Promise.all(
      albumIds.map(async (albumId) => {
        const a = await ctx.db.get(albumId);
        if (!a) return null;
        if (!(await getMembership(ctx, user._id, a.groupId))) return null;
        const g = await ctx.db.get(a.groupId);
        if (!g) return null;
        return { albumId: a._id, albumName: a.name, groupId: g._id, groupName: g.name };
      }),
    );
    return entries.filter((e) => e !== null);
  },
});

// WP28 A-invariant 2: geen lid of onbekend album geeft NOT_MEMBER, voor alle
// album-beheeracties gelijk. Daarna de gate van de groep.
async function requireAlbumForWrite(
  ctx: MutationCtx,
  albumId: Id<"albums">,
): Promise<Doc<"albums">> {
  const album = await ctx.db.get(albumId);
  if (!album) refuse("NOT_MEMBER");
  return album;
}

// Album wijzigen: admin (tabel §Acties). De maker heeft geen eigen recht meer
// (WP28 A-keuze 2).
export const update = mutation({
  args: {
    albumId: v.id("albums"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    // WP28 A-keuze 4: `null` haalt de cover weg; weglaten laat hem staan.
    coverPhotoId: v.optional(v.union(v.id("photos"), v.null())),
    // WP28 invariant 6: de dag (epoch-ms, UTC-middernacht, A-keuze 5).
    sortDate: v.optional(v.number()),
  },
  handler: async (ctx, { albumId, ...rest }) => {
    const album = await requireAlbumForWrite(ctx, albumId);
    await requireAdminForWrite(ctx, album.groupId);
    const name = groupOrAlbumName(rest.name);
    requireDate(rest.sortDate);
    // WP24 invariant 2 + A-keuze 2. Alleen als de cover wordt gezet: een
    // bestaande cover die niet meer in het album staat, blokkeert geen
    // naamswijziging.
    if (
      rest.coverPhotoId &&
      !(await isPublishedInAlbum(ctx, rest.coverPhotoId, albumId))
    ) {
      refuse("COVER_NOT_IN_ALBUM");
    }

    const patch: Partial<Doc<"albums">> = {};
    if (name !== undefined) patch.name = name;
    if (rest.description !== undefined) patch.description = rest.description;
    if (rest.coverPhotoId !== undefined) {
      patch.coverPhotoId = rest.coverPhotoId ?? undefined;
    }
    if (rest.sortDate !== undefined) patch.sortDate = rest.sortDate;
    if (Object.keys(patch).length > 0) await ctx.db.patch(albumId, patch);
  },
});

// WP28 besluit 5 (W5): alleen de oprichter verwijdert een album.
export const remove = mutation({
  args: { albumId: v.id("albums") },
  handler: async (ctx, { albumId }) => {
    const album = await requireAlbumForWrite(ctx, albumId);
    await requireFounder(ctx, album.groupId);

    const albumPhotos = await ctx.db
      .query("albumPhotos")
      .withIndex("by_album", (q) => q.eq("albumId", albumId))
      .collect();
    for (const ap of albumPhotos) await ctx.db.delete(ap._id);

    // A2: cascade albumLastSeen voor dit album.
    await deleteAlbumLastSeenByAlbum(ctx, albumId);

    await ctx.db.delete(albumId);

    // WP28 invariant 5 en A-invariant 3: groepscover en ratings volgen de
    // weggehaalde publicaties (AP3, AP4).
    await afterUnpublish(ctx, albumPhotos);
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
    if (!photo || photo.ownerId !== user._id) refuse("NOT_PHOTO_OWNER");

    const existing = await ctx.db
      .query("albumPhotos")
      .withIndex("by_album", (q) => q.eq("albumId", albumId))
      .filter((q) => q.eq(q.field("photoId"), photoId))
      .unique();
    if (existing) refuse("ALREADY_IN_ALBUM");

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
    // A-invariant 11: geen lid en gewist album geven dezelfde NOT_MEMBER (het
    // orakel van red-team R4 is weg).
    const { user, membership } = await requireAlbumAccess(ctx, albumId);

    const ap = await ctx.db
      .query("albumPhotos")
      .withIndex("by_album", (q) => q.eq("albumId", albumId))
      .filter((q) => q.eq(q.field("photoId"), photoId))
      .unique();
    if (!ap) refuse("NOT_IN_ALBUM");

    const isAdder = ap.addedBy === user._id;
    const isAdmin = membership.role === "admin";
    if (!isAdder && !isAdmin) refuse("NOT_ALLOWED");

    await ctx.db.delete(ap._id);

    // AP3 (ratings van wie geen toegang meer heeft, ook een orphan-rating van
    // een ex-lid) en AP4 (album- en groepscover): de gedeelde cascade, zelfde
    // als bij album weg, lid weg en groep weg (WP28 A-invariant 3).
    await afterUnpublish(ctx, [ap]);
  },
});

