import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getBySubject, requireCurrentUser } from "./users";
import { getAccessiblePhoto, isPublishedInGroup } from "./lib/photoAccess";
import {
  group,
  groupFields,
  membership,
  membershipFields,
  photo,
  pick,
  publicProfile,
  publicProfileFields,
} from "./lib/shapes";
import { avatarFieldsOf } from "./lib/profilePhoto";
import { photoView } from "./lib/formatSet";
import { validName } from "./lib/names";
import { normalizeEmail } from "./lib/email";
import {
  deleteAlbumLastSeenByAlbum,
  deleteAlbumLastSeenForUserInGroup,
  sumUnreadInGroup,
  upsertAlbumLastSeen,
} from "./albums";
import { afterUnpublish } from "./lib/unpublish";
import { wipeIfLost } from "./lib/profilePhoto";

const ROLE = v.union(v.literal("admin"), v.literal("member"));

export async function getMembership(
  ctx: QueryCtx,
  userId: Id<"users">,
  groupId: Id<"groups">,
): Promise<Doc<"memberships"> | null> {
  return await ctx.db
    .query("memberships")
    .withIndex("by_user_and_group", (q) =>
      q.eq("userId", userId).eq("groupId", groupId),
    )
    .unique();
}

// WP16 invariant 9: de reads achter het Groep-scherm geven bij geen lid en
// bij een onbekende groep precies dezelfde ConvexError. De app herkent hem
// aan de code (een gewone Error heet in productie "Server Error").
export const NOT_MEMBER = { code: "NOT_MEMBER" } as const;

export async function requireMemberForRead(
  ctx: QueryCtx,
  groupId: Id<"groups">,
) {
  const user = await requireCurrentUser(ctx);
  const membership = await getMembership(ctx, user._id, groupId);
  if (!membership) throw new ConvexError(NOT_MEMBER);
  return { user, membership };
}

// WP28 A-invariant 2: weigeringen van de beheer-mutations. Geen lid, of een
// onbekende groep, album of doel-lid: NOT_MEMBER, overal dezelfde (geen
// bestaans-orakel). Wel lid maar het mag niet: een code die de reden draagt.
// De app zet de code om in een NL-melding (invariant 7).
// Fix-cyclus 1 (A-invariant 11, A-keuze 1): ook de overige verwachte
// weigeringen op de WP28-paden dragen een code.
export type RefusalCode =
  | "NOT_MEMBER"
  | "NOT_ALLOWED"
  | "FOUNDER_PROTECTED"
  | "FOUNDER_MUST_TRANSFER"
  | "COVER_NOT_IN_GROUP"
  | "COVER_NOT_IN_ALBUM"
  | "NOT_PHOTO_OWNER"
  | "ALREADY_IN_ALBUM"
  | "NOT_IN_ALBUM"
  | "INVITE_INVALID"
  | "DATE_INVALID"
  | "LOCATION_INVALID";

export function refuse(code: RefusalCode): never {
  throw new ConvexError({ code });
}

// A-invariant 5 en 12: een groeps- of albumnaam wordt getrimd bewaard;
// leeg is NAME_REQUIRED, te lang NAME_TOO_LONG, verboden tekens NAME_INVALID
// (de regel van WP15b). Alleen een meegegeven naam: een gemigreerde naam
// blijft staan.
export function groupOrAlbumName(name: string): string;
export function groupOrAlbumName(name: string | undefined): string | undefined;
export function groupOrAlbumName(name: string | undefined): string | undefined {
  return name === undefined ? undefined : validName(name, "NAME_REQUIRED");
}

// A-invariant 12: `sortDate` is een eindig getal (epoch-ms; ook vóór 1970).
export function requireDate(sortDate: number | undefined): void {
  // WP28 A-invariant 15: het bereik van een JS-Date, de randen meegerekend.
  if (sortDate !== undefined && !(Number.isFinite(sortDate) && Math.abs(sortDate) <= 8.64e15)) {
    refuse("DATE_INVALID");
  }
}

/** Lid van een bestaande groep, anders NOT_MEMBER. */
export async function requireMemberForWrite(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"groups">,
) {
  const user = await requireCurrentUser(ctx);
  const membership = await getMembership(ctx, user._id, groupId);
  const group = membership ? await ctx.db.get(groupId) : null;
  if (!membership || !group) refuse("NOT_MEMBER");
  return { user, membership, group };
}

/** Admin van de groep; een lid zonder die rol krijgt NOT_ALLOWED. */
export async function requireAdminForWrite(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"groups">,
) {
  const found = await requireMemberForWrite(ctx, groupId);
  if (found.membership.role !== "admin") refuse("NOT_ALLOWED");
  return found;
}

/**
 * De oprichter (`groups.createdBy`, spec §Vraag 2). Besluit 1 en 5: groep en
 * album verwijderen; A-invariant 1: overdragen.
 */
export async function requireFounder(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"groups">,
) {
  const found = await requireMemberForWrite(ctx, groupId);
  if (found.group.createdBy !== found.user._id) refuse("NOT_ALLOWED");
  return found;
}

/** Het doel van een beheeractie is lid van de groep, anders NOT_MEMBER. */
async function requireTarget(
  ctx: QueryCtx,
  userId: Id<"users">,
  groupId: Id<"groups">,
): Promise<Doc<"memberships">> {
  const target = await getMembership(ctx, userId, groupId);
  if (!target) refuse("NOT_MEMBER");
  return target;
}

/**
 * WP28 A-invariant 4 en besluit 6: een uitnodiging voor een groep werkt
 * alleen als de groep nog bestaat en de uitnodiger op het moment van
 * accepteren nog admin is. Voor invites.accept en de onboarding.
 */
export async function isGroupInviteStillValid(
  ctx: QueryCtx,
  invite: Doc<"invites">,
): Promise<boolean> {
  if (!invite.groupId) return true;
  const group = await ctx.db.get(invite.groupId);
  if (!group) return false;
  const inviter = await getMembership(ctx, invite.invitedBy, invite.groupId);
  return inviter?.role === "admin";
}

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.id("groups"),
  handler: async (ctx, { name, description }) => {
    const user = await requireCurrentUser(ctx);
    const trimmed = groupOrAlbumName(name);

    const groupId = await ctx.db.insert("groups", {
      name: trimmed,
      description,
      createdBy: user._id,
      createdAt: Date.now(),
    });

    await ctx.db.insert("memberships", {
      userId: user._id,
      groupId,
      role: "admin",
      joinedAt: Date.now(),
    });

    return groupId;
  },
});

// WP23: groep-reads alleen voor leden (geen webmaster-bypass).
// requireMemberForRead geeft voor een onbekende groep dezelfde error als voor
// een niet-lid (NOT_MEMBER, WP16): geen bestaans-orakel. Responses zijn
// whitelists uit lib/shapes, geen spreads van rijen.
export const getById = query({
  args: { groupId: v.id("groups") },
  returns: v.union(group, v.null()),
  handler: async (ctx, { groupId }) => {
    await requireMemberForRead(ctx, groupId);
    const row = await ctx.db.get(groupId);
    return row ? pick(row, groupFields) : null;
  },
});

// Cat-1 join-on-read: group + cover photo. Cascade matrix row P2.
// Member-only (groep-data is sowieso member-only). Cover als foto-vorm, en
// alleen met foto-toegang, anders `null` (invariant 10). `coverPhotoId` blijft
// in de groep-vorm: een id zonder toegang ontsluit niets.
export const getWithCover = query({
  args: { groupId: v.id("groups") },
  returns: v.union(
    v.object({ ...groupFields, cover: v.union(photo, v.null()) }),
    v.null(),
  ),
  handler: async (ctx, { groupId }) => {
    const { user } = await requireMemberForRead(ctx, groupId);
    const row = await ctx.db.get(groupId);
    if (!row) return null;
    const cover = await getAccessiblePhoto(ctx, user._id, row.coverPhotoId);
    return {
      ...pick(row, groupFields),
      cover: cover ? await photoView(ctx, cover) : null,
    };
  },
});

// WP16 besluit 4 + invariant 10: per groep ook `unreadCount`, de som van de
// tellers die albums.listByGroupWithUnread voor die groep geeft (zelfde
// helper, dus zelfde definitie van "nieuw").
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({ ...groupFields, role: ROLE, unreadCount: v.number() }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await getBySubject(ctx, identity.subject);
    if (!user) return [];

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const groups = await Promise.all(
      memberships.map(async (m) => {
        const row = await ctx.db.get(m.groupId);
        if (!row) return null;
        const unreadCount = await sumUnreadInGroup(ctx, user._id, m);
        return { ...pick(row, groupFields), role: m.role, unreadCount };
      }),
    );
    return groups.filter((g): g is NonNullable<typeof g> => g !== null);
  },
});

// Bron voor de WP16-ledenlijst: per lid membership-velden + publiek profiel.
// Nooit email of Clerk-subject van medeleden.
export const listMembers = query({
  args: { groupId: v.id("groups") },
  returns: v.array(
    v.object({
      membership,
      user: v.union(publicProfile, v.null()),
    }),
  ),
  handler: async (ctx, { groupId }) => {
    await requireMemberForRead(ctx, groupId);

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();

    return await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return {
          membership: pick(m, membershipFields),
          user: user
            ? { ...pick(user, publicProfileFields), ...(await avatarFieldsOf(ctx, user)) }
            : null,
        };
      }),
    );
  },
});

export const update = mutation({
  args: {
    groupId: v.id("groups"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    // WP28 A-keuze 4: `null` haalt de cover weg; weglaten laat hem staan.
    coverPhotoId: v.optional(v.union(v.id("photos"), v.null())),
    // WP28 invariant 6: de dag (epoch-ms, UTC-middernacht, A-keuze 5).
    sortDate: v.optional(v.number()),
  },
  handler: async (ctx, { groupId, ...rest }) => {
    await requireAdminForWrite(ctx, groupId);
    const name = groupOrAlbumName(rest.name);
    requireDate(rest.sortDate);
    // WP24 invariant 2 + A-keuze 2: een groep-cover staat in een album van
    // déze groep. Eén code, ook voor een onbekend photo-id (invariant 3).
    // Alleen als de cover wordt gezet: een bestaande cover die niet meer in
    // de groep staat, blokkeert geen naamswijziging.
    if (
      rest.coverPhotoId &&
      !(await isPublishedInGroup(ctx, rest.coverPhotoId, groupId))
    ) {
      refuse("COVER_NOT_IN_GROUP");
    }
    const patch: Partial<Doc<"groups">> = {};
    if (name !== undefined) patch.name = name;
    if (rest.description !== undefined) patch.description = rest.description;
    if (rest.coverPhotoId !== undefined) {
      patch.coverPhotoId = rest.coverPhotoId ?? undefined;
    }
    if (rest.sortDate !== undefined) patch.sortDate = rest.sortDate;
    if (Object.keys(patch).length > 0) await ctx.db.patch(groupId, patch);
  },
});

// Besluit 1: alleen de oprichter verwijdert de groep.
export const remove = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    await requireFounder(ctx, groupId);
    await deleteGroupCascade(ctx, groupId);
  },
});

// Groep weg, met alles wat eraan hangt. Gedeeld door groups.remove (G3, G4)
// en het laatste lid dat weggaat (M2-e): beide doen hetzelfde.
// Volgorde: albumPhotos → albums (+ albumLastSeen, A1/A2) → memberships →
// uitnodigingen → groep → covers en profielfoto's van de weggehaalde
// publicaties (WP28 A-invariant 3). Photos blijven (eigendom van users, niet
// groups). [Cascade matrix G3, G4, A1, A2, AP4, M2-e]
export async function deleteGroupCascade(
  ctx: MutationCtx,
  groupId: Id<"groups">,
): Promise<void> {
  const albumPhotos = await ctx.db
    .query("albumPhotos")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  for (const ap of albumPhotos) await ctx.db.delete(ap._id);

  const albums = await ctx.db
    .query("albums")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  for (const a of albums) {
    await deleteAlbumLastSeenByAlbum(ctx, a._id);
    await ctx.db.delete(a._id);
  }

  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  for (const m of memberships) await ctx.db.delete(m._id);

  // WP28 invariant 4 en A-invariant 8: alle uitnodigingen voor de groep
  // gaan mee, welke status ook, zodat niets naar de gewiste groep wijst
  // (integriteitscheck invites.groupId). Een uitnodiging die er toch nog
  // zou zijn, maakt geen lidmaatschap (isGroupInviteStillValid).
  const invites = await ctx.db
    .query("invites")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  for (const i of invites) await ctx.db.delete(i._id);

  await ctx.db.delete(groupId);

  await afterUnpublish(ctx, albumPhotos);
}

// Internal helper: doet de volle M1+M2+M3 cascade voor één membership.
// Aangeroepen door groups.removeMember (na de gates) en door
// users.deleteSelf voor transitieve cascade per membership.
//
// Cascade matrix rows M1, M2 (a-e), M3, en WP28: AP4 op de weggehaalde
// publicaties, open uitnodigingen aan zijn adres.
export async function internalRemoveMember(
  ctx: MutationCtx,
  args: { userId: Id<"users">; groupId: Id<"groups"> },
): Promise<void> {
  const { userId, groupId } = args;
  const target = await getMembership(ctx, userId, groupId);
  if (!target) return;

  // M1: ruim albumPhotos op waar photo-owner deze user is en publicatie in
  // deze groep zit (filter op eigenaar, niet op addedBy). Bob vertrekt → al
  // zijn foto's uit alle albums in deze group, ongeacht wie ze had
  // toegevoegd. Eigenaarschap via zijn foto-ids (by_owner), niet per
  // publicatie een get: één read per tabel, ook in een grote groep.
  // [Cascade matrix M1]
  const owned = new Set(
    (
      await ctx.db
        .query("photos")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect()
    ).map((p) => p._id),
  );
  const groupAps = await ctx.db
    .query("albumPhotos")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  const removedAps = groupAps.filter((ap) => owned.has(ap.photoId));
  for (const ap of removedAps) await ctx.db.delete(ap._id);

  // M3: cascade albumLastSeen voor deze user × albums in déze group.
  // Andere groepen blijven intact.
  await deleteAlbumLastSeenForUserInGroup(ctx, userId, groupId);

  await ctx.db.delete(target._id);

  // WP28 invariant 4, weg (a): open uitnodigingen aan zijn adres voor deze
  // groep vervallen. Op het genormaliseerde adres: uitnodigingen zijn
  // genormaliseerd, een gemigreerd adres in de users-rij niet altijd
  // (A-invariant 13). Weg (b) en A-invariant 10: zijn eigen open
  // uitnodigingen voor deze groep vervallen ook (expireInvitesBy).
  const user = await ctx.db.get(userId);
  if (user) {
    const invites = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", normalizeEmail(user.email)))
      .collect();
    for (const i of invites) {
      if (i.groupId === groupId && i.status === "pending") {
        await ctx.db.delete(i._id);
      }
    }
  }
  await expireInvitesBy(ctx, userId, groupId);

  // WP27 besluit 7 (A-invariant 11): had hij de foto van een ander als
  // profielfoto en ziet hij die nu niet meer, dan krijgt hij de letter.
  await wipeIfLost(ctx, userId);

  // [GAP] zero-member check telt invites niet mee (cascade-matrix.md S1).
  const remaining = await ctx.db
    .query("memberships")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();

  if (remaining.length === 0) {
    // cascade-matrix.md M2-e: laatste lid weg, zelfde cascade als
    // groups.remove. Daarna de covers en profielfoto's van zijn eigen
    // weggehaalde publicaties.
    await deleteGroupCascade(ctx, groupId);
    await afterUnpublish(ctx, removedAps);
    return;
  }

  // WP28 A-invariant 3: covers volgen zijn weggehaalde foto's.
  await afterUnpublish(ctx, removedAps);

  // Na besluit 3 en 4 verdwijnt de oprichter alleen nog via
  // accountverwijdering (U8); M2-c en M2-d blijven daarvoor.
  // cascade-matrix.md M2-c: laatste admin weg, anderen promoveren.
  const adminsLeft = remaining.filter((m) => m.role === "admin");
  if (adminsLeft.length === 0) {
    for (const m of remaining) {
      await ctx.db.patch(m._id, { role: "admin" });
    }
  }

  // cascade-matrix.md M2-d: founder weg, eerste admin promoveren tot
  // founder.
  const group = await ctx.db.get(groupId);
  if (group && group.createdBy === userId) {
    const refreshed = await ctx.db
      .query("memberships")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    // [GAP] sort op joinedAt asc voor admin/founder promotie. Bewust
    // deterministisch gekozen, equivalent aan willekeurige insert-volgorde
    // want createdAt monotoon stijgt.
    const newFounder = refreshed
      .filter((m) => m.role === "admin")
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (newFounder) {
      await ctx.db.patch(groupId, { createdBy: newFounder.userId });
    }
  }
}

// Lid verwijderen (admin, niet de oprichter, besluit 3) of zelf vertrekken
// (iedereen behalve de oprichter, besluit 4: die draagt eerst over).
export const removeMember = mutation({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
  },
  handler: async (ctx, { groupId, userId }) => {
    const { user, membership, group } = await requireMemberForWrite(
      ctx,
      groupId,
    );
    if (user._id === userId) {
      if (group.createdBy === user._id) refuse("FOUNDER_MUST_TRANSFER");
    } else {
      if (membership.role !== "admin") refuse("NOT_ALLOWED");
      await requireTarget(ctx, userId, groupId);
      if (group.createdBy === userId) refuse("FOUNDER_PROTECTED");
    }

    await internalRemoveMember(ctx, { userId, groupId });
  },
});

// Rol wijzigen: admin, niet bij de oprichter (besluit 3), niet bij jezelf
// (A-keuze 3). Omdat de oprichter altijd admin blijft, is er altijd een admin
// (invariant 2); een aparte laatste-admin-check is daarmee overbodig.
export const updateMemberRole = mutation({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
    role: ROLE,
  },
  handler: async (ctx, { groupId, userId, role }) => {
    const { user, group } = await requireAdminForWrite(ctx, groupId);
    if (user._id === userId) refuse("NOT_ALLOWED");
    const target = await requireTarget(ctx, userId, groupId);
    if (group.createdBy === userId) refuse("FOUNDER_PROTECTED");
    if (target.role === role) return;
    await ctx.db.patch(target._id, { role });
    // A-invariant 10 (R3): een admin die lid wordt, verliest zijn open
    // uitnodigingen voor deze groep; ze herleven niet als hij weer admin wordt.
    if (role === "member") await expireInvitesBy(ctx, userId, groupId);
  },
});

/**
 * WP28 A-invariant 10: open uitnodigingen die `userId` voor deze groep
 * verstuurde, vervallen (A-keuze 2: B kiest verwijderen, zoals intrekken en
 * zoals de uitnodigingen aan wie verdwijnt). Uitnodigingen voor andere
 * groepen blijven.
 */
async function expireInvitesBy(
  ctx: MutationCtx,
  userId: Id<"users">,
  groupId: Id<"groups">,
): Promise<void> {
  const sent = await ctx.db
    .query("invites")
    .withIndex("by_invitedBy", (q) => q.eq("invitedBy", userId))
    .collect();
  for (const i of sent) {
    if (i.groupId === groupId && i.status === "pending") {
      await ctx.db.delete(i._id);
    }
  }
}

// WP28 A-invariant 1: alleen de oprichter draagt over, aan een ander lid van
// de groep. Dat lid wordt admin en oprichter; de oude oprichter blijft admin.
// Gates en schrijven in één mutation (A-invariant 6).
export const transferFounder = mutation({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
  },
  handler: async (ctx, { groupId, userId }) => {
    const { user } = await requireFounder(ctx, groupId);
    if (user._id === userId) refuse("NOT_ALLOWED");
    const target = await requireTarget(ctx, userId, groupId);
    if (target.role !== "admin") {
      await ctx.db.patch(target._id, { role: "admin" });
    }
    await ctx.db.patch(groupId, { createdBy: userId });
  },
});

// Escape hatch: markeer alle albums in een group als gezien voor caller.
// Bedoeld voor nieuwe members die niet handmatig elk album hoeven te openen.
export const markAllAlbumsSeen = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    // WP28 A-invariant 16: niet-lid en onbekende groep gelijk, NOT_MEMBER.
    const { user } = await requireMemberForWrite(ctx, groupId);
    const albums = await ctx.db
      .query("albums")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    const now = Date.now();
    for (const a of albums) {
      await upsertAlbumLastSeen(ctx, user._id, a._id, now);
    }
  },
});
