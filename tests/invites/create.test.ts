// TDD red phase voor invites.create + invites.remove.
//
// Bron: er is geen oude AWS sendInvite handler in
// /Users/wintvelt/Documents/DEV/DEV/blob-images-api-invites/ — die zat
// in blob-images-api-groups/handlersInvite/sendInvite.js maar die directory
// bestaat niet meer in dit DEV-archief. De tests hieronder zijn afgeleid van:
// - de invite-shape die getInvite() in
//   blob-images-api-invites/handlersInvite/inviteHelpers.js verwacht
//   (PK/SK/status/createdAt/role/invitation/group/user fields)
// - de pre-signup check in blob-images-api/handlersCognito/preSignup.js
//   (invite is altijd email-based, niet user-based — Key.PK begint met "UMU"
//   gevolgd door subject als reeds-user, of "UME"+email anders)
// - de domeinregels uit acceptInvite.js (role kan "admin" of "guest" — in
//   v2 noemen we "guest" → "member" conform schema.ts memberships.role)
//
// Tests gemarkeerd [GAP] dekken edge cases die in oude AWS code ontbraken.

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

describe("invites.create — auth", () => {
  // Verwijst naar: oude pre-signup logica gaat ervan uit dat alleen authed
  // users invites kunnen aanmaken (de DynamoDB Put gebeurde via een andere
  // service met aws_iam authorizer).
  it("weigert zonder auth", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(api.invites.create, { email: "new@x.com" }),
    ).rejects.toThrow();
  });
});

describe("invites.create — general invite (geen groupId)", () => {
  // General invite = invite die enkel signup-toegang geeft, zonder direct
  // membership. In oude code was dit "UME"+email zonder group-scope, maar
  // werd in praktijk niet zo gebruikt. Hier expliciet gemodelleerd.
  it("authed user kan general invite sturen", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");

    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com" },
    );

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.email).toBe("new@x.com");
    expect(invite?.invitedBy).toBe(aliceId);
    expect(invite?.status).toBe("pending");
    expect(invite?.groupId).toBeUndefined();
    expect(invite?.role).toBeUndefined();
  });

  it("zet expiresAt in de toekomst (default ~14 dagen, conform expireDate uit blob-common)", async () => {
    // Verwijst naar: blob-common/core/date expireDate() — gebruikt in
    // inviteHelpers.js regel 31 voor expiry-check.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const before = Date.now();
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com" },
    );
    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.expiresAt).toBeGreaterThan(before);
    expect(invite?.createdAt).toBeGreaterThanOrEqual(before);
  });

  it("genereert unieke token per invite", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const a = await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "x@x.com",
    });
    const b = await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "y@x.com",
    });
    expect(a.token).not.toBe(b.token);
  });
});

describe("invites.create — group-scoped invite", () => {
  // Verwijst naar: acceptInvite.js regels 23-58 — group-scoped invite leidt
  // tot membership met `role` (admin/member). Sender moet member van die
  // group zijn (in oude code impliciet via aws_iam + frontend-flow).
  it("group-member kan invite sturen met role", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com", groupId, role: "admin" },
    );
    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.groupId).toBe(groupId);
    expect(invite?.role).toBe("admin");
  });

  it("default role is 'member' wanneer niet opgegeven", async () => {
    // [GAP] oude AWS code had geen default — frontend gaf altijd role mee.
    // Verdedigbaar default in v2.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com", groupId },
    );
    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.role).toBe("member");
  });

  it("non-member van de group wordt geweigerd", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_outsider", "out@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await expect(
      withUser(t, "user_outsider").mutation(api.invites.create, {
        email: "new@x.com",
        groupId,
      }),
    ).rejects.toThrow();
  });

  it("[GAP] weigert dubbele pending invite voor zelfde email + group", async () => {
    // Oude AWS code voorkwam dit niet — DynamoDB Put kon meerdere PK/SK
    // varianten aanmaken. In v2: deduplicate op (email, groupId, pending).
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "new@x.com",
      groupId,
      role: "member",
    });
    await expect(
      withUser(t, "user_alice").mutation(api.invites.create, {
        email: "new@x.com",
        groupId,
        role: "member",
      }),
    ).rejects.toThrow();
  });

  it("[audit-8 bevinding 2] weigert invite voor email die al member is — mixed-case", async () => {
    // Hangt aan de email-normalisatie-fix in users.register: als Bob als
    // "Bob@x.com" geregistreerd is en users.email niet lowercased opgeslagen
    // wordt, dan vindt invites.create's existingUser-lookup (op
    // normalizedEmail = "bob@x.com") niets → invite glipt door zonder "al
    // lid"-check. Na users.register-fix is users.email altijd lowercase en
    // werkt deze guard ook bij mixed-case input. RED tot B's fix.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "Bob@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await t.run((ctx) =>
      ctx.db.insert("memberships", {
        userId: bobId,
        groupId,
        role: "member",
        joinedAt: Date.now(),
      }),
    );
    await expect(
      withUser(t, "user_alice").mutation(api.invites.create, {
        email: "bob@x.com",
        groupId,
        role: "member",
      }),
    ).rejects.toThrow();
  });

  it("[GAP] weigert invite voor email die al member is van de group", async () => {
    // Oude AWS handler `getMemberAndInvite` ving dit pas in acceptInvite op
    // (regel 35). Beter: hier al weigeren zodat gebruiker geen verwarrende
    // invite-mail krijgt.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "bob@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    // Bob is reeds member (via accepted invite — fake setup direct in db)
    await t.run((ctx) =>
      ctx.db.insert("memberships", {
        userId: bobId,
        groupId,
        role: "member",
        joinedAt: Date.now(),
      }),
    );
    await expect(
      withUser(t, "user_alice").mutation(api.invites.create, {
        email: "bob@x.com",
        groupId,
        role: "member",
      }),
    ).rejects.toThrow();
  });
});

describe("invites.remove", () => {
  // Verwijst naar: er is geen aparte AWS-handler voor "intrekken" — invite
  // werd alleen verwijderd via accept (transactional Delete in acceptInvite.js
  // regel 27-31) of decline (publicDeclineInvite.js regel 14-16).
  // [GAP] Sender-initiated cancel was er niet; tests beschrijven gewenst gedrag.
  it("sender kan eigen pending invite intrekken", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com" },
    );
    await withUser(t, "user_alice").mutation(api.invites.remove, { inviteId });
    expect(await t.run((ctx) => ctx.db.get(inviteId))).toBeNull();
  });

  it("andere user (geen sender, geen group-admin) kan invite niet intrekken", async () => {
    // Bob is bewust géén admin van de invite-group — anders zou de
    // group-admin remove-regel hem alsnog toegang geven.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com", groupId, role: "member" },
    );
    await expect(
      withUser(t, "user_bob").mutation(api.invites.remove, { inviteId }),
    ).rejects.toThrow();
  });

  it("group-admin van invite-group kan invite intrekken (ook al is hij niet de sender)", async () => {
    // Wouter design call: group-admins mogen stale pending invites opruimen,
    // ook al hebben ze 'm niet zelf verstuurd. Gap t.o.v. oude code (had geen
    // remove-handler).
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    // Bob wordt admin van dezelfde group
    await t.run((ctx) =>
      ctx.db.insert("memberships", {
        userId: bobId,
        groupId,
        role: "admin",
        joinedAt: Date.now(),
      }),
    );
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com", groupId, role: "member" },
    );

    await withUser(t, "user_bob").mutation(api.invites.remove, { inviteId });
    expect(await t.run((ctx) => ctx.db.get(inviteId))).toBeNull();
  });

  it("zonder auth: throw", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com" },
    );
    await expect(
      t.mutation(api.invites.remove, { inviteId }),
    ).rejects.toThrow();
  });

  it("[GAP] reeds accepted invite kan niet meer ingetrokken worden", async () => {
    // Verdedigbaar: na accept is er een membership; intrekken zou dat
    // membership impliciet maken zonder cascade. Beter: blokkeer.
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
    await withUser(t, "user_bob").mutation(api.invites.accept, { token });
    await expect(
      withUser(t, "user_alice").mutation(api.invites.remove, { inviteId }),
    ).rejects.toThrow();
  });
});
