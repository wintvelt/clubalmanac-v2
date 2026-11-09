import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, membership, newT, seedGroup, type T } from "../groups/_beheer";

// WP28 invariant 4 en A-invariant 4 (WP17a-red-team R3): wie uit een groep
// verdwijnt, haalt zichzelf niet terug met een uitnodiging. Drie wegen
// (spec kernvondst 4):
//   (a) een open uitnodiging aan zijn eigen adres voor die groep;
//   (b) een open uitnodiging die hij zelf verstuurde, naar een tweede adres;
//   (c) een uitnodiging voor een groep die niet meer bestaat.
// Voor `invites.accept` én voor de onboarding (`registerFromSession`).
// Een geweigerde uitnodiging maakt geen lidmaatschap; de fout zelf is vrij.
//
// Wereld: oprichter Olga, admin Anna, lid Lex (admin bij (b), zodat W6 er niet
// toe doet), buitenstaander Alt (tweede adres).

const DAY = 24 * 60 * 60 * 1000;

// `invites.create` en `accept` plannen een mail. Met nep-timers draait die
// geplande action niet na afloop van de test (zoals tests/invites/accept.test.ts).
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function seedInvite(
  t: T,
  args: { email: string; groupId: Id<"groups">; invitedBy: Id<"users"> },
): Promise<string> {
  const token = crypto.randomUUID();
  await t.run(async (ctx) =>
    ctx.db.insert("invites", {
      email: args.email,
      invitedBy: args.invitedBy,
      groupId: args.groupId,
      role: "member",
      token,
      status: "pending",
      expiresAt: Date.now() + 14 * DAY,
      createdAt: Date.now(),
    }),
  );
  return token;
}

async function tryAccept(t: T, subject: string, token: string): Promise<void> {
  try {
    await as(t, subject).mutation(api.invites.accept, { token });
  } catch {
    // De weigering zelf is vrij; wat telt is het lidmaatschap hieronder.
  }
}

async function membershipsOf(t: T, userId: Id<"users">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );
}

async function onboard(t: T, subject: string, email: string): Promise<Id<"users">> {
  return await t.mutation(internal.users.registerFromSession, { subject, email });
}

const REMOVALS = [
  ["verwijderd door een admin", "user_anna"],
  ["zelf vertrokken", "user_lex"],
] as const;

describe.each(REMOVALS)("(a) open uitnodiging aan het eigen adres, lid %s", (_label, actor) => {
  it("accepteren maakt hem geen lid meer", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga", members: { anna: "admin", lex: "member" } });
    const token = await seedInvite(t, { email: "lex@x.test", groupId: w.groupId, invitedBy: w.users.olga! });

    await as(t, actor).mutation(api.groups.removeMember, { groupId: w.groupId, userId: w.users.lex! });
    await tryAccept(t, "user_lex", token);

    expect(await membership(t, w.groupId, w.users.lex!)).toBeNull();
  });
});

describe("(a) open uitnodiging aan het eigen adres, account verwijderd", () => {
  it("een nieuw account met hetzelfde adres wordt bij de onboarding geen lid", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga", members: { anna: "admin", lex: "member" } });
    await seedInvite(t, { email: "lex@x.test", groupId: w.groupId, invitedBy: w.users.olga! });

    await as(t, "user_lex").mutation(api.users.deleteSelf, {});
    const again = await onboard(t, "user_lex_nieuw", "lex@x.test");

    expect(await membership(t, w.groupId, again)).toBeNull();
  });
});

describe.each(REMOVALS)("(b) uitnodiging die hij zelf verstuurde, lid %s", (_label, actor) => {
  it("het tweede adres wordt via accepteren geen lid", async () => {
    const t = newT();
    const w = await seedGroup(t, {
      founder: "olga",
      members: { anna: "admin", lex: "admin" },
      outsiders: ["alt"],
    });
    const { token } = await as(t, "user_lex").mutation(api.invites.create, {
      email: "alt@x.test",
      groupId: w.groupId,
    });

    await as(t, actor).mutation(api.groups.removeMember, { groupId: w.groupId, userId: w.users.lex! });
    await tryAccept(t, "user_alt", token);

    expect(await membership(t, w.groupId, w.users.alt!)).toBeNull();
  });

  it("het tweede adres wordt via de onboarding geen lid", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga", members: { anna: "admin", lex: "admin" } });
    await as(t, "user_lex").mutation(api.invites.create, { email: "nieuw@x.test", groupId: w.groupId });

    await as(t, actor).mutation(api.groups.removeMember, { groupId: w.groupId, userId: w.users.lex! });
    const nieuw = await onboard(t, "user_nieuw", "nieuw@x.test");

    expect(await membership(t, w.groupId, nieuw)).toBeNull();
  });
});

describe("(c) uitnodiging voor een groep die niet meer bestaat", () => {
  it("accepteren maakt geen lidmaatschap", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga", members: { anna: "admin" }, outsiders: ["carol"] });
    const token = await seedInvite(t, { email: "carol@x.test", groupId: w.groupId, invitedBy: w.users.anna! });

    await as(t, "user_olga").mutation(api.groups.remove, { groupId: w.groupId });
    await tryAccept(t, "user_carol", token);

    expect(await membershipsOf(t, w.users.carol!)).toEqual([]);
  });

  it("de onboarding maakt geen lidmaatschap", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga", members: { anna: "admin" } });
    await seedInvite(t, { email: "dirk@x.test", groupId: w.groupId, invitedBy: w.users.anna! });

    await as(t, "user_olga").mutation(api.groups.remove, { groupId: w.groupId });
    const dirk = await onboard(t, "user_dirk", "dirk@x.test");

    expect(await membershipsOf(t, dirk)).toEqual([]);
  });
});

describe("controle: een uitnodiging van een huidig lid werkt gewoon", () => {
  it("na verwijderen nodigt de oprichter hem opnieuw uit, en dan is hij weer lid", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga", members: { anna: "admin", lex: "member" } });
    await as(t, "user_anna").mutation(api.groups.removeMember, { groupId: w.groupId, userId: w.users.lex! });

    const { token } = await as(t, "user_olga").mutation(api.invites.create, {
      email: "lex@x.test",
      groupId: w.groupId,
    });
    await as(t, "user_lex").mutation(api.invites.accept, { token });

    expect((await membership(t, w.groupId, w.users.lex!))?.role).toBe("member");
  });

  it("de onboarding accepteert een uitnodiging van een huidig lid", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga", members: { anna: "admin" } });
    await as(t, "user_anna").mutation(api.invites.create, { email: "nieuw@x.test", groupId: w.groupId });

    const nieuw = await onboard(t, "user_nieuw", "nieuw@x.test");

    expect(await membership(t, w.groupId, nieuw)).not.toBeNull();
  });
});
