import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getBySubject } from "./users";
import { canAccessPhoto, isPublishedInGroup } from "./lib/photoAccess";
import { isInviteAcceptable } from "./groups";
import { normalizeEmail } from "./lib/email";
import { visibleProfilePhoto } from "./lib/profilePhoto";

// WP17a: de toegangsregel voor beeldbytes (invariant 1, 2, 3, 13, 14).
// Het beeldpad (`GET /beeld/...`, convex/http.ts, besluit 1: vorm B) vraagt
// bij elk verzoek "welk beeld krijgt deze caller nu?" en serveert dat, of één
// en hetzelfde 404. Geen `getUrl` naar de client: een storage-URL is een
// bearer-link zonder vervaldatum (spec kernvondst 1).
//
// De id's komen ruw uit het pad, dus de args zijn strings: een misvormd id,
// een id van een andere tabel en een onbekend id vallen zo in dezelfde tak
// als geen toegang (`null`), zonder validatiefout en zonder 500.

// WP25: de keuze van het beeldpad als er een formaat gevraagd is. Het
// storage-id blijft binnen de server (WP17a invariant 10).
const formaatArg = v.union(v.literal("klein"), v.literal("groot"));
const imageChoice = v.object({ storageId: v.id("_storage"), fallback: v.boolean() });

/** Bestaat het beeld nog in storage? De cleanup na wissen loopt async. */
async function storedImage(
  ctx: QueryCtx,
  storageId: Id<"_storage"> | undefined,
): Promise<Id<"_storage"> | null> {
  if (!storageId) return null;
  const meta = await ctx.db.system.get(storageId);
  return meta ? storageId : null;
}

/**
 * Foto: het beeld als de caller nu foto-toegang heeft (`canAccessPhoto`,
 * WP23: eigenaar, of lid van een groep met de foto in een album; geen
 * webmaster-bypass). Anders `null`: uitgelogd, geen users-rij, geen toegang,
 * onbekend of misvormd id, foto of beeld gewist.
 */
export const photoImage = internalQuery({
  args: { photoId: v.string() },
  returns: v.union(v.id("_storage"), v.null()),
  handler: async (ctx, { photoId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await getBySubject(ctx, identity.subject);
    if (!user) return null;
    const id = ctx.db.normalizeId("photos", photoId);
    if (!id) return null;
    const photo = await ctx.db.get(id);
    if (!photo || !(await canAccessPhoto(ctx, user._id, photo))) return null;
    return await storedImage(ctx, photo.storageId);
  },
});

/**
 * WP25: het beeld van een foto in een formaat. Eerst dezelfde toegangsregel als
 * `photoImage`; pas daarna wordt het formaat gekozen (invariant 4). Ontbreekt
 * het formaat, of wijst het naar een gewist object, dan het origineel met
 * `fallback: true` (invariant 3, A-invariant 13). `null` = 404.
 */
export const photoImageInFormat = internalQuery({
  args: { photoId: v.string(), formaat: formaatArg },
  returns: v.union(imageChoice, v.null()),
  handler: async (ctx, { photoId, formaat }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await getBySubject(ctx, identity.subject);
    if (!user) return null;
    const id = ctx.db.normalizeId("photos", photoId);
    if (!id) return null;
    const photo = await ctx.db.get(id);
    if (!photo || !(await canAccessPhoto(ctx, user._id, photo))) return null;
    const original = await storedImage(ctx, photo.storageId);
    if (!original) return null;
    return await chooseFormat(ctx, photo, formaat, original);
  },
});

/**
 * Profiel (besluit 8): openbaar, ook uitgelogd. Alleen het beeld dat nú de
 * profielfoto van die user is; een vorige profielfoto of een ander beeld van
 * die user levert dit pad nooit op. Geen profielfoto, een gewist beeld en een
 * onbekend of misvormd user-id: `null` (invariant 14). WP27: ook `null` als
 * de user geen toegang meer heeft tot een foto met dat beeld
 * (`visibleProfilePhoto`).
 */
export const profileImage = internalQuery({
  args: { userId: v.string() },
  returns: v.union(v.id("_storage"), v.null()),
  handler: async (ctx, { userId }) => {
    const id = ctx.db.normalizeId("users", userId);
    if (!id) return null;
    const user = await ctx.db.get(id);
    if (!user) return null;
    return (await visibleProfilePhoto(ctx, user))?.storageId ?? null;
  },
});

/**
 * WP25: de huidige profielfoto in een formaat (A-kernvondst 5). Een
 * profielfoto heeft geen eigen formaten: het formaat is dat van de foto met
 * hetzelfde beeld, bij voorkeur een foto van die user zelf. Alleen het beeld
 * dat nú de profielfoto is; een los beeld zonder foto-rij of een foto zonder
 * formaten geeft het origineel met `fallback: true`.
 */
export const profileImageInFormat = internalQuery({
  args: { userId: v.string(), formaat: formaatArg },
  returns: v.union(imageChoice, v.null()),
  handler: async (ctx, { userId, formaat }) => {
    const id = ctx.db.normalizeId("users", userId);
    if (!id) return null;
    const user = await ctx.db.get(id);
    if (!user) return null;
    // Dezelfde regel en dezelfde rij als de avatar-velden (A-invariant 19,
    // WP27 A-invariant 1).
    const visible = await visibleProfilePhoto(ctx, user);
    if (!visible) return null;
    const { storageId: original, chosen } = visible;
    if (!chosen?.row.formats) return { storageId: original, fallback: true };
    return await chooseFormat(ctx, chosen.row, formaat, original);
  },
});

/**
 * WP19b besluit 2 (V4), A-invariant 15: de cover van de groep van een
 * ontvangen uitnodiging, voor de genodigde. De smalste uitzondering op de
 * foto-toegang: de sleutel is de uitnodiging, niet de foto, en
 * `canAccessPhoto` verandert niet.
 * - Alleen een ingelogde caller met een users-rij, alleen voor een uitnodiging
 *   aan zijn eigen adres die nu accepteerbaar is.
 * - Alleen de cover van die groep, en alleen als die in een album van die
 *   groep staat (WP24). Geen origineel: de aanroeper vraagt altijd een
 *   formaat; zonder formaten het origineel met `fallback: true` (dat het pad
 *   alleen schoongemaakt verstuurt).
 * Al het andere: `null`, één 404.
 */
export const inviteCoverInFormat = internalQuery({
  args: { inviteId: v.string(), formaat: formaatArg },
  returns: v.union(imageChoice, v.null()),
  handler: async (ctx, { inviteId, formaat }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await getBySubject(ctx, identity.subject);
    if (!user) return null;
    const id = ctx.db.normalizeId("invites", inviteId);
    if (!id) return null;
    const invite = await ctx.db.get(id);
    if (!invite || invite.email !== normalizeEmail(user.email)) return null;
    if (!(await isInviteAcceptable(ctx, invite, Date.now()))) return null;
    const group = await ctx.db.get(invite.groupId!);
    if (!group?.coverPhotoId) return null;
    const cover = await ctx.db.get(group.coverPhotoId);
    if (!cover || !(await isPublishedInGroup(ctx, cover._id, group._id))) return null;
    const original = await storedImage(ctx, cover.storageId);
    if (!original) return null;
    return await chooseFormat(ctx, cover, formaat, original);
  },
});

/** Het formaat van een foto, of het origineel als terugval. */
async function chooseFormat(
  ctx: QueryCtx,
  photo: Doc<"photos">,
  formaat: ImageFormat,
  original: Id<"_storage">,
): Promise<{ storageId: Id<"_storage">; fallback: boolean }> {
  const format = await storedImage(ctx, photo.formats?.[formaat]);
  return format ? { storageId: format, fallback: false } : { storageId: original, fallback: true };
}

// Besluit 2: het beeldpad neemt een formaat aan. Zonder formaat het
// origineel. WP25 maakt de verkleinde versies; zolang een foto ze niet heeft,
// geeft elk formaat het origineel (als terugval, zie hierboven). Het formaat
// verandert niets aan de toegang: het wordt pas gekozen nadat de regel
// hierboven een beeld gaf.
export const IMAGE_FORMATS = ["klein", "groot"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export function parseImageFormat(
  raw: string | null,
): ImageFormat | "origineel" | "ongeldig" {
  if (raw === null) return "origineel";
  return (IMAGE_FORMATS as readonly string[]).includes(raw)
    ? (raw as ImageFormat)
    : "ongeldig";
}
