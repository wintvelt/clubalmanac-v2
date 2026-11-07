// WP25 A-invariant 19 — de foto-rij achter een profielfoto.
//
// Een profielfoto is een beeld (`users.profilePhotoStorageId`), geen foto. Er
// kunnen meer foto-rijen op hetzelfde beeld staan, met een eigen set formaten
// en een eigen stand (WP8). Het profielpad serveert de formaten van één rij,
// en de app draait de avatar met de stand van diezelfde rij. Deze ene functie
// kiest die rij voor allebei, zodat bytes en stand nooit uit elkaar lopen.
//
// Volgorde: een eigen rij met formaten, een andere rij met formaten, een eigen
// rij zonder formaten, een andere rij zonder formaten. Binnen elke stap de
// oudste rij.

import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

function rank(row: Doc<"photos">, userId: Doc<"users">["_id"]): number {
  const own = row.ownerId === userId ? 0 : 1;
  return row.formats !== undefined ? own : 2 + own;
}

export async function profilePhotoRow(
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<Doc<"photos"> | null> {
  const storageId = user.profilePhotoStorageId;
  if (!storageId) return null;
  const rows = await ctx.db
    .query("photos")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .collect();
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => {
    const d = rank(row, user._id) - rank(best, user._id);
    if (d !== 0) return d < 0 ? row : best;
    if (row.createdAt !== best.createdAt) return row.createdAt < best.createdAt ? row : best;
    return row._creationTime < best._creationTime ? row : best;
  });
}

/**
 * `{ profileOrientation }` voor een user-vorm, of `{}` zonder rij of zonder
 * stand. Alleen het getal: geen foto- of beeld-id (WP17a invariant 10).
 */
export async function profileOrientationOf(
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<{ profileOrientation?: number }> {
  const o = (await profilePhotoRow(ctx, user))?.exifOrientation;
  return typeof o === "number" && Number.isInteger(o) && o >= 1 && o <= 8 ? { profileOrientation: o } : {};
}
