// TDD red phase voor invites.accept.
//
// Bron: blob-images-api-invites/handlersInvite/acceptInvite.js
//   - regel 14-16: getInvite() validatie (access, status, expiry)
//   - regel 19-23: inviteIsForThisUser → simpele status patch naar "active"
//   - regel 26-58: email-based invite → membership create/upsert
//   - regel 35-45: hasBetterRoleForMember → upgrade member van guest naar admin
//   - regel 73-79: SES email naar invitor met acceptInviteBody
// + blob-images-api-invites/handlersInvite/inviteHelpers.js
//   - regel 28: throw "invite already accepted"
//   - regel 31-32: throw "invite expired"
//
// In v2-schema is "guest" → "member", role-upgrade is van member naar admin.
// Tests gemarkeerd [GAP] dekken edge cases die in oude code ontbraken.

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api , internal } from "../../convex/_generated/api";
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

describe("invites.accept — auth & token validatie", () => {
  // Verwijst naar inviteHelpers.js regel 11 (ongeldige inviteId) en
  // regel 25 (invite niet gevonden).
  it("weigert onbekende token", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_bob", "bob@x.com");
    await expect(
      withUser(t, "user_bob").mutation(api.invites.accept, { token: "bogus" }),
    ).rejects.toThrow();
  });

  it("weigert zonder auth (anonymous accept niet toegestaan)", async () => {
    // Verwijst naar acceptInvite.js regel 13: getUserFromEvent throwt indien
    // geen sub. Bovendien hangt heel de membership-create van userId af.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await expect(
      t.mutation(api.invites.accept, { token }),
    ).rejects.toThrow();
  });

  it("weigert wanneer caller-email niet matcht invite-email", async () => {
    // Verwijst naar inviteHelpers.js regel 16: "invite not for you".
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await registerUser(t, "user_carol", "carol@x.com");
    await expect(
      withUser(t, "user_carol").mutation(api.invites.accept, { token }),
    ).rejects.toThrow(/email/i);
  });
});

describe("invites.accept — status transitions", () => {
  // Verwijst naar inviteHelpers.js regel 28: status moet "invite" zijn,
  // anders "invite already accepted".
  it("weigert reeds geaccepteerde invite", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.accept, { token });
    await expect(
      withUser(t, "user_bob").mutation(api.invites.accept, { token }),
    ).rejects.toThrow();
  });

  it("weigert reeds gedeclined invite", async () => {
    // [GAP] oude code checkte alleen `status !== 'invite'` zonder onderscheid.
    // In v2 met expliciete declined-status moet dit ook geweigerd worden.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.decline, { token });
    await expect(
      withUser(t, "user_bob").mutation(api.invites.accept, { token }),
    ).rejects.toThrow();
  });

  it("[audit-8] weigert invite met status='expired' (door bounce gemarkeerd, expiresAt nog in toekomst)", async () => {
    // Bounce-pad zet status="expired" + bouncedAt zonder aan expiresAt te
    // raken. De expiry-guard (`expiresAt < now`) zou dan níet vuren — daarom
    // is de aparte status-guard (`status !== "pending"`) ook nodig.
    // Bestaande tests dekken expiresAt < now; deze pint het status-pad apart.
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const inviteId = await t.run((ctx) =>
      ctx.db.insert("invites", {
        email: "bob@x.com",
        invitedBy: aliceId,
        token: "tk-status-expired-accept",
        status: "expired",
        bouncedAt: Date.now() - 1000,
        expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
      }),
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await expect(
      withUser(t, "user_bob").mutation(api.invites.accept, {
        token: "tk-status-expired-accept",
      }),
    ).rejects.toThrow();
    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("expired");
  });

  it("weigert verlopen invite (rollback: status blijft pending)", async () => {
    // Verwijst naar inviteHelpers.js regel 31-32. Convex-mutations zijn
    // atomisch, dus een throw rolt eventueel patch terug. Cleanup naar
    // "expired" status hoort in de cron (zie publicGet.test.ts + bouncedHandler).
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
      withUser(t, "user_bob").mutation(api.invites.accept, { token }),
    ).rejects.toThrow(/verlopen|expired/i);
    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("pending");
  });
});

describe("invites.accept — expiresAt boundary (audit-8 bevinding 9)", () => {
  // Audit-8 vond inconsistentie tussen accept (`expiresAt < now` = strict
  // less = nog geldig op gelijk) en hasPendingForEmail (`expiresAt > now` =
  // strict greater = al verlopen op gelijk). Spec-keuze (Wouter): expiresAt
  // === now telt als verlopen (≤ now is verlopen). Harmonisatie: accept
  // moet throwen bij gelijk-aan-now, hasPendingForEmail moet false geven
  // bij gelijk-aan-now (laatste klopt al, eerste niet). RED tot B's fix.
  it("weigert invite waar expiresAt === now exact (≤ now is verlopen)", async () => {
    vi.useFakeTimers();
    try {
      const fixedNow = new Date("2026-04-30T12:00:00Z").getTime();
      vi.setSystemTime(fixedNow);

      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      await t.run((ctx) =>
        ctx.db.insert("invites", {
          email: "bob@x.com",
          invitedBy: aliceId,
          token: "tk-boundary",
          status: "pending",
          expiresAt: fixedNow,
          createdAt: fixedNow - 1000,
        }),
      );
      await registerUser(t, "user_bob", "bob@x.com");
      await expect(
        withUser(t, "user_bob").mutation(api.invites.accept, {
          token: "tk-boundary",
        }),
      ).rejects.toThrow(/verlopen|expired/i);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("invites.accept — group-scoped invite (membership create)", () => {
  // Verwijst naar acceptInvite.js regel 26-58: TransactItems Put membership.
  it("zet status accepted + maakt membership met juiste role", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com", groupId, role: "admin" },
    );

    const bobId = await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.accept, { token });

    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("accepted");
    expect(invite?.respondedAt).toBeGreaterThan(0);

    const m = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", bobId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(m?.role).toBe("admin");
  });

  it("respondedAt wordt gezet op accept-tijdstip", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com", groupId, role: "member" },
    );
    const before = Date.now();
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.accept, { token });
    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.respondedAt).toBeGreaterThanOrEqual(before);
  });

  it("upgrade: bestaand member-membership wordt admin als invite role=admin", async () => {
    // Verwijst naar acceptInvite.js regel 37-45: hasBetterRoleForMember.
    // Schema-mapping: oude "guest"→nieuwe "member", oude "admin"→"admin".
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const bobId = await registerUser(t, "user_bob", "bob@x.com");
    // Bob is reeds member
    await t.run((ctx) =>
      ctx.db.insert("memberships", {
        userId: bobId,
        groupId,
        role: "member",
        joinedAt: Date.now(),
      }),
    );
    // Alice nodigt Bob alsnog uit als admin (workaround voor invite-create
    // dedup: bypass via direct insert simuleert pre-existing invite-flow)
    const inviteId = await t.run(async (ctx) =>
      ctx.db.insert("invites", {
        email: "bob@x.com",
        invitedBy: (await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", "a@x.com"))
          .unique())!._id,
        groupId,
        role: "admin",
        token: "tk-upgrade",
        status: "pending",
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }),
    );
    void inviteId;
    await withUser(t, "user_bob").mutation(api.invites.accept, {
      token: "tk-upgrade",
    });

    const m = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", bobId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(m?.role).toBe("admin");
  });

  it("[GAP] geen downgrade: bestaand admin blijft admin bij member-invite accept", async () => {
    // Oude code: hasBetterRoleForMember was alleen guest→admin upgrade,
    // niet andersom. Maar er was geen expliciete test of guard. Borg het.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const bobId = await registerUser(t, "user_bob", "bob@x.com");
    await t.run((ctx) =>
      ctx.db.insert("memberships", {
        userId: bobId,
        groupId,
        role: "admin",
        joinedAt: Date.now(),
      }),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("invites", {
        email: "bob@x.com",
        invitedBy: (await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", "a@x.com"))
          .unique())!._id,
        groupId,
        role: "member",
        token: "tk-no-downgrade",
        status: "pending",
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }),
    );
    await withUser(t, "user_bob").mutation(api.invites.accept, {
      token: "tk-no-downgrade",
    });
    const m = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", bobId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(m?.role).toBe("admin");
  });
});

describe("invites.accept — multi-group scenarios (audit-8)", () => {
  // Een user kan in parallel pending invites hebben voor meerdere groepen.
  // Accept van invite-A mag invite-B niet beïnvloeden — beide leven
  // onafhankelijk in invites table met verschillende tokens. Pinnen huidige
  // (correcte) gedrag voordat code-paden refactoren.
  it("user met pending invites in 2 groepen kan beide accepteren", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const groupG = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const groupH = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "H" },
    );
    const { token: tokenG } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com", groupId: groupG, role: "member" },
    );
    const { token: tokenH } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com", groupId: groupH, role: "member" },
    );
    const bobId = await registerUser(t, "user_bob", "bob@x.com");

    await withUser(t, "user_bob").mutation(api.invites.accept, {
      token: tokenG,
    });
    await withUser(t, "user_bob").mutation(api.invites.accept, {
      token: tokenH,
    });

    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", bobId))
        .collect(),
    );
    const groupIds = memberships.map((m) => m.groupId).sort();
    expect(groupIds).toEqual([groupG, groupH].sort());
  });

  it("accept van invite voor groep G laat invite voor groep H ongemoeid", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const groupG = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const groupH = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "H" },
    );
    const { token: tokenG } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com", groupId: groupG, role: "member" },
    );
    const { inviteId: inviteH } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com", groupId: groupH, role: "member" },
    );
    await registerUser(t, "user_bob", "bob@x.com");

    await withUser(t, "user_bob").mutation(api.invites.accept, {
      token: tokenG,
    });

    const inviteHafter = await t.run((ctx) => ctx.db.get(inviteH));
    expect(inviteHafter?.status).toBe("pending");
    expect(inviteHafter?.respondedAt).toBeUndefined();
  });
});

describe("invites.accept — general invite (geen groupId)", () => {
  // Verwijst impliciet naar acceptInvite.js: dit pad bestond niet expliciet
  // in oude code (alle invites hadden een group). [GAP-ish] in v2 kan
  // signup-only invite bestaan voor enkel platform-toegang.
  it("accept zonder groupId: status accepted, geen membership aangemaakt", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );

    const bobId = await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.accept, { token });

    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("accepted");

    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", bobId))
        .collect(),
    );
    expect(memberships).toHaveLength(0);
  });
});

describe("invites.accept — side effects", () => {
  // Verwijst naar acceptInvite.js regel 73-79: ses.sendEmail naar invitor.
  // In Convex: scheduler.runAfter(0, internal.email.send, { ... }) of
  // vergelijkbaar — zichtbaar in _scheduled_functions system table.
  it("plant notificatie-email naar inviter na succesvolle accept", async () => {
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
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.accept, { token });

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled.length).toBeGreaterThan(0);
  });

  it("[GAP] mislukte email-action faalt accept-mutation niet (best-effort)", async () => {
    // Oude AWS code awaitte ses.sendEmail in dezelfde lambda — als SES
    // faalde, faalde ook de hele accept (en gebruiker kreeg geen membership).
    // In Convex: email als gequeue'de action zodat mutation-success ontkoppeld
    // is van email-delivery. Test: accept slaagt zelfs als scheduler-target
    // bestaat niet (proxy: succes is voldoende).
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com", groupId, role: "member" },
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await expect(
      withUser(t, "user_bob").mutation(api.invites.accept, { token }),
    ).resolves.not.toThrow();
    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("accepted");
  });
});
