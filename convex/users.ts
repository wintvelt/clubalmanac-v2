import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internalRemovePhoto } from "./photos";
import { internalRemoveMember } from "./groups";
import { normalizeEmail } from "./lib/email";

// Default upload-limiet voor nieuwe users. Mocht een admin een hogere limiet
// willen geven, dan kan dat via directe DB patch (geen public mutation in
// fase 2 — admin flows komen later).
export const DEFAULT_PHOTO_LIMIT = 1000;

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

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await getBySubject(ctx, identity.subject);
  },
});

export const getById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

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
        await ctx.db.insert("memberships", {
          userId,
          groupId: invite.groupId,
          role: invite.role ?? "member",
          joinedAt: now,
        });
      }
    }

    return userId;
  },
});

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    profilePhotoStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const patch: Partial<Doc<"users">> = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.profilePhotoStorageId !== undefined) {
      patch.profilePhotoStorageId = args.profilePhotoStorageId;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(user._id, patch);
    }
  },
});

export const recordVisit = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    await ctx.db.patch(user._id, { lastVisitAt: Date.now() });
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

    await ctx.db.delete(user._id);
  },
});

// Internal: aangeroepen vanuit photos.create / photos.delete in latere fase.
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
