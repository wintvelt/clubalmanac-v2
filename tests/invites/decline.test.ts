// TDD red phase voor invites.decline.
//
// Bron: blob-images-api-invites/handlersInvite/publicDeclineInvite.js
//   - regel 9-12: getUserFromEvent + getInvite (zelfde access-checks als accept)
//   - regel 14-17: dynamoDb.delete — invite werd HARD verwijderd
//   - regel 30-36: ses.sendEmail naar invitor met declineInviteBody
// + blob-images-api-invites/emails/declinedInvite.js (subject + body)
//
// Designkeuze v2: i.p.v. hard delete patchen we status="declined" + respondedAt.
// Reden: audit trail, en `hasPendingForEmail` filtert al op status="pending".
// Tests gemarkeerd [GAP] dekken edge cases die in oude code ontbraken.

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
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
  // Audit-7 §5: seed pending invite om users.register-gate te passeren.
  const { inviteId, seederId } = await t.run(async (ctx) => {
    const seederId = await ctx.db.insert("users", {
      subject: `__invite_seeder_${crypto.randomUUID()}`,
      email: `seeder_${crypto.randomUUID()}@seed.test`,
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    });
    const inviteId = await ctx.db.insert("invites", {
      email: email.toLowerCase().trim(),
      invitedBy: seederId,
      token: crypto.randomUUID(),
      status: "pending",
      expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });
    return { inviteId, seederId };
  });
  const userId = await withUser(t, subject).mutation(api.users.register, { email });
  // Cleanup seed-artifacts zodat test-DB schoon blijft (geen extra
  // pending invites of seeder-users die latere queries vervuilen).
  await t.run(async (ctx) => {
    await ctx.db.delete(inviteId);
    await ctx.db.delete(seederId);
  });
  return userId;
}

describe("invites.decline — happy path", () => {
  // Verwijst naar publicDeclineInvite.js regel 14-17 — invite wordt
  // weggehaald. Hier: status patch i.p.v. delete (audit trail).
  it("zet status declined + respondedAt", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );

    const before = Date.now();
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.decline, { token });

    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("declined");
    expect(invite?.respondedAt).toBeGreaterThanOrEqual(before);
  });

  it("group-scoped decline: geen membership wordt aangemaakt", async () => {
    // Verwijst naar publicDeclineInvite.js: er wordt geen membership-Put
    // gedaan, alleen invite-Delete. v2 spiegelt dat: decline ≠ accept.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com", groupId, role: "member" },
    );
    const bobId = await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.decline, { token });

    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", bobId).eq("groupId", groupId),
        )
        .collect(),
    );
    expect(memberships).toHaveLength(0);
  });
});

describe("invites.decline — auth & access checks", () => {
  // Verwijst naar inviteHelpers.js regel 16 (`invite not for you`)
  // gebruikt door zowel accept als decline.
  it("weigert wanneer caller-email niet matcht invite-email", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await registerUser(t, "user_carol", "carol@x.com");
    await expect(
      withUser(t, "user_carol").mutation(api.invites.decline, { token }),
    ).rejects.toThrow(/email/i);
  });

  it("weigert onbekende token", async () => {
    // Verwijst naar inviteHelpers.js regel 25 (`invite not found`).
    const t = convexTest(schema);
    await registerUser(t, "user_bob", "bob@x.com");
    await expect(
      withUser(t, "user_bob").mutation(api.invites.decline, { token: "bogus" }),
    ).rejects.toThrow();
  });

  it("[GAP] weigert zonder auth", async () => {
    // Oude AWS-handler heette `publicDeclineInvite` maar had aws_iam
    // authorizer (zie serverless.yml regel 81). "Public" sloeg op de URL,
    // niet op anonymous toegang. v2 vereist eveneens auth.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await expect(
      t.mutation(api.invites.decline, { token }),
    ).rejects.toThrow();
  });
});

describe("invites.decline — idempotency & state guards", () => {
  it("[audit-8 order-bug] idempotent ook bij verkeerde caller — declined invite is final state", async () => {
    // Volgorde-bug in decline: email-mismatch werd gechecked vóór de
    // status==="declined" idempotency-return. Daardoor throwde een tweede
    // call (refresh, history-replay) met een andere caller "Invite is niet
    // voor jouw email" — terwijl de invite al een terminal-state had.
    //
    // Fix: status-checks vóór email-check. declined → return (no-op),
    // accepted/expired → throw, en pas dan email-vergelijking. Voor terminal
    // states leakt dat geen status-info meer omdat decline geen state-overgang
    // meer doet en de respondedAt/state al door de eerste, gerechtvaardigde
    // caller is gezet.
    //
    // RED tot B's reorder-fix in convex/invites.ts decline-handler.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.decline, { token });
    const firstResponded = (await t.run((ctx) => ctx.db.get(inviteId)))
      ?.respondedAt;

    // Carol probeert dezelfde invite te declinen (verkeerde email maar
    // invite is al final-state declined).
    await registerUser(t, "user_carol", "carol@x.com");
    await expect(
      withUser(t, "user_carol").mutation(api.invites.decline, { token }),
    ).resolves.not.toThrow();
    const after = await t.run((ctx) => ctx.db.get(inviteId));
    expect(after?.status).toBe("declined");
    expect(after?.respondedAt).toBe(firstResponded);
  });

  it("[audit-8] decline op invite met status='expired' (via bounce) throwt — bewust verschil met declined", async () => {
    // UX-keuze gepind: declined = user-initiated terminal state, dus
    // idempotent (refresh-safe). expired = system-initiated state, mogelijk
    // recoverable wanneer een nieuwe invite wordt verstuurd; behandelen als
    // throw zodat frontend een nette error-pagina kan tonen i.p.v. de UI
    // op "succes" te zetten.
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    await t.run((ctx) =>
      ctx.db.insert("invites", {
        email: "bob@x.com",
        invitedBy: aliceId,
        token: "tk-decline-expired-by-bounce",
        status: "expired",
        bouncedAt: Date.now() - 1000,
        expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
      }),
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await expect(
      withUser(t, "user_bob").mutation(api.invites.decline, {
        token: "tk-decline-expired-by-bounce",
      }),
    ).rejects.toThrow();
  });

  it("idempotent: tweede decline doet niets (geen throw)", async () => {
    // [GAP] oude code zou throwen op tweede call (invite was al gedeleted →
    // "invite not found"). v2: idempotent voor betere UX (refresh-safe).
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.decline, { token });
    const firstResponded = (await t.run((ctx) => ctx.db.get(inviteId)))
      ?.respondedAt;

    await expect(
      withUser(t, "user_bob").mutation(api.invites.decline, { token }),
    ).resolves.not.toThrow();

    const after = await t.run((ctx) => ctx.db.get(inviteId));
    expect(after?.status).toBe("declined");
    expect(after?.respondedAt).toBe(firstResponded);
  });

  it("weigert decline van reeds geaccepteerde invite", async () => {
    // [GAP] oude code: invite was na accept verwijderd, dus tweede actie
    // throwde "invite not found". v2 met audit-trail: expliciete guard.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.accept, { token });
    await expect(
      withUser(t, "user_bob").mutation(api.invites.decline, { token }),
    ).rejects.toThrow();
  });

  it("[audit-8] weigert invite met status='expired' (door bounce gemarkeerd, expiresAt nog in toekomst)", async () => {
    // Bounce-pad zet status="expired" + bouncedAt zonder aan expiresAt te
    // raken. Aparte status-guard nodig naast expiresAt-guard.
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    await t.run((ctx) =>
      ctx.db.insert("invites", {
        email: "bob@x.com",
        invitedBy: aliceId,
        token: "tk-status-expired-decline",
        status: "expired",
        bouncedAt: Date.now() - 1000,
        expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
      }),
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await expect(
      withUser(t, "user_bob").mutation(api.invites.decline, {
        token: "tk-status-expired-decline",
      }),
    ).rejects.toThrow();
  });

  it("weigert decline van verlopen invite", async () => {
    // Verwijst naar inviteHelpers.js regel 31-32: getInvite throwt op expiry,
    // dus oude decline-flow throwde ook al voor expired.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await t.run((ctx) =>
      ctx.db.patch(inviteId, { expiresAt: Date.now() - 1000 }),
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await expect(
      withUser(t, "user_bob").mutation(api.invites.decline, { token }),
    ).rejects.toThrow(/verlopen|expired/i);
  });
});

describe("invites.decline — side effects", () => {
  // Verwijst naar publicDeclineInvite.js regel 30-36: notify-mail naar
  // inviter via SES. v2: gequeue'de action via scheduler.
  it("plant notificatie-email naar inviter na decline", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.decline, { token });

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled.length).toBeGreaterThan(0);
  });

  it("[GAP] idempotente decline plant geen tweede email", async () => {
    // Oude code: tweede call throwde sowieso, dus dit was n.v.t.
    // v2 met idempotente decline: voorkom dubbele notify-spam.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.decline, { token });
    const countAfterFirst = await t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).length,
    );
    await withUser(t, "user_bob").mutation(api.invites.decline, { token });
    const countAfterSecond = await t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).length,
    );
    expect(countAfterSecond).toBe(countAfterFirst);
  });
});
