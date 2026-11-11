import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { recomputeRatingAggregate, writeRatingAggregate } from "../ratings";
import { isPublishedInAlbum, isPublishedInGroup } from "./photoAccess";
import { wipeLostForPhotos } from "./profilePhoto";

// WP28 A-invariant 3: een publicatie die verdwijnt, neemt cover en ratings
// mee, langs elke weg. WP27 besluit 7: en de profielfoto van wie daarna geen
// toegang meer heeft tot die foto. Eén cascade voor albums.removePhoto, albums.remove,
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

  // WP27 besluit 7 (A-invariant 11): wie een van deze foto's als profielfoto
  // had en er geen toegang meer toe heeft, krijgt de letter.
  await wipeLostForPhotos(ctx, photoIds);
}

/**
 * WP28 A-invariant 7 (R1): wie uit een groep verdwijnt, verliest zijn ratings
 * op de foto's die hij daarna niet meer ziet. Aanroepen ná het wissen van zijn
 * lidmaatschap. `groupPhotoIds` zijn de foto's die in die groep gepubliceerd
 * stonden: alleen daar kan zijn toegang veranderd zijn. Een rating op een
 * eigen foto (`owned`), of op een foto die hij via een andere groep ziet,
 * blijft.
 *
 * A-invariant 14: binnen de Convex-limieten ook bij een rating op elke foto
 * van een grote groep. Geen lookup per rating: wat hij nog ziet komt uit de
 * publicaties van zijn andere groepen (één read per groep), en per foto
 * waarvan een rating weggaat volgt één read voor het nieuwe aggregaat. Die
 * foto's bestaan: ze stonden in de groep.
 */
export async function pruneRatingsOfLeaver(
  ctx: MutationCtx,
  userId: Id<"users">,
  groupPhotoIds: Set<Id<"photos">>,
  owned: Set<Id<"photos">>,
): Promise<void> {
  const ratings = await ctx.db
    .query("ratings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const candidates = ratings.filter(
    (r) => groupPhotoIds.has(r.photoId) && !owned.has(r.photoId),
  );
  if (candidates.length === 0) return;

  const groups = await membershipCache(ctx)(userId);
  const stillSeen = await photosPublishedIn(ctx, groups);
  const touched = new Set<Id<"photos">>();
  for (const r of candidates) {
    if (stillSeen.has(r.photoId)) continue;
    await ctx.db.delete(r._id);
    touched.add(r.photoId);
  }
  for (const photoId of touched) {
    await recomputeRatingAggregate(ctx, photoId);
  }
}

/** De foto's die in een album van een van deze groepen staan, één read per groep. */
export async function photosPublishedIn(
  ctx: MutationCtx,
  groupIds: Iterable<Id<"groups">>,
): Promise<Set<Id<"photos">>> {
  const out = new Set<Id<"photos">>();
  for (const groupId of groupIds) {
    const aps = await ctx.db
      .query("albumPhotos")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    for (const ap of aps) out.add(ap.photoId);
  }
  return out;
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
