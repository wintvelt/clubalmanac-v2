import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { writeRatingAggregate } from "../ratings";
import { isPublishedInAlbum, isPublishedInGroup } from "./photoAccess";

// WP28 A-invariant 3: een publicatie die verdwijnt, neemt cover en ratings
// mee, langs elke weg. Eén cascade voor albums.removePhoto, albums.remove,
// lid weg (M1), laatste lid weg (M2-e) en groups.remove. Cascade-matrix AP3
// en AP4.
//
// Aanroepen ná het wissen van de albumPhotos-rijen (en, bij een lid of groep
// die weg is, ná het wissen van de lidmaatschappen): de checks hieronder
// lezen de toestand zoals hij daarna is. Een album of groep die zelf al weg
// is, slaat de cover-check over.
export async function afterUnpublish(
  ctx: MutationCtx,
  removed: Array<Doc<"albumPhotos">>,
): Promise<void> {
  if (removed.length === 0) return;

  // AP3: per foto één keer. Een rating blijft als de rater de eigenaar is, of
  // lid van een groep waarin de foto nog in een album staat (de definitie van
  // canAccessPhoto). Ook een rating van een ex-lid die al bleef hangen, gaat
  // mee (zoals removePhoto dat al deed).
  const membershipsOf = membershipCache(ctx);
  const photoIds = new Set(removed.map((ap) => ap.photoId));
  for (const photoId of photoIds) {
    await pruneRatings(ctx, photoId, membershipsOf);
  }

  // AP4, album: de cover gaat weg als die foto niet meer in dát album staat.
  const byAlbum = groupBy(removed, (ap) => ap.albumId);
  for (const [albumId, aps] of byAlbum) {
    const album = await ctx.db.get(albumId);
    const cover = album?.coverPhotoId;
    if (!album || !cover) continue;
    if (!aps.some((ap) => ap.photoId === cover)) continue;
    if (!(await isPublishedInAlbum(ctx, cover, albumId))) {
      await ctx.db.patch(albumId, { coverPhotoId: undefined });
    }
  }

  // AP4, groep: de cover gaat weg als die foto in geen album van de groep
  // meer staat (eis 2026-11-07, invariant 5).
  const byGroup = groupBy(removed, (ap) => ap.groupId);
  for (const [groupId, aps] of byGroup) {
    const group = await ctx.db.get(groupId);
    const cover = group?.coverPhotoId;
    if (!group || !cover) continue;
    if (!aps.some((ap) => ap.photoId === cover)) continue;
    if (!(await isPublishedInGroup(ctx, cover, groupId))) {
      await ctx.db.patch(groupId, { coverPhotoId: undefined });
    }
  }
}

type MembershipsOf = (userId: Id<"users">) => Promise<Set<Id<"groups">>>;

function membershipCache(ctx: MutationCtx): MembershipsOf {
  const cache = new Map<Id<"users">, Promise<Set<Id<"groups">>>>();
  return (userId) => {
    let hit = cache.get(userId);
    if (!hit) {
      hit = ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
        .then((ms) => new Set(ms.map((m) => m.groupId)));
      cache.set(userId, hit);
    }
    return hit;
  };
}

async function pruneRatings(
  ctx: MutationCtx,
  photoId: Id<"photos">,
  membershipsOf: MembershipsOf,
): Promise<void> {
  const ratings = await ctx.db
    .query("ratings")
    .withIndex("by_photo", (q) => q.eq("photoId", photoId))
    .collect();
  if (ratings.length === 0) return;

  const photo = await ctx.db.get(photoId);
  const others = ratings.filter((r) => r.userId !== photo?.ownerId);
  if (others.length === 0) return;

  const pubs = await ctx.db
    .query("albumPhotos")
    .withIndex("by_photo", (q) => q.eq("photoId", photoId))
    .collect();
  const pubGroups = new Set(pubs.map((p) => p.groupId));

  const kept: Array<Doc<"ratings">> = [];
  let deletedAny = false;
  for (const r of ratings) {
    if (r.userId === photo?.ownerId) {
      kept.push(r);
      continue;
    }
    const groups = await membershipsOf(r.userId);
    if ([...groups].some((g) => pubGroups.has(g))) {
      kept.push(r);
      continue;
    }
    await ctx.db.delete(r._id);
    deletedAny = true;
  }
  if (deletedAny && photo) await writeRatingAggregate(ctx, photoId, kept);
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}
