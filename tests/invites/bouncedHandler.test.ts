// TDD red phase voor de bounce-webhook handler.
//
// [GAP] Volledig nieuw — oude AWS-code in blob-images-api-invites/ had GEEN
// bounce-handler. SES-bounces werden niet teruggekoppeld naar de invite-state,
// waardoor:
//   1. Inviter geen feedback kreeg over een onleverbare invite
//   2. Pre-signup (preSignup.js regel 34-39) ten onrechte signup toestond
//      voor een email die nooit een leverbare invite-mail kreeg
//   3. Bounced emails konden de SES-reputatiescore beïnvloeden zonder dat
//      v2 daarop reageerde
//
// v2-design: email-provider (Resend / SES) → httpAction webhook
// → internal mutation `internal.invites.handleBounce` die:
//   - Pending invite(s) voor email patcht naar status="expired"
//   - bouncedAt zet (audit: "wanneer als bounce gedetecteerd")
//   - Plant notify-email naar inviter
//   - Idempotent op providerEventId (dedup voor herhaalde webhook-calls)
// respondedAt blijft gereserveerd voor user-initiated accept/decline; bounce
// is een system-event en gebruikt bouncedAt.
//
// Schema: status = "expired" + apart bouncedAt timestamp veld. Bouncing
// onderscheidt zich van natuurlijke expiry via bouncedAt-aanwezigheid.
// Schema-uitbreiding: invites.bouncedAt: v.optional(v.number()).

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const ISSUER = "https://picked-quail-97.clerk.accounts.dev";

function withUser(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
  });
}

async function registerUser(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email: string,
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      subject,
      email: email.toLowerCase().trim(),
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    }),
  );
}

describe("invites.handleBounce — happy path", () => {
  it("markeert pending invite voor email als expired + zet bouncedAt", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bouncer@x.com" },
    );

    const before = Date.now();
    const result = await t.mutation(internal.invites.handleBounce, {
      email: "bouncer@x.com",
      providerEventId: "evt_1",
    });
    const after = Date.now();
    expect(result.matched).toBe(1);

    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("expired");
    expect(typeof invite?.bouncedAt).toBe("number");
    expect(invite?.bouncedAt).toBeGreaterThanOrEqual(before);
    expect(invite?.bouncedAt).toBeLessThanOrEqual(after);
  });

  it("markeert ALLE pending invites voor zelfde email (multi-inviter scenario)", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_dan", "d@x.com");
    const groupA = await withUser(t, "user_alice").mutation(api.groups.create, {
      name: "A",
    });
    const groupD = await withUser(t, "user_dan").mutation(api.groups.create, {
      name: "D",
    });
    const { inviteId: i1 } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bouncer@x.com", groupId: groupA, role: "member" },
    );
    const { inviteId: i2 } = await withUser(t, "user_dan").mutation(
      api.invites.create,
      { email: "bouncer@x.com", groupId: groupD, role: "member" },
    );

    const before = Date.now();
    const result = await t.mutation(internal.invites.handleBounce, {
      email: "bouncer@x.com",
      providerEventId: "evt_multi",
    });
    const after = Date.now();
    expect(result.matched).toBe(2);
    for (const id of [i1, i2]) {
      const invite = await t.run((ctx) => ctx.db.get(id));
      expect(invite?.status).toBe("expired");
      expect(typeof invite?.bouncedAt).toBe("number");
      expect(invite?.bouncedAt).toBeGreaterThanOrEqual(before);
      expect(invite?.bouncedAt).toBeLessThanOrEqual(after);
    }
  });

  it("plant notify-email naar inviter per gebouncde invite", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "bouncer@x.com",
    });

    const before = await t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).length,
    );
    await t.mutation(internal.invites.handleBounce, {
      email: "bouncer@x.com",
      providerEventId: "evt_notify",
    });
    const after = await t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).length,
    );
    expect(after).toBeGreaterThan(before);
  });
});

describe("invites.handleBounce — guards & filtering", () => {
  it("laat reeds accepted invite ongewijzigd", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.accept, { token });

    const result = await t.mutation(internal.invites.handleBounce, {
      email: "bob@x.com",
      providerEventId: "evt_late",
    });
    expect(result.matched).toBe(0);
    expect((await t.run((ctx) => ctx.db.get(inviteId)))?.status).toBe(
      "accepted",
    );
  });

  it("laat reeds declined invite ongewijzigd", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.decline, { token });

    await t.mutation(internal.invites.handleBounce, {
      email: "bob@x.com",
      providerEventId: "evt_decl",
    });
    expect((await t.run((ctx) => ctx.db.get(inviteId)))?.status).toBe(
      "declined",
    );
  });

  it("[audit-8] bounce op pending invite met expiresAt < now (cron heeft nog niet gedraaid)", async () => {
    // Edge case: een invite kan natuurlijk verlopen zijn (expiresAt < now)
    // maar nog status="pending" hebben omdat de IB2 daily cron 'm nog niet
    // langs is geweest. Komt er dan een (late) bounce binnen, dan vinden
    // we 'm via findInvitesByEmail + status==="pending" filter, wordt
    // status gepatcht naar "expired" en bouncedAt gezet. Pinnen huidige
    // gedrag: handleBounce kijkt niet naar expiresAt, alleen naar status.
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const inviteId = await t.run((ctx) =>
      ctx.db.insert("invites", {
        email: "bouncer@x.com",
        invitedBy: aliceId,
        token: "tk-natural-then-bounce",
        status: "pending",
        expiresAt: Date.now() - 1000,
        createdAt: Date.now() - 60_000,
      }),
    );
    const result = await t.mutation(internal.invites.handleBounce, {
      email: "bouncer@x.com",
      providerEventId: "evt_natural_then_bounce",
    });
    expect(result.matched).toBe(1);
    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("expired");
    expect(typeof invite?.bouncedAt).toBe("number");
  });

  it("onbekende email: no-op (geen throw, matched=0)", async () => {
    const t = convexTest(schema);
    const result = await t.mutation(internal.invites.handleBounce, {
      email: "nobody@x.com",
      providerEventId: "evt_nobody",
    });
    expect(result.matched).toBe(0);
  });

  it("case-insensitive email match (consistent met hasPendingForEmail)", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "Bouncer@X.com" },
    );
    const before = Date.now();
    const result = await t.mutation(internal.invites.handleBounce, {
      email: "bouncer@x.com",
      providerEventId: "evt_case",
    });
    const after = Date.now();
    expect(result.matched).toBe(1);
    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("expired");
    expect(typeof invite?.bouncedAt).toBe("number");
    expect(invite?.bouncedAt).toBeGreaterThanOrEqual(before);
    expect(invite?.bouncedAt).toBeLessThanOrEqual(after);
  });
});

describe("invites.handleBounce — idempotency (dedup op providerEventId)", () => {
  it("tweede call met zelfde providerEventId is no-op", async () => {
    // Email-providers retry'en webhooks bij non-2xx. Dedup voorkomt dubbele
    // notify-mails en dubbele state-transitions.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bouncer@x.com" },
    );

    const before = Date.now();
    const first = await t.mutation(internal.invites.handleBounce, {
      email: "bouncer@x.com",
      providerEventId: "evt_dup",
    });
    const after = Date.now();
    const firstInvite = await t.run((ctx) => ctx.db.get(inviteId));
    const firstBouncedAt = firstInvite?.bouncedAt;
    expect(typeof firstBouncedAt).toBe("number");
    expect(firstBouncedAt).toBeGreaterThanOrEqual(before);
    expect(firstBouncedAt).toBeLessThanOrEqual(after);
    const scheduledAfterFirst = await t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).length,
    );

    const second = await t.mutation(internal.invites.handleBounce, {
      email: "bouncer@x.com",
      providerEventId: "evt_dup",
    });

    expect(first.matched).toBe(1);
    expect(second.matched).toBe(0);
    expect((await t.run((ctx) => ctx.db.get(inviteId)))?.bouncedAt).toBe(
      firstBouncedAt,
    );
    const scheduledAfterSecond = await t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).length,
    );
    expect(scheduledAfterSecond).toBe(scheduledAfterFirst);
  });

  it("nieuwe bounce-event op zelfde email (andere providerEventId, latere invite) gaat wel door", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "bouncer@x.com",
    });

    // Eerste bounce
    await t.mutation(internal.invites.handleBounce, {
      email: "bouncer@x.com",
      providerEventId: "evt_a",
    });
    // Inviter probeert opnieuw
    const { inviteId: i2 } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bouncer@x.com" },
    );
    // Bounce komt opnieuw
    const before = Date.now();
    const result = await t.mutation(internal.invites.handleBounce, {
      email: "bouncer@x.com",
      providerEventId: "evt_b",
    });
    const after = Date.now();
    expect(result.matched).toBe(1);
    const invite = await t.run((ctx) => ctx.db.get(i2));
    expect(invite?.status).toBe("expired");
    expect(typeof invite?.bouncedAt).toBe("number");
    expect(invite?.bouncedAt).toBeGreaterThanOrEqual(before);
    expect(invite?.bouncedAt).toBeLessThanOrEqual(after);
  });
});

describe("invites.handleBounce — interactie met pre-signup check", () => {
  it("na bounce: hasPendingForEmail returnt false (signup geblokkeerd)", async () => {
    // Verwijst naar preSignup.js regel 34-39: invite-presence is signup-gate.
    // Bounce moet die gate sluiten zodat een typo'd email niet alsnog kan
    // signuppen via een andere route (bijv. invite herverstuurd naar correct
    // adres dat per ongeluk overlap heeft).
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "bouncer@x.com",
    });
    expect(
      await t.query(api.invites.hasPendingForEmail, { email: "bouncer@x.com" }),
    ).toBe(true);

    await t.mutation(internal.invites.handleBounce, {
      email: "bouncer@x.com",
      providerEventId: "evt_signupgate",
    });

    expect(
      await t.query(api.invites.hasPendingForEmail, { email: "bouncer@x.com" }),
    ).toBe(false);
  });
});
