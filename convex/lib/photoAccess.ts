import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

// WP23: foto-toegang = eigenaar, óf lid van een groep waarin de foto in een
// album staat (albumPhotos draagt groupId). Geen webmaster-bypass.
//
// Eén definitie voor alle reads: photos.getById/getWithOwner,
// ratings.listForPhoto (via requirePhotoAccess) en de geneste covers in
// groups.getWithCover en albums.getWithCover (invariant 10). Apart in lib/
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
