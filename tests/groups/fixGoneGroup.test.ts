import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, newT, seedAlbum, seedGroup, type T } from "./_beheer";
import { deleteAccount } from "../_helpers/deleteAccount";

// WP28 fix-cyclus 1, A-invariant 8 (audit S1): na een gewiste groep wijst
// niets er nog naar. Geen uitnodiging met die groupId, ongeacht de status, en
// de integriteitscheck (WP10, MONITORED_FKS) is schoon. Voor groups.remove en
// voor het laatste lid dat weggaat (M2-e, via accountverwijdering).
//
// De wereld heeft geen foto's: de scan herrekent ook tellers, en die laten we
// hier buiten beeld.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const DAY = 24 * 60 * 60 * 1000;
const STATUSES = ["pending", "accepted", "declined", "expired"] as const;

async function seedInvites(t: T, groupId: Id<"groups">, invitedBy: Id<"users">) {
  await t.run(async (ctx) => {
    for (const status of STATUSES) {
      await ctx.db.insert("invites", {
        email: `${status}@x.test`,
        invitedBy,
        groupId,
        role: "member",
        token: crypto.randomUUID(),
        status,
        expiresAt: Date.now() + (status === "expired" ? -DAY : 14 * DAY),
        createdAt: Date.now(),
      });
    }
  });
}

async function invitesFor(t: T, groupId: Id<"groups">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("invites").collect()).filter((i) => i.groupId === groupId),
  );
}

describe("A-invariant 8 — groups.remove", () => {
  it("geen uitnodiging met die groupId meer, welke status ook", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga", members: { anna: "admin" } });
    await seedInvites(t, w.groupId, w.users.anna!);

    await as(t, "user_olga").mutation(api.groups.remove, { groupId: w.groupId });

    expect(await invitesFor(t, w.groupId)).toEqual([]);
  });

  it("de integriteitscheck is daarna schoon", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga", members: { anna: "admin", lex: "member" } });
    await seedAlbum(t, w.groupId, w.users.olga!, "A");
    await seedInvites(t, w.groupId, w.users.anna!);
    expect(await t.query(internal.migration.integrityReport, {})).toEqual([]);

    await as(t, "user_olga").mutation(api.groups.remove, { groupId: w.groupId });

    expect(await t.query(internal.migration.integrityReport, {})).toEqual([]);
  });

  it("uitnodigingen voor een andere groep blijven", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga" });
    const other = await seedGroup(t, { founder: "otto" });
    await seedInvites(t, other.groupId, other.users.otto!);

    await as(t, "user_olga").mutation(api.groups.remove, { groupId: w.groupId });

    expect(await invitesFor(t, other.groupId)).toHaveLength(STATUSES.length);
  });
});

describe("A-invariant 8 — het laatste lid gaat weg (M2-e)", () => {
  it("geen uitnodiging met die groupId meer, en de integriteitscheck is schoon", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga", outsiders: ["anna"] });
    await seedAlbum(t, w.groupId, w.users.olga!, "A");
    // Uitnodigingen van een ander die eerder admin was en al vertrok
    // (Anna bestaat nog, zodat invitedBy niets meldt).
    await seedInvites(t, w.groupId, w.users.anna!);

    await deleteAccount(t, as(t, "user_olga"));

    expect(await invitesFor(t, w.groupId)).toEqual([]);
    expect(await t.query(internal.migration.integrityReport, {})).toEqual([]);
  });
});
