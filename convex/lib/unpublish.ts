import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { isPublishedInAlbum, isPublishedInGroup } from "./photoAccess";
import { wipeLostForPhotos } from "./profilePhoto";

// WP28 A-invariant 3: een publicatie die verdwijnt, neemt de cover mee,
// langs elke weg. WP27 besluit 7: en de profielfoto van wie daarna geen
// toegang meer heeft tot die foto. Eén cascade voor albums.removePhoto, albums.remove,
// lid weg (M1), laatste lid weg (M2-e) en groups.remove. Cascade-matrix AP4.
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

  const photoIds = new Set(removed.map((ap) => ap.photoId));

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
