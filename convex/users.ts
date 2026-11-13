import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { acceptableInvitesFor } from "./groups";
import { restartAccountDeletion, startAccountDeletion } from "./accountDeletion";
import { activeUserBySubject, isDeletedClerkSubject, userBySubject } from "./lib/accountState";
import { normalizeEmail } from "./lib/email";
import {
  DEFAULT_PHOTO_LIMIT,
  VISIT_PERIOD_MS,
} from "./lib/constants";
import { canAccessPhoto, canUseStorage } from "./lib/photoAccess";
import { validName } from "./lib/names";
import {
  ownProfile,
  ownProfileFields,
  pick,
  publicProfile,
  publicProfileFields,
} from "./lib/shapes";
import { avatarFieldsOf, isFlaggedImage } from "./lib/profilePhoto";

// Default upload-limiet voor nieuwe users. Mocht een admin een hogere limiet
// willen geven, dan kan dat via directe DB patch (geen public mutation in
// fase 2 — admin flows komen later).
// Gedeeld met scripts/migrate (WP12) via convex/lib/constants.ts.
export { DEFAULT_PHOTO_LIMIT };

// WP29 A-invariant 1: een account dat wordt verwijderd, is niet ingelogd. Alle
// publieke gates (requireCurrentUser, current, upload) lopen hierlangs.
export async function getBySubject(
  ctx: QueryCtx,
  subject: string,
): Promise<Doc<"users"> | null> {
  return await activeUserBySubject(ctx.db, subject);
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
  return user ? { ...pick(user, ownProfileFields), ...(await avatarFieldsOf(ctx, user)) } : null;
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
    return { ...pick(target, publicProfileFields), ...(await avatarFieldsOf(ctx, target)) };
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
//   2. Email-uniqueness: throw bij andere subject met zelfde email, ook
//      zonder uitnodiging (WP19b A-invariant 17). Fail-loud zodat Clerk
//      retry't en ops 't merkt — silent claim van orphan-row zou data van
//      vorige user overerven naar nieuwe Clerk-subject.
//   3. WP19b A-invariant 1: zonder accepteerbare uitnodiging voor het adres
//      geen rij (`null`), en niets verandert. Geen uitzondering voor de
//      webmaster (A-keuze 2). De webhook geeft dan gewoon 200.
//   4. Insert users-row, met de naam van de nieuwste uitnodiging die een
//      naam heeft (A-invariant 11), anders de naam uit Clerk.
//   5. Accepteer alle accepteerbare uitnodigingen en maak de lidmaatschappen.
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
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, { subject, email, name }) => {
    // WP29 A-invariant 2: ook een account dat wordt verwijderd telt als
    // bestaand, zodat een nieuwe sessie geen nieuwe, lege rij maakt.
    const existing = await userBySubject(ctx.db, subject);
    if (existing) return existing._id;
    // WP29 fix 1b: een Clerk-user waarvan het account is verwijderd, krijgt
    // nooit meer een rij (ook niet als de Clerk-user nog bestaat). De webhook
    // kijkt dit vooraf na (isDeletedSubject) en geeft dan gewoon 200.
    if (await isDeletedClerkSubject(ctx.db, subject)) {
      throw new Error("Dit account is verwijderd");
    }

    const normalizedEmail = normalizeEmail(email);
    const now = Date.now();

    // WP19b A-invariant 17 (S1): het adres hoort al bij een andere rij.
    // Fail-loud, ook zonder uitnodiging, dus vóór de check op uitnodigingen.
    if (await userByEmail(ctx.db, normalizedEmail)) throw new Error("Email is al in gebruik");

    // WP19b A-invariant 1 en 16: alleen met een uitnodiging die nu
    // accepteerbaar is (WP28 A-invariant 4). Nieuwste eerst.
    const invites = await acceptableInvitesFor(ctx, normalizedEmail, now);
    if (invites.length === 0) return null;

    // A-invariant 11 (besluit 2, V2): de naam uit de nieuwste uitnodiging
    // met een naam; een gemigreerde uitnodiging heeft er geen.
    const invitedName = invites
      .map((i) => i.name?.trim())
      .find((n): n is string => n !== undefined && n.length > 0);
    const userId = await ctx.db.insert("users", {
      subject,
      email: normalizedEmail,
      name: invitedName ?? name,
      photoCount: 0,
      photoLimit: DEFAULT_PHOTO_LIMIT,
      createdAt: now,
    });

    for (const invite of invites) {
      await ctx.db.patch(invite._id, {
        status: "accepted",
        respondedAt: now,
      });
      // Defense-in-depth (WP6-audit N-6): existing-membership-check spiegelt
      // de discipline van `invites.accept`. In praktijk niet te raken (user
      // is vers gecreëerd in dezelfde tx) maar bewaart de invariant. Twee
      // uitnodigingen voor dezelfde groep: één lidmaatschap, de hoogste rol.
      const groupId = invite.groupId!;
      const role = invite.role ?? "member";
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", userId).eq("groupId", groupId),
        )
        .unique();
      if (!membership) {
        await ctx.db.insert("memberships", { userId, groupId, role, joinedAt: now });
      } else if (membership.role !== "admin" && role === "admin") {
        await ctx.db.patch(membership._id, { role: "admin" });
      }
    }

    return userId;
  },
});

// WP19b A-invariant 3: waarom is er (nog) geen account? Alleen voor de
// ingelogde caller en alleen over zijn eigen geverifieerde adres (de
// email-claim uit de sessie, WP4); geen orakel over andere adressen.
//   "account"  er is een users-rij (ook als het account wordt verwijderd)
//   "waiting"  geen rij, wel een accepteerbare uitnodiging: de onboarding
//              via de webhook komt nog
//   "noInvite" geen rij en geen accepteerbare uitnodiging
//   "blocked"  de onboarding komt niet en een uitnodiging helpt niet: de
//              Clerk-user is gewist, of het adres hoort al bij een andere rij
//              (fix-cyclus 1, A-invariant 17 en 18)
//   null       anoniem
export const signupState = query({
  args: {},
  returns: v.union(
    v.literal("account"),
    v.literal("waiting"),
    v.literal("noInvite"),
    v.literal("blocked"),
    v.null(),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    if (await userBySubject(ctx.db, identity.subject)) return "account";
    if (await isDeletedClerkSubject(ctx.db, identity.subject)) return "blocked";
    if (!identity.email) return "noInvite";
    const email = normalizeEmail(identity.email);
    if (await userByEmail(ctx.db, email)) return "blocked";
    const invites = await acceptableInvitesFor(ctx, email, Date.now());
    return invites.length > 0 ? "waiting" : "noInvite";
  },
});

function userByEmail(db: QueryCtx["db"], email: string) {
  return db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .first();
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
    if (args.name !== undefined) patch.name = validName(args.name, "NAME_EMPTY");
    if (args.profilePhotoStorageId !== undefined) {
      // WP24 invariant 8 / WP17a invariant 16: alleen een eigen beeld (een
      // eigen foto, of de eigen huidige profielfoto). Check vóór de patch,
      // zodat een geweigerd beeld ook de naam laat staan.
      // WP27 besluit 8: ook geen beeld van een gemelde foto.
      if (
        !(await canUseStorage(ctx, user, args.profilePhotoStorageId)) ||
        (await isFlaggedImage(ctx, args.profilePhotoStorageId))
      ) {
        throw new Error("Geen toegang tot dit beeld");
      }
      patch.profilePhotoStorageId = args.profilePhotoStorageId;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(user._id, patch);
    }
  },
});

// WP17b invariant 12: de app kent geen storageId (WP17a invariant 10), dus
// "als profielfoto instellen" gaat op foto-id. WP27 invariant 1 (draait WP17a
// invariant 16 terug): elke foto waar de caller foto-toegang toe heeft, ook
// de foto van een ander in een album van een gedeelde groep. Eén weigering
// voor een foto zonder toegang, een onbekend en een gewist id (A-invariant 8).
// De eigenaar van de foto hoort het niet (besluit 5). Besluit 8 (A-invariant
// 17): een gemelde foto, ook een eigen, krijgt dezelfde weigering, zodat die
// niet verraadt dat hij gemeld is. Raakt de user de toegang later kwijt, dan
// wist die mutation de koppeling (besluit 7).
const NO_PHOTO_ACCESS = "Deze foto kan niet je profielfoto worden";

export const setProfilePhoto = mutation({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    const user = await requireCurrentUser(ctx);
    const photo = await ctx.db.get(photoId);
    if (
      !photo ||
      !(await canAccessPhoto(ctx, user._id, photo)) ||
      (await isFlaggedImage(ctx, photo.storageId))
    ) {
      throw new Error(NO_PHOTO_ACCESS);
    }
    await ctx.db.patch(user._id, { profilePhotoStorageId: photo.storageId });
  },
});

// WP18 invariant 10, A-invariant 16: de profielfoto weghalen. Alleen de
// koppeling (besluit 1: de profielfoto is een gewone eigen foto); de foto,
// zijn beeld en de telling blijven. Daarna geeft het profielpad geen beeld en
// is `profileVersion` "0". Zonder profielfoto: niets, en geen fout.
export const removeProfilePhoto = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    if (user.profilePhotoStorageId === undefined) return;
    await ctx.db.patch(user._id, { profilePhotoStorageId: undefined });
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

// WP29: account verwijderen. Deze mutation sluit het account alleen af, in één
// kleine transactie (A-invariant 1); het opruimen van Convex in stappen en het
// verwijderen van de Clerk-user staan in convex/accountDeletion.ts. Wordt het
// account al verwijderd, dan doet een tweede aanroep niets. Cascade U6–U11.
export const deleteSelf = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Niet ingelogd");
    const user = await userBySubject(ctx.db, identity.subject);
    if (!user) throw new Error("User record bestaat niet");
    await startAccountDeletion(ctx, user);
    return null;
  },
});

/** WP29 fix 1b: is het account van deze Clerk-user verwijderd? Voor de webhook. */
export const isDeletedSubject = internalQuery({
  args: { subject: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { subject }) => await isDeletedClerkSubject(ctx.db, subject),
});

// WP29 A-invariant 7: de webmaster start het verwijderen opnieuw, bv. na het
// herstellen van CLERK_SECRET_KEY. Voor een account dat niet wordt verwijderd
// doet hij niets.
//   npx convex run users:retryAccountDeletion '{"userId":"..."}'
export const retryAccountDeletion = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await restartAccountDeletion(ctx, userId);
    return null;
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
