import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internalRemovePhoto } from "./photos";
import { internalRemoveMember } from "./groups";
import { normalizeEmail } from "./lib/email";
import {
  DEFAULT_PHOTO_LIMIT,
  NAME_MAX_LENGTH,
  VISIT_PERIOD_MS,
} from "./lib/constants";
import { canUseStorage } from "./lib/photoAccess";
import {
  ownProfile,
  ownProfileFields,
  pick,
  publicProfile,
  publicProfileFields,
} from "./lib/shapes";
import { profileOrientationOf } from "./lib/profilePhoto";

// Default upload-limiet voor nieuwe users. Mocht een admin een hogere limiet
// willen geven, dan kan dat via directe DB patch (geen public mutation in
// fase 2 — admin flows komen later).
// Gedeeld met scripts/migrate (WP12) via convex/lib/constants.ts.
export { DEFAULT_PHOTO_LIMIT };

export async function getBySubject(
  ctx: QueryCtx,
  subject: string,
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_subject", (q) => q.eq("subject", subject))
    .unique();
}

// Callable van httpAction (POST /upload) — actions kunnen geen plain
// helpers gebruiken, dus exposeren als internalQuery.
export const getBySubjectInternal = internalQuery({
  args: { subject: v.string() },
  handler: async (ctx, { subject }) => {
    return await getBySubject(ctx, subject);
  },
});

export async function requireCurrentUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Niet ingelogd");
  const user = await getBySubject(ctx, identity.subject);
  if (!user) throw new Error("User record bestaat niet");
  return user;
}

async function ownProfileOrNull(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await getBySubject(ctx, identity.subject);
  return user ? { ...pick(user, ownProfileFields), ...(await profileOrientationOf(ctx, user)) } : null;
}

// WP23: eigen profiel (whitelist, zie lib/shapes). `null` zonder identity of
// users-rij: de app leunt op `current === null` (WP13/WP15a).
export const current = query({
  args: {},
  returns: v.union(ownProfile, v.null()),
  handler: ownProfileOrNull,
});

// WP15b invariant 7: zelfde vorm als `current`, maar een eigen functie. Alleen
// Profiel abonneert erop (via useLiveQuery), zodat Convex dit abonnement niet
// samenvoegt met dat van de poort en de tabwissel in het dashboard te zien is.
export const profile = query({
  args: {},
  returns: v.union(ownProfile, v.null()),
  handler: ownProfileOrNull,
});

const NO_USER_ACCESS = "Geen toegang tot deze gebruiker";

// WP23: publiek profiel, ook voor zichzelf (A-keuze 9). Toegang: zichzelf of
// minstens één gedeelde groep. Geen webmaster-bypass. "Bestaat niet" en
// "geen gedeelde groep" geven dezelfde error (invariant 4): de target-rij
// wordt pas gelezen na de groep-check.
export const getById = query({
  args: { userId: v.id("users") },
  returns: publicProfile,
  handler: async (ctx, { userId }) => {
    const me = await requireCurrentUser(ctx);
    if (userId !== me._id && !(await sharesGroup(ctx, me._id, userId))) {
      throw new Error(NO_USER_ACCESS);
    }
    const target = await ctx.db.get(userId);
    if (!target) throw new Error(NO_USER_ACCESS);
    return { ...pick(target, publicProfileFields), ...(await profileOrientationOf(ctx, target)) };
  },
});

async function sharesGroup(
  ctx: QueryCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<boolean> {
  const mine = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", a))
    .collect();
  for (const m of mine) {
    const other = await ctx.db
      .query("memberships")
      .withIndex("by_user_and_group", (q) =>
        q.eq("userId", b).eq("groupId", m.groupId),
      )
      .unique();
    if (other) return true;
  }
  return false;
}

// WP6: Clerk session-webhook → atomic onboarding. Vervangt de publieke
// `api.users.register` mutation. Webhook-laag (convex/http.ts /clerk-webhook)
// verifieert Svix-signature + resolved subject/verified-email/name uit de
// Clerk payload en delegeert naar deze internal mutation.
//
// Atomic flow binnen één Convex-transactie:
//   1. Idempotent-on-subject: bestaande users-row → no-op return id.
//   2. Email-uniqueness: throw bij andere subject met zelfde email
//      (rollback laat geen halve state achter). Fail-loud zodat Clerk
//      retry't en ops 't merkt — silent claim van orphan-row zou data van
//      vorige user overerven naar nieuwe Clerk-subject.
//   3. Insert users-row.
//   4. Vind alle pending, niet-verlopen invites voor email; accept ze
//      atomair (status=accepted + respondedAt) en insert membership voor
//      elke invite met groupId.
//
// Re-login pad = idempotent no-op vóór invite-collect → nieuwe invites
// tussen signup en re-login worden NIET stille geaccepteerd (re-login !=
// onboarding).
export const registerFromSession = internalMutation({
  args: {
    subject: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, { subject, email, name }) => {
    const existing = await getBySubject(ctx, subject);
    if (existing) return existing._id;

    const normalizedEmail = normalizeEmail(email);

    const byEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .unique();
    if (byEmail) throw new Error("Email is al in gebruik");

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      subject,
      email: normalizedEmail,
      name,
      photoCount: 0,
      photoLimit: DEFAULT_PHOTO_LIMIT,
      createdAt: now,
    });

    const invites = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .collect();
    for (const invite of invites) {
      if (invite.status !== "pending") continue;
      if (invite.expiresAt <= now) continue;
      await ctx.db.patch(invite._id, {
        status: "accepted",
        respondedAt: now,
      });
      if (invite.groupId) {
        // Defense-in-depth (WP6-audit N-6): existing-membership-check spiegelt
        // de discipline van `invites.accept`. In praktijk niet te raken (user
        // is vers gecreëerd in dezelfde tx; geen pre-existing memberships) maar
        // bewaart de invariant als toekomstige aanpassingen `userId` hergebruiken.
        const existing = await ctx.db
          .query("memberships")
          .withIndex("by_user_and_group", (q) =>
            q.eq("userId", userId).eq("groupId", invite.groupId!),
          )
          .unique();
        if (!existing) {
          await ctx.db.insert("memberships", {
            userId,
            groupId: invite.groupId,
            role: invite.role ?? "member",
            joinedAt: now,
          });
        }
      }
    }

    return userId;
  },
});

// WP15b A-punt 3: tekens die een naam onleesbaar of misleidend maken.
// Controletekens (C0, DEL, C1), regel- en alineascheiding, tekens die de
// leesrichting omdraaien, en onzichtbare spaties. U+200C/U+200D (ZWNJ/ZWJ)
// mogen: die zitten in emoji en in sommige schriften.
const FORBIDDEN_NAME_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069\u200b\ufeff]/;

type NameErrorCode = "NAME_EMPTY" | "NAME_TOO_LONG" | "NAME_INVALID";

// Geeft de naam zoals hij bewaard wordt, of gooit een ConvexError met een
// code: een gewone Error komt in productie aan als "Server Error" en de app
// moet een melding onder het veld kunnen tonen (WP15b invariant 10).
// `trim` haalt ook vaste spaties (U+00A0, U+3000) en een BOM aan de rand weg.
function validName(raw: string): string {
  const name = raw.trim();
  const fail = (code: NameErrorCode) => {
    throw new ConvexError({ code });
  };
  if (name.length === 0) fail("NAME_EMPTY");
  if ([...name].length > NAME_MAX_LENGTH) fail("NAME_TOO_LONG");
  if (FORBIDDEN_NAME_CHARS.test(name)) fail("NAME_INVALID");
  return name;
}

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    profilePhotoStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const patch: Partial<Doc<"users">> = {};
    // WP15b: alleen een meegegeven naam wordt gecheckt; een gemigreerde naam
    // blijft staan tot de user hem zelf wijzigt. Check vóór de patch, zodat
    // een geweigerde naam ook de profielfoto laat staan (invariant 9).
    if (args.name !== undefined) patch.name = validName(args.name);
    if (args.profilePhotoStorageId !== undefined) {
      // WP24 invariant 8 / WP17a invariant 16: alleen een eigen beeld (een
      // eigen foto, of de eigen huidige profielfoto). Check vóór de patch,
      // zodat een geweigerd beeld ook de naam laat staan.
      if (!(await canUseStorage(ctx, user, args.profilePhotoStorageId))) {
        throw new Error("Geen toegang tot dit beeld");
      }
      patch.profilePhotoStorageId = args.profilePhotoStorageId;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(user._id, patch);
    }
  },
});

async function visitRow(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("userVisits")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

// WP15b invarianten 5 en 6. De backend is de garantie voor de throttle:
// hoogstens één schrijfactie per VISIT_PERIOD_MS per user, ook als de client
// vaker vraagt. Binnen de periode: niets, en geen fout. Het bezoek staat in
// `userVisits`, niet in de users-rij, zodat geen live query opnieuw draait.
export const recordVisit = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const now = Date.now();
    const visit = await visitRow(ctx, user._id);
    if (!visit) {
      await ctx.db.insert("userVisits", { userId: user._id, lastVisitAt: now });
    } else if (now - visit.lastVisitAt >= VISIT_PERIOD_MS) {
      await ctx.db.patch(visit._id, { lastVisitAt: now });
    }
  },
});

// WP15b: het bezoek is alleen intern te lezen (tests, dashboard).
export const getLastVisit = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { userId }) => {
    return (await visitRow(ctx, userId))?.lastVisitAt ?? null;
  },
});

export const deleteSelf = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);

    // U6: cascade ratings die deze user gegeven heeft.
    const ratings = await ctx.db
      .query("ratings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const r of ratings) await ctx.db.delete(r._id);

    // U7: cascade photos via internalRemovePhoto, dat per photo ook
    // P3 (albumPhotos), P4 (ratings van anderen op deze photo), P5
    // (cover-refs) afhandelt + storage cleanup queueet. Voorkomt dat
    // user-delete orphans achterlaat in downstream tabellen.
    //
    // Volgorde: photos vóór memberships. P5 cleart cover-refs op
    // groups/albums vóór een eventuele M2-e group-cascade in U8 loopt;
    // andersom zou M2-e groups/albums hebben gedeleted en dan zou P5
    // proberen patchen op niet-bestaande records.
    const photos = await ctx.db
      .query("photos")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    for (const p of photos) await internalRemovePhoto(ctx, p._id);

    // U8: cascade memberships, transitief via internalRemoveMember zodat
    // de M2-keten (admin/founder-successie + M2-e group-cascade bij
    // laatste lid) per membership draait. M3 binnen internalRemoveMember
    // ruimt albumLastSeen voor (user × albums in déze group) op — daardoor
    // is U9 als aparte cascade vervallen (cat-1 eliminated). Audit-bevinding
    // 2026-04-30: pure record-delete liet productie achter met groepen
    // zonder admin / orphan createdBy / orphan groups+albums.
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const m of memberships) {
      await internalRemoveMember(ctx, {
        userId: user._id,
        groupId: m.groupId,
      });
    }

    // U10: clear flaggedBy refs op photos die deze user heeft geflagd.
    // Default keuze: flag-state blijft (content-inappropriateness staat
    // los van flagger-bestaan), alleen flaggedBy wordt undefined zodat
    // we geen orphan ref hebben. by_flagged is sparse op flaggedAt:
    // alleen geflagde photos zitten erin.
    const flagged = await ctx.db
      .query("photos")
      .withIndex("by_flagged")
      .collect();
    for (const p of flagged) {
      if (p.flaggedBy === user._id) {
        await ctx.db.patch(p._id, { flaggedBy: undefined });
      }
    }

    // U11 (WP15b): het bezoek van deze user.
    const visit = await visitRow(ctx, user._id);
    if (visit) await ctx.db.delete(visit._id);

    await ctx.db.delete(user._id);
  },
});

// Internal: aangeroepen vanuit photo-create/-delete in latere fase.
// Transactioneel met de photo-mutation, dus geen race condities.
// Photo-limit error gebruikt typed sentinel "PHOTO_LIMIT_REACHED" voor
// consistency met createFromUploadInternal. Match exact ===, niet substring.
export const incrementPhotoCount = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User bestaat niet");
    if (user.photoCount >= user.photoLimit) {
      throw new Error("PHOTO_LIMIT_REACHED");
    }
    await ctx.db.patch(userId, { photoCount: user.photoCount + 1 });
  },
});

export const decrementPhotoCount = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User bestaat niet");
    await ctx.db.patch(userId, {
      photoCount: Math.max(0, user.photoCount - 1),
    });
  },
});
