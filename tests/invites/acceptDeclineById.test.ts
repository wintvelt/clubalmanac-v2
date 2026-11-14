import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, expectRefused, goneGroupId, membership, newT, type T, type World } from "../groups/_beheer";
import { inviteRow, refusalData, seedInvite, world } from "./_wp19b";

// WP19b invariant 7, A-invariant 7: accepteren en afwijzen op het id uit
// `listReceived`, zonder token. Is het id nu geen accepteerbare uitnodiging
// voor het adres van de caller, dan één weigering: `INVITE_INVALID`, met
// verder niets in de data, en de state blijft gelijk. Zo verraadt hij niet of
// een id bestaat. Uitzondering: een eigen, al afgewezen uitnodiging nog eens
// afwijzen geeft geen fout. `accept` geeft `{ groupId }`.

const accept = api.invites.accept;
const decline = api.invites.decline;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const forBob = (t: T, w: World, extra: Partial<Parameters<typeof seedInvite>[1]> = {}) =>
  seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId, ...extra });

async function deletedInviteId(t: T, w: World): Promise<Id<"invites">> {
  const id = await forBob(t, w);
  await t.run(async (ctx) => ctx.db.delete(id));
  return id;
}

type Case = [string, (t: T, w: World) => Promise<Id<"invites">>];

const invalidForBob: Case[] = [
  ["van een ander adres", (t, w) => seedInvite(t, { email: "eve@x.test", invitedBy: w.users.olga!, groupId: w.groupId })],
  ["onbekend (gewist of ingetrokken)", (t, w) => deletedInviteId(t, w)],
  ["verlopen", (t, w) => forBob(t, w, { expiresAt: Date.now() })],
  ["status expired", (t, w) => forBob(t, w, { status: "expired" })],
  ["al geaccepteerd", (t, w) => forBob(t, w, { status: "accepted" })],
  ["afgewezen", (t, w) => forBob(t, w, { status: "declined" })],
  ["groep weg", async (t, w) => forBob(t, w, { groupId: await goneGroupId(t) })],
  ["uitnodiger geen admin", (t, w) => forBob(t, w, { invitedBy: w.users.lex! })],
  ["zonder groep", (t, w) => seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga! })],
];

describe("A-invariant 7 — accepteren", () => {
  it("een eigen, accepteerbare uitnodiging: { groupId }, lid met de rol, status accepted", async () => {
    const t = newT();
    const w = await world(t);
    const id = await forBob(t, w, { role: "admin" });
    const res = await as(t, "user_bob").mutation(accept, { inviteId: id });
    expect(res).toEqual({ groupId: w.groupId });
    expect((await membership(t, w.groupId, w.users.bob!))?.role).toBe("admin");
    expect((await inviteRow(t, id))?.status).toBe("accepted");
  });

  for (const [label, make] of invalidForBob) {
    it(`${label}: INVITE_INVALID, verder niets in de data, state ongewijzigd`, async () => {
      const t = newT();
      const w = await world(t);
      const id = await make(t, w);
      const data = await expectRefused(t, "INVITE_INVALID", () =>
        as(t, "user_bob").mutation(accept, { inviteId: id }),
      );
      expect(data).toEqual({ code: "INVITE_INVALID" });
    });
  }

  it("twee keer accepteren: de tweede weigert, één lidmaatschap", async () => {
    const t = newT();
    const w = await world(t);
    const id = await forBob(t, w);
    await as(t, "user_bob").mutation(accept, { inviteId: id });
    await expectRefused(t, "INVITE_INVALID", () => as(t, "user_bob").mutation(accept, { inviteId: id }));
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) => q.eq("userId", w.users.bob!).eq("groupId", w.groupId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
  });

  it("een ander die het id kent, kan niet accepteren (ook niet als hij lid wil worden)", async () => {
    const t = newT();
    const w = await world(t);
    const id = await forBob(t, w);
    await expectRefused(t, "INVITE_INVALID", () => as(t, "user_eve").mutation(accept, { inviteId: id }));
    expect(await membership(t, w.groupId, w.users.eve!)).toBeNull();
  });

  it("anoniem: geweigerd, niets verandert", async () => {
    const t = newT();
    const w = await world(t);
    const id = await forBob(t, w);
    await expect(t.mutation(accept, { inviteId: id })).rejects.toThrow();
    expect((await inviteRow(t, id))?.status).toBe("pending");
  });

  it("alle weigeringen zijn gelijk: een onbekend id en andermans id geven dezelfde data", async () => {
    const t = newT();
    const w = await world(t);
    const other = await seedInvite(t, { email: "eve@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    const gone = await deletedInviteId(t, w);
    const a = await refusalData(() => as(t, "user_bob").mutation(accept, { inviteId: other }));
    const b = await refusalData(() => as(t, "user_bob").mutation(accept, { inviteId: gone }));
    expect(a).toEqual(b);
  });
});

describe("A-invariant 7 — afwijzen", () => {
  it("een eigen, accepteerbare uitnodiging: status declined, geen lidmaatschap", async () => {
    const t = newT();
    const w = await world(t);
    const id = await forBob(t, w);
    expect(await as(t, "user_bob").mutation(decline, { inviteId: id })).toBeNull();
    expect((await inviteRow(t, id))?.status).toBe("declined");
    expect(await membership(t, w.groupId, w.users.bob!)).toBeNull();
  });

  it("een eigen, al afgewezen uitnodiging nog eens afwijzen: geen fout, niets verandert", async () => {
    const t = newT();
    const w = await world(t);
    const id = await forBob(t, w);
    await as(t, "user_bob").mutation(decline, { inviteId: id });
    const before = await inviteRow(t, id);
    await as(t, "user_bob").mutation(decline, { inviteId: id });
    expect(await inviteRow(t, id)).toEqual(before);
  });

  it("andermans al afgewezen uitnodiging: INVITE_INVALID (geen bestaans-orakel)", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, {
      email: "eve@x.test",
      invitedBy: w.users.olga!,
      groupId: w.groupId,
      status: "declined",
    });
    await expectRefused(t, "INVITE_INVALID", () => as(t, "user_bob").mutation(decline, { inviteId: id }));
  });

  const invalidDecline = invalidForBob.filter(([label]) => label !== "afgewezen");
  for (const [label, make] of invalidDecline) {
    it(`${label}: INVITE_INVALID, state ongewijzigd`, async () => {
      const t = newT();
      const w = await world(t);
      const id = await make(t, w);
      const data = await expectRefused(t, "INVITE_INVALID", () =>
        as(t, "user_bob").mutation(decline, { inviteId: id }),
      );
      expect(data).toEqual({ code: "INVITE_INVALID" });
    });
  }
});
