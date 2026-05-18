// WP6 RED-phase: internal.users.registerFromSession atomic onboarding mutation.
//
// Deze mutation vervangt de publieke `api.users.register` en consolideert
// invite-acceptance + membership-insert in één Convex-transactie. Wordt
// aangeroepen vanuit `/clerk-webhook` httpAction met door Clerk verifieerde
// `subject` + verified-`email` + optionele `name`.
//
// Invariants gepin'd:
//   - Happy path: 1 pending invite → users-row + invite.accepted + membership
//   - Multi-invite atomic: N pending invites zelfde email → N memberships
//   - Idempotent-on-subject: 2e call zelfde subject = no-op (returns existing id)
//   - Re-login pad: idempotent-on-subject + nieuwe invite tussen calls →
//     2e call accepteert die nieuwe invite NIET (re-login ≠ onboarding)
//   - Zero-invite fallback: geen invite, geen webmaster-email → users-row only
//     (terminal "registered-no-membership"); spec §invarianten staat dit toe
//   - Webmaster-bypass: webmaster-email zonder invite → users-row only
//   - Email-normalization: case-insensitive invite-match
//   - Expired invite: behandeld als zero-invite (geen accept, geen membership)
//   - Name uit Clerk-payload: first+last samengevoegd, beide null = undefined
//   - Email-uniqueness met andere subject → throw (mutation rollback)
//   - Group-less invite (groupId undefined): invite-status patched, geen
//     membership-insert (mirror `invites.accept`-gedrag)
//
// RED tot B `internal.users.registerFromSession` toevoegt. Codegen pakt 'm
// dan op en de `(internal as any).users.registerFromSession`-cast hieronder
// blijft type-safe.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUserWithInvite, withUser } from "../_helpers/auth";

// RED-phase: function-reference bestaat nog niet in _generated/api tot B
// 'm toevoegt + codegen draait. Cast houdt deze file compileerbaar zodat
// `npm test` de tests daadwerkelijk uitvoert (en faalt om de juiste reden:
// runtime "function not found", niet TS-compile-error).
//
// Na B's stub + codegen vervalt de cast vanzelf in type-safety; de runtime
// loopt dan tegen de impl-assertions aan.
type RegisterFromSessionFn = typeof internal extends {
  users: { registerFromSession: infer T };
}
  ? T
  : never;
const registerFromSession = (
  internal as unknown as {
    users: { registerFromSession: RegisterFromSessionFn };
  }
).users.registerFromSession;

const WEBMASTER_EMAIL = "webmaster@x.com";
const DAY_MS = 24 * 60 * 60 * 1000;

async function seedInvite(
  t: ReturnType<typeof convexTest>,
  args: {
    email: string;
    groupId?: Id<"groups">;
    role?: "admin" | "member";
    status?: "pending" | "accepted" | "declined" | "expired";
    expiresAt?: number;
  },
): Promise<{ inviteId: Id<"invites">; seederId: Id<"users"> }> {
  return await t.run(async (ctx) => {
    const seederId = await ctx.db.insert("users", {
      subject: `__seed_${crypto.randomUUID()}`,
      email: `seed_${crypto.randomUUID()}@seed.test`,
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    });
    const inviteId = await ctx.db.insert("invites", {
      email: args.email.toLowerCase().trim(),
      invitedBy: seederId,
      groupId: args.groupId,
      role: args.role,
      token: crypto.randomUUID(),
      status: args.status ?? "pending",
      expiresAt: args.expiresAt ?? Date.now() + 14 * DAY_MS,
      createdAt: Date.now(),
    });
    return { inviteId, seederId };
  });
}

async function seedGroup(
  t: ReturnType<typeof convexTest>,
  founderSubject: string = "user_founder",
  groupName: string = "Test group",
): Promise<{ groupId: Id<"groups">; founderId: Id<"users"> }> {
  const founderId = await registerUserWithInvite(
    t,
    founderSubject,
    `${founderSubject}@x.com`,
    "Founder",
  );
  const { groupId } = await withUser(t, founderSubject).mutation(
    api.groups.create,
    { name: groupName },
  );
  return { groupId, founderId };
}

describe("registerFromSession — happy path", () => {
  it("één pending invite → users-row + invite.accepted + membership in één run", async () => {
    const t = convexTest(schema);
    const { groupId } = await seedGroup(t);
    const { inviteId } = await seedInvite(t, {
      email: "alice@x.com",
      groupId,
      role: "member",
    });

    const userId = await t.mutation(registerFromSession, {
      subject: "user_alice",
      email: "alice@x.com",
      name: "Alice",
    });

    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.subject).toBe("user_alice");
    expect(user?.email).toBe("alice@x.com");
    expect(user?.name).toBe("Alice");

    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("accepted");
    expect(typeof invite?.respondedAt).toBe("number");

    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.groupId).toBe(groupId);
    expect(memberships[0]?.role).toBe("member");
  });

  it("name uit two velden samengevoegd (first + last)", async () => {
    const t = convexTest(schema);
    await seedInvite(t, { email: "alice@x.com" });
    const userId = await t.mutation(registerFromSession, {
      subject: "user_alice",
      email: "alice@x.com",
      name: "Alice Anderson",
    });
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.name).toBe("Alice Anderson");
  });

  it("name optional: undefined gestopt → users-row.name is undefined", async () => {
    const t = convexTest(schema);
    await seedInvite(t, { email: "alice@x.com" });
    const userId = await t.mutation(registerFromSession, {
      subject: "user_alice",
      email: "alice@x.com",
    });
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.name).toBeUndefined();
  });
});

describe("registerFromSession — multi-invite atomic", () => {
  it("twee pending invites zelfde email → twee memberships + twee accepted-invites in één run", async () => {
    const t = convexTest(schema);
    const { groupId: groupA } = await seedGroup(t, "user_founderA", "Group A");
    const { groupId: groupB } = await seedGroup(t, "user_founderB", "Group B");
    const { inviteId: inviteA } = await seedInvite(t, {
      email: "alice@x.com",
      groupId: groupA,
      role: "member",
    });
    const { inviteId: inviteB } = await seedInvite(t, {
      email: "alice@x.com",
      groupId: groupB,
      role: "admin",
    });

    const userId = await t.mutation(registerFromSession, {
      subject: "user_alice",
      email: "alice@x.com",
    });

    const aInvite = await t.run((ctx) => ctx.db.get(inviteA));
    const bInvite = await t.run((ctx) => ctx.db.get(inviteB));
    expect(aInvite?.status).toBe("accepted");
    expect(bInvite?.status).toBe("accepted");

    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    expect(memberships).toHaveLength(2);
    const groupIds = memberships.map((m) => m.groupId).sort();
    expect(groupIds).toEqual([groupA, groupB].sort());
    const aMembership = memberships.find((m) => m.groupId === groupA);
    const bMembership = memberships.find((m) => m.groupId === groupB);
    expect(aMembership?.role).toBe("member");
    expect(bMembership?.role).toBe("admin");
  });
});

describe("registerFromSession — idempotent op subject", () => {
  it("tweede call zelfde subject → returned id is bestaande row, geen extra inserts", async () => {
    const t = convexTest(schema);
    await seedInvite(t, { email: "alice@x.com" });

    const firstId = await t.mutation(registerFromSession, {
      subject: "user_alice",
      email: "alice@x.com",
    });
    const secondId = await t.mutation(registerFromSession, {
      subject: "user_alice",
      email: "alice@x.com",
    });

    expect(secondId).toBe(firstId);
    const users = await t.run((ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_subject", (q) => q.eq("subject", "user_alice"))
        .collect(),
    );
    expect(users).toHaveLength(1);
  });

  it("re-login pad: nieuwe pending invite TUSSEN twee calls wordt NIET geaccepteerd door 2e call", async () => {
    // Pin't dat idempotent-on-subject = no-op bail-out, niet "re-run de
    // hele onboarding-flow". Anders zou re-login stille membership-changes
    // triggeren bij invites die ná eerste signup gemaakt zijn.
    const t = convexTest(schema);
    const { groupId } = await seedGroup(t);
    await seedInvite(t, {
      email: "alice@x.com",
      groupId,
      role: "member",
    });

    // Eerste call: users-row + membership.
    const userId = await t.mutation(registerFromSession, {
      subject: "user_alice",
      email: "alice@x.com",
    });
    const membershipsAfter1 = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    expect(membershipsAfter1).toHaveLength(1);

    // Nieuwe pending invite voor andere group (na eerste signup).
    const { groupId: groupB } = await seedGroup(t, "user_founderB", "Group B");
    const { inviteId: newInviteId } = await seedInvite(t, {
      email: "alice@x.com",
      groupId: groupB,
      role: "member",
    });

    // Tweede call (re-login event): no-op-pad.
    const secondId = await t.mutation(registerFromSession, {
      subject: "user_alice",
      email: "alice@x.com",
    });
    expect(secondId).toBe(userId);

    // Nieuwe invite blijft pending; geen extra membership.
    const newInvite = await t.run((ctx) => ctx.db.get(newInviteId));
    expect(newInvite?.status).toBe("pending");
    const membershipsAfter2 = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    expect(membershipsAfter2).toHaveLength(1);
  });
});

describe("registerFromSession — zero-invite fallback", () => {
  it("signup zonder enige invite (en geen webmaster) → users-row aangemaakt, geen membership", async () => {
    // Spec §invarianten: "Zero-invite fallback acceptabel" — terminal state
    // "registered-no-membership". Pin't dat dit géén throw is.
    const t = convexTest(schema);
    const userId = await t.mutation(registerFromSession, {
      subject: "user_orphan",
      email: "orphan@x.com",
    });
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.subject).toBe("user_orphan");
    expect(user?.email).toBe("orphan@x.com");
    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    expect(memberships).toHaveLength(0);
  });

  it("expired invite → behandeld als zero-invite (geen accept, geen membership)", async () => {
    const t = convexTest(schema);
    const { groupId } = await seedGroup(t);
    const { inviteId } = await seedInvite(t, {
      email: "alice@x.com",
      groupId,
      status: "expired",
      expiresAt: Date.now() - DAY_MS,
    });

    const userId = await t.mutation(registerFromSession, {
      subject: "user_alice",
      email: "alice@x.com",
    });

    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user).not.toBeNull();
    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("expired"); // niet geaccepteerd
    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    expect(memberships).toHaveLength(0);
  });

  it("pending-maar-verlopen invite (expiresAt in verleden) → zero-invite pad", async () => {
    const t = convexTest(schema);
    const { groupId } = await seedGroup(t);
    await seedInvite(t, {
      email: "alice@x.com",
      groupId,
      status: "pending",
      expiresAt: Date.now() - DAY_MS,
    });

    const userId = await t.mutation(registerFromSession, {
      subject: "user_alice",
      email: "alice@x.com",
    });

    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    expect(memberships).toHaveLength(0);
  });
});

describe("registerFromSession — webmaster bootstrap", () => {
  beforeEach(() => {
    process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
  });
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  it("webmaster-email zonder invite → users-row created (cold-start bypass), geen membership", async () => {
    const t = convexTest(schema);
    const userId = await t.mutation(registerFromSession, {
      subject: "user_webmaster",
      email: WEBMASTER_EMAIL,
    });
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.email).toBe(WEBMASTER_EMAIL);
    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    expect(memberships).toHaveLength(0);
  });
});

describe("registerFromSession — email-normalization", () => {
  it("mixed-case email argument matcht lowercase pending invite", async () => {
    const t = convexTest(schema);
    const { groupId } = await seedGroup(t);
    const { inviteId } = await seedInvite(t, {
      email: "bouncer@x.com",
      groupId,
      role: "member",
    });

    const userId = await t.mutation(registerFromSession, {
      subject: "user_bouncer",
      email: "Bouncer@X.com",
    });

    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.email).toBe("bouncer@x.com");
    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("accepted");
    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.groupId).toBe(groupId);
  });
});

describe("registerFromSession — email-uniqueness clash", () => {
  it("bestaande row met zelfde email + andere subject → throws (atomic rollback)", async () => {
    // Scenario: Clerk-dashboard user-delete + re-signup met zelfde email
    // levert nieuwe subject + email-collision. Spec-aanvulling §open-vraag-4
    // koos voor fail-loud throw → webhook 500 → Clerk-retry → ops-zichtbaar.
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        subject: "user_old_subject",
        email: "alice@x.com",
        photoCount: 0,
        photoLimit: 1000,
        createdAt: Date.now(),
      });
    });

    await expect(
      t.mutation(registerFromSession, {
        subject: "user_new_subject",
        email: "alice@x.com",
      }),
    ).rejects.toThrow();

    // Rollback: geen tweede users-row aangemaakt.
    const users = await t.run((ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", "alice@x.com"))
        .collect(),
    );
    expect(users).toHaveLength(1);
    expect(users[0]?.subject).toBe("user_old_subject");
  });
});

describe("registerFromSession — group-less invite", () => {
  it("invite zonder groupId → status patched naar accepted, geen membership-insert", async () => {
    // `invites.accept` patcht status maar slaat membership-insert over als
    // `invite.groupId === undefined`. Pin't dat registerFromSession dezelfde
    // discipline volgt; geen mystery-membership-insert.
    const t = convexTest(schema);
    const { inviteId } = await seedInvite(t, {
      email: "alice@x.com",
      // groupId weggelaten → invite zonder groep
    });

    const userId = await t.mutation(registerFromSession, {
      subject: "user_alice",
      email: "alice@x.com",
    });

    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("accepted");
    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    expect(memberships).toHaveLength(0);
  });
});
