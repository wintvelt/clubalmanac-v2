// WP6 RED-phase: /clerk-webhook payload-event-type-filter + email-resolutie.
//
// Spec-aanvulling pin't:
//   - Alleen `session.created` triggert onboarding-flow
//   - Andere event-types (user.created/updated/deleted, session.ended/etc.)
//     → 200 no-op (anders disablet Clerk de webhook bij 5xx)
//   - `data.user === null` → 200 no-op + geen state-mutatie
//   - Onverified primary email → 200 no-op (Clerk's email-verify is
//     ownership-bewijs; zonder verify geen invite-match)
//   - Lege `email_addresses` → 200 no-op (oauth-only user zonder email)
//   - Email-resolutie via `primary_email_address_id`, NIET via index 0
//   - Mixed-case email payload matcht lowercase pending invite
//
// Auth-laag is in `webhookAuth.test.ts` apart gepin'd; deze file gebruikt
// overal geldige Svix-headers.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerUserWithInvite, withUser } from "../_helpers/auth";
import {
  eventPayload,
  sessionCreatedPayload,
  sessionCreatedNullUserPayload,
  signSvixHeaders,
  TEST_WEBHOOK_SECRET,
} from "../_helpers/svix";

beforeEach(() => {
  process.env.CLERK_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
});

afterEach(() => {
  delete process.env.CLERK_WEBHOOK_SECRET;
});

async function post(t: ReturnType<typeof convexTest>, body: string) {
  const headers = signSvixHeaders({ body });
  return await t.fetch("/clerk-webhook", {
    method: "POST",
    headers,
    body,
  });
}

describe("/clerk-webhook — event-type filter", () => {
  it("session.created met valid user + pending invite → users-row + accept + membership", async () => {
    const t = convexTest(schema);
    // Inviter-user voor de invite-creator.
    await registerUserWithInvite(t, "user_inviter", "inviter@x.com", "Inviter");
    const { groupId } = await withUser(t, "user_inviter").mutation(
      api.groups.create,
      { name: "Test group" },
    );
    await withUser(t, "user_inviter").mutation(api.invites.create, {
      email: "alice@x.com",
      groupId,
    });

    const body = sessionCreatedPayload({
      subject: "user_alice",
      email: "alice@x.com",
      firstName: "Alice",
    });
    const res = await post(t, body);

    expect(res.status).toBe(200);
    const aliceUser = await t.run((ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_subject", (q) => q.eq("subject", "user_alice"))
        .unique(),
    );
    expect(aliceUser).not.toBeNull();
    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", aliceUser!._id))
        .collect(),
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.groupId).toBe(groupId);
    const invites = await t.run((ctx) =>
      ctx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", "alice@x.com"))
        .collect(),
    );
    expect(invites).toHaveLength(1);
    expect(invites[0]?.status).toBe("accepted");
  });

  it("user.created event → 200 no-op (geen users-row)", async () => {
    const t = convexTest(schema);
    const body = eventPayload({
      type: "user.created",
      subject: "user_alice",
      email: "alice@x.com",
    });
    const res = await post(t, body);

    expect(res.status).toBe(200);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });

  it("user.updated event → 200 no-op", async () => {
    const t = convexTest(schema);
    const body = eventPayload({
      type: "user.updated",
      subject: "user_alice",
      email: "alice@x.com",
    });
    const res = await post(t, body);
    expect(res.status).toBe(200);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });

  it("user.deleted event → 200 no-op (bewust uit scope per spec)", async () => {
    const t = convexTest(schema);
    const body = eventPayload({
      type: "user.deleted",
      subject: "user_alice",
      email: "alice@x.com",
    });
    const res = await post(t, body);
    expect(res.status).toBe(200);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });

  it("session.ended event → 200 no-op", async () => {
    const t = convexTest(schema);
    const body = eventPayload({
      type: "session.ended",
      subject: "user_alice",
      email: "alice@x.com",
    });
    const res = await post(t, body);
    expect(res.status).toBe(200);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });
});

describe("/clerk-webhook — graceful no-op cases (200)", () => {
  it("data.user === null → 200 no-op, geen users-row", async () => {
    const t = convexTest(schema);
    const body = sessionCreatedNullUserPayload("user_alice");
    const res = await post(t, body);
    expect(res.status).toBe(200);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });

  it("onverified primary email → 200 no-op (geen ownership-bewijs)", async () => {
    const t = convexTest(schema);
    const body = sessionCreatedPayload({
      subject: "user_alice",
      email: "alice@x.com",
      emailVerified: false,
    });
    const res = await post(t, body);
    expect(res.status).toBe(200);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });

  it("lege email_addresses array → 200 no-op", async () => {
    const t = convexTest(schema);
    const body = sessionCreatedPayload({
      subject: "user_alice",
      email: "alice@x.com",
      emailAddresses: [],
    });
    const res = await post(t, body);
    expect(res.status).toBe(200);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });

  it("primary_email_address_id wijst niet naar bestaand address → 200 no-op", async () => {
    const t = convexTest(schema);
    const body = sessionCreatedPayload({
      subject: "user_alice",
      email: "alice@x.com",
      primaryEmailId: "idn_does_not_exist",
      emailAddresses: [
        { id: "idn_other", email: "other@x.com", verified: true },
      ],
    });
    const res = await post(t, body);
    expect(res.status).toBe(200);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });
});

describe("/clerk-webhook — email-resolutie discipline", () => {
  it("primary_email_address_id wijst naar tweede address (niet index 0) → resolveert correct", async () => {
    // Pin't dat email-resolutie NIET via `email_addresses[0]` gaat. Een user
    // met een primary alias en een secondary verified backup-address heeft
    // beide in de payload; alleen de primary (per Clerk-user-instelling)
    // mag geclaim'd worden. Anders zou backup-email een invite kunnen
    // accepteren die niet voor 'm bedoeld is.
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_inviter", "inviter@x.com");
    const { groupId } = await withUser(t, "user_inviter").mutation(
      api.groups.create,
      { name: "Test group" },
    );
    // Invite voor de PRIMARY (alice@x.com), niet voor secondary (backup@x.com).
    await withUser(t, "user_inviter").mutation(api.invites.create, {
      email: "alice@x.com",
      groupId,
    });

    const body = sessionCreatedPayload({
      subject: "user_alice",
      email: "alice@x.com",
      primaryEmailId: "idn_alice_primary",
      emailAddresses: [
        // Index 0 = backup, NIET primary
        { id: "idn_backup", email: "backup@x.com", verified: true },
        { id: "idn_alice_primary", email: "alice@x.com", verified: true },
      ],
    });
    const res = await post(t, body);
    expect(res.status).toBe(200);

    const aliceUser = await t.run((ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_subject", (q) => q.eq("subject", "user_alice"))
        .unique(),
    );
    expect(aliceUser).not.toBeNull();
    // Email-resolutie ging via primary → alice@x.com, niet backup@x.com.
    expect(aliceUser?.email).toBe("alice@x.com");
    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", aliceUser!._id))
        .collect(),
    );
    expect(memberships).toHaveLength(1);
  });

  it("mixed-case email in payload → matcht lowercase pending invite", async () => {
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_inviter", "inviter@x.com");
    const { groupId } = await withUser(t, "user_inviter").mutation(
      api.groups.create,
      { name: "Test group" },
    );
    // Invite seeded met normalized lowercase.
    await withUser(t, "user_inviter").mutation(api.invites.create, {
      email: "bouncer@x.com",
    });
    // Clerk-payload heeft mixed-case (kan in praktijk gebeuren als user
    // mixed-case typt in signup-form).
    await withUser(t, "user_inviter").mutation(api.invites.create, {
      email: "BOUNCER@X.COM",
      groupId,
    });

    const body = sessionCreatedPayload({
      subject: "user_bouncer",
      email: "Bouncer@X.com",
    });
    const res = await post(t, body);
    expect(res.status).toBe(200);

    const u = await t.run((ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_subject", (q) => q.eq("subject", "user_bouncer"))
        .unique(),
    );
    expect(u).not.toBeNull();
    expect(u?.email).toBe("bouncer@x.com");
    const invites = await t.run((ctx) =>
      ctx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", "bouncer@x.com"))
        .collect(),
    );
    // Beide invites (eerste zonder group + tweede met group) zijn voor
    // hetzelfde normalized email → beide moeten geaccepteerd zijn.
    for (const i of invites) {
      expect(i.status).toBe("accepted");
    }
  });
});
