import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, membership, newT, seedGroup, type T } from "../groups/_beheer";

// WP28 fix-cyclus 1, A-invariant 10 (red-team R3, audit N3): open
// uitnodigingen van wie zijn recht verliest, vervallen. Een admin die lid
// wordt gemaakt, verwijderd wordt, vertrekt of zijn account verwijdert, heeft
// daarna geen open uitnodiging meer voor die groep. Komt hij terug als admin,
// dan werkt de oude uitnodiging niet: niet via accepteren, niet via de
// onboarding. Zijn uitnodigingen voor andere groepen blijven. "Vervallen" mag
// verwijderd of status expired zijn (A-keuze 2).
//
// A-invariant 13 (audit N5): de opruiming bij vertrek vindt uitnodigingen aan
// zijn adres ook als het adres in de users-rij niet genormaliseerd is.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function world(t: T) {
  const w = await seedGroup(t, {
    founder: "olga",
    members: { rex: "admin" },
    outsiders: ["alt"],
  });
  const { token } = await as(t, "user_rex").mutation(api.invites.create, {
    email: "alt-tweede@x.test",
    groupId: w.groupId,
    role: "admin",
  });
  return { ...w, token };
}

async function openInvitesBy(t: T, userId: Id<"users">, groupId: Id<"groups">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("invites").collect()).filter(
      (i) => i.invitedBy === userId && i.groupId === groupId && i.status === "pending",
    ),
  );
}

/** Olga haalt Rex terug als admin, met een nieuwe uitnodiging die hij accepteert. */
async function bringBackAsAdmin(t: T, w: Awaited<ReturnType<typeof world>>) {
  const re = await as(t, "user_olga").mutation(api.invites.create, {
    email: "rex@x.test",
    groupId: w.groupId,
    role: "admin",
  });
  await as(t, "user_rex").mutation(api.invites.accept, { token: re.token });
  expect((await membership(t, w.groupId, w.users.rex!))?.role).toBe("admin");
}

async function tryAccept(t: T, subject: string, token: string) {
  try {
    await as(t, subject).mutation(api.invites.accept, { token });
  } catch {
    // de fout zelf is vrij
  }
}

const LOSSES = [
  [
    "lid gemaakt",
    (t: T, w: Awaited<ReturnType<typeof world>>) =>
      as(t, "user_olga").mutation(api.groups.updateMemberRole, {
        groupId: w.groupId,
        userId: w.users.rex!,
        role: "member",
      }),
  ],
  [
    "verwijderd",
    (t: T, w: Awaited<ReturnType<typeof world>>) =>
      as(t, "user_olga").mutation(api.groups.removeMember, { groupId: w.groupId, userId: w.users.rex! }),
  ],
  [
    "zelf vertrokken",
    (t: T, w: Awaited<ReturnType<typeof world>>) =>
      as(t, "user_rex").mutation(api.groups.removeMember, { groupId: w.groupId, userId: w.users.rex! }),
  ],
] as const;

describe.each(LOSSES)("A-invariant 10: admin Rex wordt %s", (_label, lose) => {
  it("daarna heeft hij geen open uitnodiging meer voor die groep", async () => {
    const t = newT();
    const w = await world(t);
    await lose(t, w);
    expect(await openInvitesBy(t, w.users.rex!, w.groupId)).toEqual([]);
  });

  it("weer admin: zijn oude uitnodiging werkt niet via accepteren", async () => {
    const t = newT();
    const w = await world(t);
    await lose(t, w);
    if ((await membership(t, w.groupId, w.users.rex!)) === null) await bringBackAsAdmin(t, w);
    else
      await as(t, "user_olga").mutation(api.groups.updateMemberRole, {
        groupId: w.groupId,
        userId: w.users.rex!,
        role: "admin",
      });
    // Alt is het tweede adres van Rex.
    await t.run(async (ctx) => ctx.db.patch(w.users.alt!, { email: "alt-tweede@x.test" }));

    await tryAccept(t, "user_alt", w.token);

    expect(await membership(t, w.groupId, w.users.alt!)).toBeNull();
  });

  it("weer admin: zijn oude uitnodiging werkt niet via de onboarding", async () => {
    const t = newT();
    const w = await world(t);
    await lose(t, w);
    if ((await membership(t, w.groupId, w.users.rex!)) === null) await bringBackAsAdmin(t, w);
    else
      await as(t, "user_olga").mutation(api.groups.updateMemberRole, {
        groupId: w.groupId,
        userId: w.users.rex!,
        role: "admin",
      });

    const nieuw = await t.mutation(internal.users.registerFromSession, {
      subject: "user_tweede",
      email: "alt-tweede@x.test",
    });

    expect(await membership(t, w.groupId, nieuw)).toBeNull();
  });
});

describe("A-invariant 10: account verwijderd", () => {
  it("de onboarding van het tweede adres geeft geen lidmaatschap", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_rex").mutation(api.users.deleteSelf, {});
    const nieuw = await t.mutation(internal.users.registerFromSession, {
      subject: "user_tweede",
      email: "alt-tweede@x.test",
    });
    expect(await membership(t, w.groupId, nieuw)).toBeNull();
    expect(await openInvitesBy(t, w.users.rex!, w.groupId)).toEqual([]);
  });
});

describe("A-invariant 10: alleen de groep waar hij zijn recht verliest", () => {
  it("zijn open uitnodiging voor een andere groep, waar hij admin blijft, blijft open", async () => {
    const t = newT();
    const w = await world(t);
    const other = await seedGroup(t, { founder: "otto" });
    await t.run(async (ctx) =>
      ctx.db.insert("memberships", {
        userId: w.users.rex!,
        groupId: other.groupId,
        role: "admin",
        joinedAt: Date.now(),
      }),
    );
    await as(t, "user_rex").mutation(api.invites.create, { email: "ander@x.test", groupId: other.groupId });

    await as(t, "user_olga").mutation(api.groups.removeMember, { groupId: w.groupId, userId: w.users.rex! });

    expect(await openInvitesBy(t, w.users.rex!, other.groupId)).toHaveLength(1);
  });
});

describe("A-invariant 13 (N5): uitnodigingen aan een niet-genormaliseerd adres", () => {
  it("na verwijderen staat er geen open uitnodiging meer aan zijn adres voor die groep", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga", members: { lex: "member" } });
    // Een gemigreerd adres met hoofdletters en een spatie in de users-rij.
    await t.run(async (ctx) => ctx.db.patch(w.users.lex!, { email: " Lex@X.test" }));
    await t.run(async (ctx) =>
      ctx.db.insert("invites", {
        email: "lex@x.test",
        invitedBy: w.users.olga!,
        groupId: w.groupId,
        role: "member",
        token: crypto.randomUUID(),
        status: "pending",
        expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
      }),
    );

    await as(t, "user_olga").mutation(api.groups.removeMember, { groupId: w.groupId, userId: w.users.lex! });

    const open = await t.run(async (ctx) =>
      (await ctx.db.query("invites").collect()).filter(
        (i) => i.email === "lex@x.test" && i.groupId === w.groupId && i.status === "pending",
      ),
    );
    expect(open).toEqual([]);
  });
});
