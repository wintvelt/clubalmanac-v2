// WP25 A-invariant 19 en 26 — de foto-rij achter een profielfoto.
// WP27 — en of de profielfoto nog te zien is.
//
// Een profielfoto is een beeld (`users.profilePhotoStorageId`), geen foto. Er
// kunnen meer foto-rijen op hetzelfde beeld staan, met een eigen set formaten
// en een eigen stand (WP8). Het profielpad serveert de formaten van één rij,
// en de app draait de avatar met de stand van diezelfde rij. Deze ene functie
// kiest die rij voor allebei, zodat bytes en stand nooit uit elkaar lopen.
//
// WP27 besluit 7 (A-invariant 11–14): wie de toegang tot de foto kwijtraakt,
// verliest de koppeling in dezelfde mutation (`wipeIfLost`, aangeroepen voor
// de vertrekker en vanuit `afterUnpublish`). Toegang terug geeft niets terug.
//
// `visibleProfilePhoto` blijft als vangnet bij elke lezing (A-invariant 15):
// het profielpad (met en zonder formaat) en de avatar-velden gaan alle drie
// door deze functie, zodat "verborgen" overal gelijk is aan "geen
// profielfoto". Verborgen is: geen toegang meer tot een rij met dat beeld,
// een eigenaar die zijn account verwijdert (A-invariant 13, vanaf
// `deleteSelf`), of een gemelde foto zolang de melding loopt (besluit 8). Een
// melding wist niets: na een goedgekeurd bezwaar is hij terug (A-keuze 4).
// Toegang tot minstens één rij met dat beeld is genoeg (A-keuze 2); daarna
// kiest de volgorde hieronder de rij voor formaat en stand uit alle rijen met
// dat beeld (het zijn dezelfde bytes, en in v2 heeft een beeld maar één rij).
// Een beeld zonder foto-rij (een standaard-knor, een los gemigreerd beeld) is
// van niemand en blijft zichtbaar (A-keuze 1, besluit 6). Een beeld dat niet
// meer in storage staat, telt als geen profielfoto.
//
// Volgorde: een eigen rij met een volledige set, een andere rij met een
// volledige set, een eigen rij zonder, een andere rij zonder. Een dangling set
// telt als "zonder" (invariant 22). Binnen elke stap de oudste rij.

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hasCompleteFormats } from "./formatSet";
import { canAccessPhoto } from "./photoAccess";

export type ProfilePhoto = { row: Doc<"photos">; complete: boolean };

/**
 * De profielfoto zoals iedereen hem ziet: het beeld, en de rij voor formaat
 * en stand (`null` bij een los beeld). `null` = geen profielfoto: geen
 * koppeling, het beeld is weg, of de user heeft geen toegang meer tot een
 * foto met dat beeld. De uitkomst hangt niet af van wie kijkt.
 */
export async function visibleProfilePhoto(
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<{ storageId: Id<"_storage">; chosen: ProfilePhoto | null } | null> {
  const storageId = user.profilePhotoStorageId;
  if (!storageId) return null;
  if (!(await ctx.db.system.get(storageId))) return null;
  const rows = await rowsOf(ctx, storageId);
  if (rows.length === 0) return { storageId, chosen: null };
  if (rows.some(isFlagged)) return null;
  let access = false;
  for (const row of rows) {
    if (!(await canAccessPhoto(ctx, user._id, row))) continue;
    if (row.ownerId !== user._id && (await ctx.db.get(row.ownerId))?.deletion) continue;
    access = true;
    break;
  }
  if (!access) return null;
  return { storageId, chosen: await bestRow(ctx, user, rows) };
}

/**
 * Besluit 8 (A-invariant 17): of het beeld bij een gemelde foto hoort. Kiezen
 * weigert zo'n beeld, met dezelfde weigering als zonder toegang.
 */
export async function isFlaggedImage(ctx: QueryCtx, storageId: Id<"_storage">): Promise<boolean> {
  return (await rowsOf(ctx, storageId)).some(isFlagged);
}

/**
 * Besluit 7 (A-invariant 11 en 14): wist de koppeling van `userId` als hij
 * geen toegang meer heeft tot een rij met dat beeld. Een los beeld (knor)
 * blijft, net als een eigen foto en toegang via een andere groep. Alleen
 * toegang telt: een melding wist niets (A-invariant 19). Aanroepen ná het
 * wissen van wat de toegang wegnam, in dezelfde mutation.
 */
export async function wipeIfLost(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  const user = await ctx.db.get(userId);
  const storageId = user?.profilePhotoStorageId;
  if (!user || !storageId) return;
  await wipeUnlessAccess(ctx, user, await rowsOf(ctx, storageId));
}

/**
 * Besluit 7 vanuit `afterUnpublish`: wie een van deze foto's als profielfoto
 * heeft, en daarna geen toegang meer, verliest de koppeling. A-invariant 16:
 * één read van de users (op prod 20) en per user met een profielfoto één
 * `by_storage`-lookup, niet per foto alle users.
 */
export async function wipeLostForPhotos(
  ctx: MutationCtx,
  photoIds: Set<Id<"photos">>,
): Promise<void> {
  if (photoIds.size === 0) return;
  const users = await ctx.db.query("users").collect();
  for (const user of users) {
    if (!user.profilePhotoStorageId) continue;
    const rows = await rowsOf(ctx, user.profilePhotoStorageId);
    if (!rows.some((r) => photoIds.has(r._id))) continue;
    await wipeUnlessAccess(ctx, user, rows);
  }
}

async function wipeUnlessAccess(
  ctx: MutationCtx,
  user: Doc<"users">,
  rows: Doc<"photos">[],
): Promise<void> {
  if (rows.length === 0) return;
  for (const row of rows) {
    if (await canAccessPhoto(ctx, user._id, row)) return;
  }
  await ctx.db.patch(user._id, { profilePhotoStorageId: undefined });
}

async function rowsOf(ctx: QueryCtx, storageId: Id<"_storage">): Promise<Doc<"photos">[]> {
  return await ctx.db
    .query("photos")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .collect();
}

function isFlagged(row: Doc<"photos">): boolean {
  return row.flaggedAt !== undefined;
}

/** De rij van het profielpad uit `rows`, en of die een volledige set heeft. */
async function bestRow(
  ctx: QueryCtx,
  user: Doc<"users">,
  rows: Doc<"photos">[],
): Promise<ProfilePhoto | null> {
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
export function profileVersionOf(id: Id<"_storage"> | undefined): string {
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
 * of beeld-id (WP17a invariant 10). Een verborgen profielfoto geeft dezelfde
 * velden als geen profielfoto (WP27 A-invariant 2).
 */
export async function avatarFieldsOf(
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<{ profileOrientation?: number; profileHasFormats: boolean; profileVersion: string }> {
  const visible = await visibleProfilePhoto(ctx, user);
  const chosen = visible?.chosen ?? null;
  const o = chosen?.row.exifOrientation;
  const valid = typeof o === "number" && Number.isInteger(o) && o >= 1 && o <= 8;
  return {
    ...(valid ? { profileOrientation: o } : {}),
    profileHasFormats: chosen?.complete ?? false,
    profileVersion: profileVersionOf(visible?.storageId),
  };
}
