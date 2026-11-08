// WP25 A-invariant 19 en 26 — de foto-rij achter een profielfoto.
//
// Een profielfoto is een beeld (`users.profilePhotoStorageId`), geen foto. Er
// kunnen meer foto-rijen op hetzelfde beeld staan, met een eigen set formaten
// en een eigen stand (WP8). Het profielpad serveert de formaten van één rij,
// en de app draait de avatar met de stand van diezelfde rij. Deze ene functie
// kiest die rij voor allebei, zodat bytes en stand nooit uit elkaar lopen.
//
// Volgorde: een eigen rij met een volledige set, een andere rij met een
// volledige set, een eigen rij zonder, een andere rij zonder. Een dangling set
// telt als "zonder" (invariant 22). Binnen elke stap de oudste rij.

import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { hasCompleteFormats } from "./formatSet";

export type ProfilePhoto = { row: Doc<"photos">; complete: boolean };

/** De rij van het profielpad, en of die een volledige set heeft. */
export async function profilePhotoRow(ctx: QueryCtx, user: Doc<"users">): Promise<ProfilePhoto | null> {
  const storageId = user.profilePhotoStorageId;
  if (!storageId) return null;
  const rows = await ctx.db
    .query("photos")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .collect();
  let best: (ProfilePhoto & { rank: number }) | null = null;
  for (const row of rows) {
    const complete = await hasCompleteFormats(ctx, row);
    const rank = (complete ? 0 : 2) + (row.ownerId === user._id ? 0 : 1);
    if (
      best === null ||
      rank < best.rank ||
      (rank === best.rank &&
        (row.createdAt < best.row.createdAt ||
          (row.createdAt === best.row.createdAt && row._creationTime < best.row._creationTime)))
    ) {
      best = { row, complete, rank };
    }
  }
  return best && { row: best.row, complete: best.complete };
}

/**
 * WP17b invariant 13: een ondoorzichtige versie van het beeld achter de
 * avatar. De profiel-URL is per user gelijk; aan deze string ziet de app dat
 * er een ander beeld staat. Een 53-bits hash van het beeld-id, base 36: gelijk
 * zolang het beeld gelijk is, en het id is er niet uit terug te halen. Zonder
 * beeld "0".
 */
export function profileVersionOf(user: Doc<"users">): string {
  const id = user.profilePhotoStorageId;
  if (!id) return "0";
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `v${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/**
 * De avatar-velden van een user-vorm: `profileHasFormats` (altijd),
 * `profileOrientation` (alleen een geldige stand, 1–8), allebei van de rij van
 * het profielpad, en `profileVersion` (altijd, WP17b invariant 13). Geen foto-
 * of beeld-id (WP17a invariant 10).
 */
export async function avatarFieldsOf(
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<{ profileOrientation?: number; profileHasFormats: boolean; profileVersion: string }> {
  const chosen = await profilePhotoRow(ctx, user);
  const o = chosen?.row.exifOrientation;
  const valid = typeof o === "number" && Number.isInteger(o) && o >= 1 && o <= 8;
  return {
    ...(valid ? { profileOrientation: o } : {}),
    profileHasFormats: chosen?.complete ?? false,
    profileVersion: profileVersionOf(user),
  };
}
