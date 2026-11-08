import { v } from "convex/values";
import {
  action,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireWebmaster } from "./lib/auth";
import { normalizeEmail } from "./lib/email";
import { assertTestFlag, assertTestGate, testSecretArg } from "./lib/testGate";

// Test-only Convex functions voor de integration-suite (WP2 e.v.).
//
// Doel: roundtrip-pin op `ctx.storage` (`store` → `getUrl` → fetch → `delete`)
// auth-vrij ontkoppeld van de productie-`/upload` httpAction (Clerk-coupled).
// Aangeroepen vanuit `tests/integration/convex/storage.test.ts` via
// `ConvexHttpClient`. Zie docs/migratie-plan-convex.md "WP2 — Convex storage
// roundtrip" en docs/conventions/integration-tests.md.
//
// WP26: elke publieke functie hier neemt het optionele argument `testSecret`
// en roept als eerste `assertTestGate` aan (convex/lib/testGate.ts): open
// alleen met `INTEGRATION_TEST_ENABLED === "true"`, een niet-leeg
// `INTEGRATION_TEST_SECRET` op de deployment en exact dat geheim in de
// aanroep. Beide env-vars staan alleen op dev; prod krijgt ze nooit. De gate
// staat vóór elk effect, dus een weigering laat niets achter.
// tests/testGate/inventory.test.ts eist het argument (en een recept) voor
// elke nieuwe publieke export. Interne functies houden alleen de vlag-check.

export const storageUpload = action({
  args: { bytes: v.bytes(), contentType: v.optional(v.string()), ...testSecretArg },
  returns: v.object({ storageId: v.id("_storage") }),
  handler: async (ctx, { bytes, contentType, testSecret }) => {
    assertTestGate(testSecret);
    const blob =
      contentType !== undefined
        ? new Blob([bytes], { type: contentType })
        : new Blob([bytes]);
    const storageId = await ctx.storage.store(blob);
    return { storageId };
  },
});

export const storageDownloadUrl = query({
  args: { storageId: v.id("_storage"), ...testSecretArg },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { storageId, testSecret }) => {
    assertTestGate(testSecret);
    return await ctx.storage.getUrl(storageId);
  },
});

export const storageDelete = mutation({
  args: { storageId: v.id("_storage"), ...testSecretArg },
  returns: v.null(),
  handler: async (ctx, { storageId, testSecret }) => {
    assertTestGate(testSecret);
    await ctx.storage.delete(storageId);
    return null;
  },
});

// WP4: webmaster-detectie voor de `whoami` httpAction. `requireWebmaster`
// verwacht `QueryCtx | MutationCtx` (`ctx.db`-toegang voor users-record-
// check), en httpAction krijgt een `ActionCtx`. Daarom moet de webmaster-
// check via een `runQuery`-hop. De auth-identity propageert van de
// httpAction naar deze query, dus `requireWebmaster` ziet dezelfde JWT.
export const whoamiCheckWebmaster = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    assertTestFlag();
    try {
      await requireWebmaster(ctx);
      return true;
    } catch {
      return false;
    }
  },
});

// ───────────────────────────────────────────────────────────────────────────
// WP11: Clerk onboarding-webhook integration-test helpers
// ───────────────────────────────────────────────────────────────────────────
//
// `tests/integration/clerk/onboardingWebhook.test.ts` pint de atomic-onboarding
// flow (POST /clerk-webhook → internal.users.registerFromSession) tegen de echte
// gedeployde DB. `ConvexHttpClient` kan alleen PUBLIC functies aanroepen; er is
// geen public pad om (a) een pending invite te seeden, (b) DB-state by-subject
// terug te lezen, of (c) op te ruimen voor een fresh fake subject zonder
// Clerk-JWT. Deze zes helpers vullen dat gat — allen achter de WP26-gate,
// dus inert op prod.
//
// Cleanup-volgorde (kindrecords vóór ouder, om FK-orphan-blip te vermijden):
//   - cleanupUserBySubject: albumLastSeen → memberships → users-row
//   - cleanupOnboardingSeed: invite → group → inviter-user
// Beide mutaties zijn idempotent (count 0 bij reeds-verdwenen state) zodat de
// expliciete cleanup-test én het best-effort afterAll-net beide veilig draaien.

// Read-back: users-row voor een gegeven Clerk-subject (insert-pad-verificatie).
export const getUserBySubject = query({
  args: { subject: v.string(), ...testSecretArg },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("users"),
      subject: v.string(),
      email: v.string(),
      name: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { subject, testSecret }) => {
    assertTestGate(testSecret);
    const user = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique();
    if (!user) return null;
    return {
      _id: user._id,
      subject: user.subject,
      email: user.email,
      ...(user.name !== undefined ? { name: user.name } : {}),
      createdAt: user.createdAt,
    };
  },
});

// Read-back: invites voor een email (invite-accept-verificatie). Email wordt
// genormaliseerd zodat de lookup de invariant uit lib/email volgt.
export const listInvitesByEmail = query({
  args: { email: v.string(), ...testSecretArg },
  returns: v.array(
    v.object({
      _id: v.id("invites"),
      email: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("accepted"),
        v.literal("declined"),
        v.literal("expired"),
      ),
      groupId: v.optional(v.id("groups")),
      role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
      respondedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { email, testSecret }) => {
    assertTestGate(testSecret);
    const normalized = normalizeEmail(email);
    const invites = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .collect();
    return invites.map((i) => ({
      _id: i._id,
      email: i.email,
      status: i.status,
      ...(i.groupId !== undefined ? { groupId: i.groupId } : {}),
      ...(i.role !== undefined ? { role: i.role } : {}),
      ...(i.respondedAt !== undefined ? { respondedAt: i.respondedAt } : {}),
    }));
  },
});

// Read-back: memberships voor een user (membership-create-verificatie).
export const listMembershipsByUserId = query({
  args: { userId: v.id("users"), ...testSecretArg },
  returns: v.array(
    v.object({
      _id: v.id("memberships"),
      userId: v.id("users"),
      groupId: v.id("groups"),
      role: v.union(v.literal("admin"), v.literal("member")),
      joinedAt: v.number(),
    }),
  ),
  handler: async (ctx, { userId, testSecret }) => {
    assertTestGate(testSecret);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return memberships.map((m) => ({
      _id: m._id,
      userId: m.userId,
      groupId: m.groupId,
      role: m.role,
      joinedAt: m.joinedAt,
    }));
  },
});

// Seed: inviter-user + group + één pending invite voor `email`, zodat de
// webhook-flow het invite-accept + membership-create pad daadwerkelijk raakt.
// De inviter krijgt een afgeleid e-mailadres dat NIET botst met `email` (anders
// zou registerFromSession's email-uniqueness-check de onboarding-insert blokkeren).
export const seedOnboardingFixture = mutation({
  args: { email: v.string(), ...testSecretArg },
  returns: v.object({
    inviterUserId: v.id("users"),
    groupId: v.id("groups"),
    inviteId: v.id("invites"),
  }),
  handler: async (ctx, { email, testSecret }) => {
    assertTestGate(testSecret);
    const normalized = normalizeEmail(email);
    const now = Date.now();

    const inviterUserId = await ctx.db.insert("users", {
      subject: `_seed_inviter_${normalized}`,
      email: normalizeEmail(`inviter+${normalized}`),
      name: "WP11 Seed Inviter",
      photoCount: 0,
      photoLimit: 1000,
      createdAt: now,
    });

    const groupId = await ctx.db.insert("groups", {
      name: "WP11 Seed Group",
      createdBy: inviterUserId,
      createdAt: now,
    });

    const inviteId = await ctx.db.insert("invites", {
      email: normalized,
      invitedBy: inviterUserId,
      groupId,
      role: "member",
      token: `_seed_token_${normalized}`,
      status: "pending",
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
      createdAt: now,
    });

    return { inviterUserId, groupId, inviteId };
  },
});

// Teardown van de onboarded subject: albumLastSeen → memberships → users-row.
// Idempotent: reeds-verdwenen state telt als 0.
export const cleanupUserBySubject = mutation({
  args: { subject: v.string(), ...testSecretArg },
  returns: v.object({
    deleted: v.object({
      albumLastSeen: v.number(),
      memberships: v.number(),
      users: v.number(),
    }),
    total: v.number(),
  }),
  handler: async (ctx, { subject, testSecret }) => {
    assertTestGate(testSecret);
    const user = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique();
    if (!user) {
      return {
        deleted: { albumLastSeen: 0, memberships: 0, users: 0 },
        total: 0,
      };
    }

    const albumLastSeen = await ctx.db
      .query("albumLastSeen")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const a of albumLastSeen) await ctx.db.delete(a._id);

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const m of memberships) await ctx.db.delete(m._id);

    await ctx.db.delete(user._id);

    const deleted = {
      albumLastSeen: albumLastSeen.length,
      memberships: memberships.length,
      users: 1,
    };
    return {
      deleted,
      total: deleted.albumLastSeen + deleted.memberships + deleted.users,
    };
  },
});

// Teardown van de seed-fixture: invite → group → inviter-user. Idempotent:
// per-id existence-check zodat een tweede (best-effort) call niet throwt.
export const cleanupOnboardingSeed = mutation({
  args: {
    inviteId: v.id("invites"),
    groupId: v.id("groups"),
    inviterUserId: v.id("users"),
    ...testSecretArg,
  },
  returns: v.object({
    deleted: v.object({
      invites: v.number(),
      groups: v.number(),
      inviters: v.number(),
    }),
    total: v.number(),
  }),
  handler: async (ctx, { inviteId, groupId, inviterUserId, testSecret }) => {
    assertTestGate(testSecret);

    let invites = 0;
    if (await ctx.db.get(inviteId)) {
      await ctx.db.delete(inviteId);
      invites = 1;
    }
    let groups = 0;
    if (await ctx.db.get(groupId)) {
      await ctx.db.delete(groupId);
      groups = 1;
    }
    let inviters = 0;
    if (await ctx.db.get(inviterUserId)) {
      await ctx.db.delete(inviterUserId);
      inviters = 1;
    }

    const deleted = { invites, groups, inviters };
    return { deleted, total: invites + groups + inviters };
  },
});
