import type { convexTest } from "convex-test";
import type { Id } from "../../convex/_generated/dataModel";

// WP24: melden, beoordelen, als cover zetten en in een album zetten vereisen
// foto-toegang (eigenaar, of lid van een groep waarin de foto in een album
// staat). Tests die zo'n mutation als opzet gebruiken, geven de betrokken
// users toegang met deze seed: één groep met de eigenaar (admin) en de
// gegeven users (member), één album, en de foto in dat album. Geen auth,
// geen cascades.
export async function shareInGroup(
  t: ReturnType<typeof convexTest>,
  photoId: Id<"photos">,
  memberIds: Id<"users">[],
): Promise<{ groupId: Id<"groups">; albumId: Id<"albums"> }> {
  return await t.run(async (ctx) => {
    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error("shareInGroup: foto bestaat niet");
    const now = Date.now();
    const groupId = await ctx.db.insert("groups", {
      name: "Gedeeld",
      createdBy: photo.ownerId,
      createdAt: now,
    });
    await ctx.db.insert("memberships", {
      userId: photo.ownerId,
      groupId,
      role: "admin",
      joinedAt: now,
    });
    for (const userId of memberIds) {
      if (userId === photo.ownerId) continue;
      await ctx.db.insert("memberships", {
        userId,
        groupId,
        role: "member",
        joinedAt: now,
      });
    }
    const albumId = await ctx.db.insert("albums", {
      groupId,
      name: "Gedeeld",
      createdBy: photo.ownerId,
      createdAt: now,
    });
    await ctx.db.insert("albumPhotos", {
      albumId,
      photoId,
      groupId,
      addedAt: now,
      addedBy: photo.ownerId,
    });
    return { groupId, albumId };
  });
}
