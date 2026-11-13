import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { clerkSubjectHash } from "../../convex/lib/accountState";
import { ISSUER } from "../_helpers/auth";
import { TEST_WEBHOOK_SECRET, sessionCreatedPayload, signSvixHeaders } from "../_helpers/svix";
import { as, newT, type T } from "../groups/_beheer";
import { allInvites, refusalData, seedInvite, usersByEmail, world } from "../invites/_wp19b";

// WP19b fix-cyclus 1 (besluit 3), backend-kant. Spec:
// docs/work-packages/WP19b-uitnodigen-aanmelden.md §Besluit 3 en
// §A-invarianten fix-cyclus 1 (A-invariant 17–19).
//
// A-invariant 17 (S1): een tweede Clerk-subject met een adres dat al een
//   users-rij heeft, blijft fail-loud: registerFromSession gooit, ook zonder
//   uitnodiging, en de webhook geeft geen 200 (Svix herhaalt, ops ziet het).
//   signupState zegt dan "blocked", niet "noInvite": de onboarding komt niet
//   vanzelf en een uitnodiging helpt niet.
// A-invariant 18 (S2, tweede geval): een Clerk-subject in
//   deletedClerkSubjects krijgt nooit een rij; signupState zegt "blocked",
//   ook met een open uitnodiging (niet "waiting", dat zou een spinner geven).
// A-invariant 19 (N1): uitnodigen van een adres waarvan het account wordt
//   verwijderd, geeft ConvexError { code: "EMAIL_BEING_DELETED", email } met
//   het genormaliseerde adres.

beforeEach(() => {
  vi.useFakeTimers();
  process.env.CLERK_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.CLERK_WEBHOOK_SECRET;
});

const signupState = api.users.signupState;
const registerFromSession = internal.users.registerFromSession;

function session(t: T, subject: string, email?: string) {
  return t.withIdentity({
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    ...(email !== undefined ? { email } : {}),
  });
}

function webhookSession(t: T, subject: string, email: string) {
  const body = sessionCreatedPayload({ subject, email, firstName: "Bob" });
  return t.fetch("/clerk-webhook", { method: "POST", headers: signSvixHeaders({ body }), body });
}

async function markDeletedSubject(t: T, subject: string) {
  const subjectHash = await clerkSubjectHash(subject);
  await t.run(async (ctx) => ctx.db.insert("deletedClerkSubjects", { subjectHash, deletedAt: Date.now() }));
}

// bob heeft een rij (subject user_bob, bob@x.test) en geen lidmaatschap.
const BOB = "bob@x.test";
const NEW_SUBJECT = "user_bob_nieuw";

describe("A-invariant 17 (S1) — tweede subject, adres heeft al een rij", () => {
  it("zonder uitnodiging: registerFromSession gooit; er blijft één rij, met het oude subject", async () => {
    const t = newT();
    await world(t);
    await expect(t.mutation(registerFromSession, { subject: NEW_SUBJECT, email: BOB })).rejects.toThrow();
    const rows = await usersByEmail(t, BOB);
    expect(rows.map((u) => u.subject)).toEqual(["user_bob"]);
  });

  it("zonder uitnodiging, adres in een andere schrijfwijze: ook dan gooit hij", async () => {
    const t = newT();
    await world(t);
    await expect(t.mutation(registerFromSession, { subject: NEW_SUBJECT, email: " Bob@X.test " })).rejects.toThrow();
    expect(await usersByEmail(t, BOB)).toHaveLength(1);
  });

  it("zonder uitnodiging: de webhook geeft geen 200 (fail-loud, Svix herhaalt)", async () => {
    const t = newT();
    await world(t);
    let status: number | "throw";
    try {
      status = (await webhookSession(t, NEW_SUBJECT, BOB)).status;
    } catch {
      status = "throw";
    }
    expect(status).not.toBe(200);
    expect(await usersByEmail(t, BOB)).toHaveLength(1);
  });

  it("met een accepteerbare uitnodiging: hij gooit (ongewijzigd) en de uitnodiging blijft open", async () => {
    const t = newT();
    const w = await world(t);
    const inviteId = await seedInvite(t, { email: BOB, invitedBy: w.users.olga!, groupId: w.groupId });
    await expect(t.mutation(registerFromSession, { subject: NEW_SUBJECT, email: BOB })).rejects.toThrow();
    expect((await allInvites(t)).find((i) => i._id === inviteId)?.status).toBe("pending");
  });

  it("signupState zonder uitnodiging: blocked, niet noInvite", async () => {
    const t = newT();
    await world(t);
    expect(await session(t, NEW_SUBJECT, BOB).query(signupState, {})).toBe("blocked");
  });

  it("signupState met een accepteerbare uitnodiging: blocked, niet waiting (de onboarding komt niet)", async () => {
    const t = newT();
    const w = await world(t);
    await seedInvite(t, { email: BOB, invitedBy: w.users.olga!, groupId: w.groupId });
    expect(await session(t, NEW_SUBJECT, BOB).query(signupState, {})).toBe("blocked");
  });

  it("signupState: het adres uit de sessie telt hoofdletter-ongevoelig", async () => {
    const t = newT();
    await world(t);
    expect(await session(t, NEW_SUBJECT, "Bob@X.TEST").query(signupState, {})).toBe("blocked");
  });

  it("signupState: de rij met hetzelfde adres wordt verwijderd: ook blocked (nog niet klaar)", async () => {
    const t = newT();
    const w = await world(t);
    await t.run(async (ctx) => ctx.db.patch(w.users.bob!, { deletion: { startedAt: Date.now() } }));
    expect(await session(t, NEW_SUBJECT, BOB).query(signupState, {})).toBe("blocked");
  });

  it("het eigen subject met de eigen rij blijft account", async () => {
    const t = newT();
    await world(t);
    expect(await session(t, "user_bob", BOB).query(signupState, {})).toBe("account");
  });

  it("een nieuw adres zonder rij en zonder uitnodiging blijft noInvite", async () => {
    const t = newT();
    await world(t);
    expect(await session(t, "user_nieuw", "nieuw@x.test").query(signupState, {})).toBe("noInvite");
  });
});

describe("A-invariant 18 (S2) — gewiste Clerk-subject", () => {
  it("met een open, accepteerbare uitnodiging: signupState blocked, niet waiting", async () => {
    const t = newT();
    const w = await world(t);
    await markDeletedSubject(t, "user_weg");
    await seedInvite(t, { email: "weg@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    expect(await session(t, "user_weg", "weg@x.test").query(signupState, {})).toBe("blocked");
    // En de onboarding maakt inderdaad geen rij.
    try {
      await t.mutation(registerFromSession, { subject: "user_weg", email: "weg@x.test" });
    } catch {
      // weigeren mag
    }
    expect(await usersByEmail(t, "weg@x.test")).toEqual([]);
  });

  it("zonder uitnodiging: signupState blocked (een uitnodiging zou niet helpen)", async () => {
    const t = newT();
    await world(t);
    await markDeletedSubject(t, "user_weg");
    expect(await session(t, "user_weg", "weg@x.test").query(signupState, {})).toBe("blocked");
  });

  it("een ander subject met hetzelfde adres en een uitnodiging: gewoon waiting", async () => {
    const t = newT();
    const w = await world(t);
    await markDeletedSubject(t, "user_weg");
    await seedInvite(t, { email: "weg@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    expect(await session(t, "user_weg_nieuw", "weg@x.test").query(signupState, {})).toBe("waiting");
  });
});

describe("A-invariant 19 (N1) — uitnodigen terwijl het account wordt verwijderd", () => {
  it("ConvexError met code EMAIL_BEING_DELETED en het genormaliseerde adres; geen uitnodiging", async () => {
    const t = newT();
    const w = await world(t);
    await t.run(async (ctx) => ctx.db.patch(w.users.bob!, { deletion: { startedAt: Date.now() } }));
    for (const email of [BOB, " Bob@X.test "]) {
      const data = await refusalData(() =>
        as(t, "user_olga").mutation(api.invites.create, { name: "Bob", email, groupId: w.groupId }),
      );
      expect(data).toEqual({ code: "EMAIL_BEING_DELETED", email: BOB });
    }
    expect((await allInvites(t)).filter((i) => i.email === BOB)).toEqual([]);
  });

  it("de volgorde blijft: een niet-admin krijgt NOT_ALLOWED, niet EMAIL_BEING_DELETED (geen orakel)", async () => {
    const t = newT();
    const w = await world(t);
    await t.run(async (ctx) => ctx.db.patch(w.users.bob!, { deletion: { startedAt: Date.now() } }));
    const data = await refusalData(() =>
      as(t, "user_lex").mutation(api.invites.create, { name: "Bob", email: BOB, groupId: w.groupId }),
    );
    expect(data).toMatchObject({ code: "NOT_ALLOWED" });
  });
});
