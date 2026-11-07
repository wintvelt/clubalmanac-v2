// WP25 — of een foto een volledige set formaten heeft (A-invariant 22 en 26).
//
// Volledig: het veld `formats` staat, en beide objecten bestaan nog in storage.
// Alleen dan geeft het beeldpad een formaat; anders het origineel. Een set met
// een ontbrekend object (dangling) telt overal als "geen formaten": in de
// backfill, in de telling, in de rang van de profielfoto en in `hasFormats`.

import type { Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { photo as photoShape, photoFields, pick } from "./shapes";

export async function hasCompleteFormats(ctx: QueryCtx, photo: Doc<"photos">): Promise<boolean> {
  if (!photo.formats) return false;
  return (
    (await ctx.db.system.get(photo.formats.klein)) !== null &&
    (await ctx.db.system.get(photo.formats.groot)) !== null
  );
}

/**
 * De foto-vorm: de whitelist-velden plus `hasFormats` (A-invariant 26). Die
 * komt uit dezelfde query als `exifOrientation`, zodat de app bytes en stand
 * tegelijk wisselt.
 */
export async function photoView(ctx: QueryCtx, photo: Doc<"photos">): Promise<Infer<typeof photoShape>> {
  return { ...pick(photo, photoFields), hasFormats: await hasCompleteFormats(ctx, photo) };
}
