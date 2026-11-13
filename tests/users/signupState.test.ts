import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { goneGroupId, newT, type T } from "../groups/_beheer";
import { ISSUER } from "../_helpers/auth";
import { seedInvite, world } from "../invites/_wp19b";

// WP19b A-invariant 3: de app weet waarom er geen account is. Een read voor de
// ingelogde caller zegt "account" (er is een users-rij, ook als het account
// wordt verwijderd), "waiting" (geen rij, wel een accepteerbare uitnodiging:
// de onboarding komt nog) of "noInvite" (geen rij en geen accepteerbare
// uitnodiging). Hij kijkt alleen naar het eigen geverifieerde adres uit de
// sessie (de email-claim, WP4) en zegt niets over andere adressen. Anoniem:
// `null`.

const signupState = api.users.signupState;
const NEW = "nieuw@x.test";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function session(t: T, subject: string, email?: string) {
  return t.withIdentity({
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    ...(email !== undefined ? { email } : {}),
  });
}

describe("A-invariant 3 — signupState", () => {
  it("anoniem: null", async () => {
    const t = newT();
    await world(t);
    expect(await t.query(signupState, {})).toBeNull();
  });

  it("met een users-rij: account", async () => {
    const t = newT();
    await world(t);
    expect(await session(t, "user_bob", "bob@x.test").query(signupState, {})).toBe("account");
  });

  it("een account dat wordt verwijderd: account (de app kent dat geval al)", async () => {
    const t = newT();
    const w = await world(t);
    await t.run(async (ctx) => ctx.db.patch(w.users.bob!, { deletion: { startedAt: Date.now() } }));
    expect(await session(t, "user_bob", "bob@x.test").query(signupState, {})).toBe("account");
  });

  it("geen rij, wel een accepteerbare uitnodiging voor het eigen adres: waiting", async () => {
    const t = newT();
    const w = await world(t);
    await seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId });
    expect(await session(t, "user_nieuw", NEW).query(signupState, {})).toBe("waiting");
  });

  it("het adres uit de sessie telt hoofdletter-ongevoelig", async () => {
    const t = newT();
    const w = await world(t);
    await seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId });
    expect(await session(t, "user_nieuw", "Nieuw@X.TEST").query(signupState, {})).toBe("waiting");
  });

  it("geen rij en geen uitnodiging: noInvite", async () => {
    const t = newT();
    await world(t);
    expect(await session(t, "user_nieuw", NEW).query(signupState, {})).toBe("noInvite");
  });

  it("geen rij en geen email-claim: noInvite", async () => {
    const t = newT();
    await world(t);
    expect(await session(t, "user_nieuw").query(signupState, {})).toBe("noInvite");
  });

  it("alleen een uitnodiging aan een ander adres: noInvite (geen orakel over andere adressen)", async () => {
    const t = newT();
    const w = await world(t);
    await seedInvite(t, { email: "ander@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    expect(await session(t, "user_nieuw", NEW).query(signupState, {})).toBe("noInvite");
  });

  const notAcceptable: Array<[string, (t: T, w: Awaited<ReturnType<typeof world>>) => Promise<unknown>]> = [
    ["verlopen", (t, w) => seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId, expiresAt: Date.now() })],
    ["afgewezen", (t, w) => seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId, status: "declined" })],
    ["groep weg", async (t, w) => seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: await goneGroupId(t) })],
    ["uitnodiger geen admin", (t, w) => seedInvite(t, { email: NEW, invitedBy: w.users.lex!, groupId: w.groupId })],
    ["zonder groep", (t, w) => seedInvite(t, { email: NEW, invitedBy: w.users.olga! })],
  ];
  for (const [label, seed] of notAcceptable) {
    it(`alleen een niet-accepteerbare uitnodiging (${label}): noInvite`, async () => {
      const t = newT();
      const w = await world(t);
      await seed(t, w);
      expect(await session(t, "user_nieuw", NEW).query(signupState, {})).toBe("noInvite");
    });
  }
});
