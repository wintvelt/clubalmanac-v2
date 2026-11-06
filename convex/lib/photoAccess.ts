import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

// WP23: foto-toegang = eigenaar, óf lid van een groep waarin de foto in een
// album staat (albumPhotos draagt groupId). Geen webmaster-bypass.
//
// Eén definitie voor alle reads: photos.getById/getWithOwner,
// ratings.listForPhoto (via requirePhotoAccess) en de geneste covers in
// groups.getWithCover en albums.getWithCover (invariant 10). WP24: ook de
// write-gates (photos.flag en ratings.upsert via requirePhotoAccess; covers,
// addPhoto en het beeld via de strengere regels hieronder). Apart in lib/
// zodat groups.ts en albums.ts het kunnen gebruiken zonder photos.ts te
// importeren.
export async function canAccessPhoto(
  ctx: QueryCtx,
  userId: Id<"users">,
  photo: Doc<"photos">,
): Promise<boolean> {
  if (photo.ownerId === userId) return true;
  const aps = await ctx.db
    .query("albumPhotos")
    .withIndex("by_photo", (q) => q.eq("photoId", photo._id))
    .collect();
  const groupIds = [...new Set(aps.map((ap) => ap.groupId))];
  for (const groupId of groupIds) {
    const m = await ctx.db
      .query("memberships")
      .withIndex("by_user_and_group", (q) =>
        q.eq("userId", userId).eq("groupId", groupId),
      )
      .unique();
    if (m) return true;
  }
  return false;
}

/**
 * Geneste foto (cover) voor `userId`: de rij als die bestaat én de user er
 * foto-toegang toe heeft, anders `null` (invariant 10).
 */
export async function getAccessiblePhoto(
  ctx: QueryCtx,
  userId: Id<"users">,
  photoId: Id<"photos"> | undefined,
): Promise<Doc<"photos"> | null> {
  if (!photoId) return null;
  const photo = await ctx.db.get(photoId);
  if (!photo) return null;
  return (await canAccessPhoto(ctx, userId, photo)) ? photo : null;
}

// WP24 A-keuze 2: een cover is een publicatie. Een groep-cover staat in een
// album van díe groep, een album-cover in dát album. Wie de cover zet, is lid
// van die groep (rol-check in de mutation), dus foto-toegang volgt eruit:
// dit is een strengere regel bovenop canAccessPhoto, geen tweede definitie.
// Een onbekend photo-id heeft geen publicatie en valt in dezelfde tak.
export async function isPublishedInGroup(
  ctx: QueryCtx,
  photoId: Id<"photos">,
  groupId: Id<"groups">,
): Promise<boolean> {
  const ap = await ctx.db
    .query("albumPhotos")
    .withIndex("by_photo", (q) => q.eq("photoId", photoId))
    .filter((q) => q.eq(q.field("groupId"), groupId))
    .first();
  return ap !== null;
}

export async function isPublishedInAlbum(
  ctx: QueryCtx,
  photoId: Id<"photos">,
  albumId: Id<"albums">,
): Promise<boolean> {
  const ap = await ctx.db
    .query("albumPhotos")
    .withIndex("by_photo", (q) => q.eq("photoId", photoId))
    .filter((q) => q.eq(q.field("albumId"), albumId))
    .first();
  return ap !== null;
}

// WP24 invariant 8, aangescherpt door WP17a besluit 10 / invariant 16: een
// publieke mutation koppelt een beeld (storageId) alleen aan de caller als dat
// beeld al van de caller is. Toegestaan: het beeld van minstens één foto
// waarvan de caller de eigenaar is (een eigen upload inbegrepen; een beeld aan
// foto's van twee eigenaren mag elk van beide gebruiken), of de eigen huidige
// profielfoto (ook een los, gemigreerd v1-beeld). Foto-toegang tot de foto van
// een ander is niet genoeg: een profielfoto is openbaar (WP17a besluit 8).
// Geweigerd: al het andere, ook andermans profielbeeld en een los beeld. Een
// onbekend beeld-id heeft geen foto-rij en valt in dezelfde tak (één uitkomst,
// geen orakel).
//
// Het enige publieke pad met een beeld-id is users.updateProfile
// (photos.create is intern); tests/writeGates/storageReuse.test.ts pint dat.
export async function canUseStorage(
  ctx: QueryCtx,
  user: Doc<"users">,
  storageId: Id<"_storage">,
): Promise<boolean> {
  if (user.profilePhotoStorageId === storageId) return true;
  const photos = await ctx.db
    .query("photos")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .collect();
  return photos.some((p) => p.ownerId === user._id);
}
