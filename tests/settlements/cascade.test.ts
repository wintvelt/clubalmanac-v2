import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { deleteAccount } from "../_helpers/deleteAccount";
import { as, configure, newT, postOk, request, rows, seedWorld, settlementsApi, useFinanceEnv, type T } from "./_settlements";

// WP41 invariant 9 en §A9 — cascade-matrix G6: groep weg → haar afrekeningen
// weg. Via groups.remove (G3/G6) en via het laatste lid dat zijn account
// verwijdert (M2-e). Afrekeningen van een andere groep blijven. Een lid dat
// weggaat of zijn account verwijdert (niet het laatste) raakt niets: er is geen
// koppeling tussen een gebruiker en een deelnemer (besluit 3).

useFinanceEnv();

async function world(t: T) {
  const w = await seedWorld(t);
  await postOk(t, request("lustrum"));
  await postOk(t, request("weekend"));
  configure(w.groups.other);
  await postOk(t, { ...request("weekend"), name: "Weekend Ander" });
  configure(w.groups.club);
  return w;
}

describe("G6: groep verwijderen → haar afrekeningen weg", () => {
  it("groups.remove: geen afrekening meer met die groupId; de andere groep houdt de hare", async () => {
    const t = newT();
    const w = await world(t);
    await as.bob(t).mutation(api.groups.remove, { groupId: w.groups.club });
    const all = await rows(t);
    expect(all.filter((r) => r.groupId === w.groups.club)).toEqual([]);
    expect(all.filter((r) => r.groupId === w.groups.other).map((r) => r.name)).toEqual(["Weekend Ander"]);
  });
});

describe("M2-e: het laatste lid gaat weg → de groep en haar afrekeningen weg", () => {
  it("dave (enig lid van Ander) verwijdert zijn account; De Heeren houdt de twee", async () => {
    const t = newT();
    const w = await world(t);
    await deleteAccount(t, as.dave(t));
    expect(await t.run((ctx) => ctx.db.get(w.groups.other))).toBeNull();
    const all = await rows(t);
    expect(all.filter((r) => r.groupId === w.groups.other)).toEqual([]);
    expect(all.filter((r) => r.groupId === w.groups.club)).toHaveLength(2);
    expect(await as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club })).toHaveLength(2);
  });
});

describe("§A9: een gebruiker die weggaat raakt de afrekeningen niet", () => {
  it("alice verlaat de groep: de afrekeningen blijven, bob leest ze nog", async () => {
    const t = newT();
    const w = await world(t);
    await as.alice(t).mutation(api.groups.removeMember, { groupId: w.groups.club, userId: w.users.alice });
    expect(await as.bob(t).query(settlementsApi.listByGroup, { groupId: w.groups.club })).toHaveLength(2);
  });

  it("alice verwijdert haar account (niet het laatste lid): de afrekeningen blijven", async () => {
    const t = newT();
    const w = await world(t);
    await deleteAccount(t, as.alice(t));
    expect(await as.bob(t).query(settlementsApi.listByGroup, { groupId: w.groups.club })).toHaveLength(2);
    expect(await rows(t)).toHaveLength(3);
  });
});
