import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { asGhost, asUser, newT, seedWorld, useWebmasterEnv, type T } from "../readWhitelist/_world";

// WP20 A-invariant 3: "heb ik gestemd" voor de hele lijst in één query,
// features.listMyUpvotes: de ids van de features waarop de caller stemde.
// Alleen eigen stemmen. De vorm van features.list blijft (WP23).
// A-invariant 4 / invariant 6: twee stemmen tegelijk = één stem.
// Spec: docs/work-packages/WP20-melden.md §A-invarianten.

useWebmasterEnv();

const listMyUpvotes = makeFunctionReference<"query", Record<string, never>, Id<"features">[]>(
  "features:listMyUpvotes",
);

async function addFeature(t: T, submittedBy: Id<"users">, title: string) {
  return await t.run(async (ctx) =>
    ctx.db.insert("features", {
      type: "feature",
      title,
      description: "",
      submittedBy,
      status: "open",
      upvoteCount: 0,
      createdAt: Date.now(),
    }),
  );
}

describe("features.listMyUpvotes", () => {
  it("leeg zonder stemmen; daarna precies de features waarop ik stemde", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const f2 = await addFeature(t, w.users.carol.id, "Tweede");
    const f3 = await addFeature(t, w.users.carol.id, "Derde");
    const alice = asUser(t, w, "alice");

    expect(await alice.query(listMyUpvotes, {})).toEqual([]);
    await alice.mutation(api.features.upvote, { featureId: f2 });
    await alice.mutation(api.features.upvote, { featureId: w.features.fFeature });
    expect([...(await alice.query(listMyUpvotes, {}))].sort()).toEqual([f2, w.features.fFeature].sort());

    await alice.mutation(api.features.removeUpvote, { featureId: f2 });
    expect(await alice.query(listMyUpvotes, {})).toEqual([w.features.fFeature]);
    void f3;
  });

  it("de stemmen van een ander tellen niet mee", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "carol").mutation(api.features.upvote, { featureId: w.features.fFeature });
    expect(await asUser(t, w, "alice").query(listMyUpvotes, {})).toEqual([]);
    expect(await asUser(t, w, "carol").query(listMyUpvotes, {})).toEqual([w.features.fFeature]);
  });

  it("de response is alleen een lijst ids (geen user-ids, geen andere velden)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const carol = asUser(t, w, "carol");
    await carol.mutation(api.features.upvote, { featureId: w.features.fFeature });
    const result = await carol.query(listMyUpvotes, {});
    expect(Array.isArray(result)).toBe(true);
    for (const id of result) expect(typeof id).toBe("string");
    expect(JSON.stringify(result)).not.toContain(w.users.carol.id);
  });

  it("uitgelogd en identity zonder users-rij: fout, zoals features.list", async () => {
    const t = newT();
    await seedWorld(t);
    await expect(t.query(listMyUpvotes, {})).rejects.toThrow();
    await expect(asGhost(t).query(listMyUpvotes, {})).rejects.toThrow();
  });
});

describe("stemmen tegelijk (invariant 6)", () => {
  it("twee upvotes tegelijk door één lid: één stem, upvoteCount +1", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const f = await addFeature(t, w.users.carol.id, "Snel tikken");
    const alice = asUser(t, w, "alice");
    await Promise.all([
      alice.mutation(api.features.upvote, { featureId: f }),
      alice.mutation(api.features.upvote, { featureId: f }),
    ]);
    const rows = await t.run((ctx) =>
      ctx.db.query("featureUpvotes").collect(),
    ).then((all) => all.filter((r) => r.featureId === f));
    expect(rows).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(f)))?.upvoteCount).toBe(1);
  });

  it("upvoteCount is gelijk aan het aantal stemmen na stemmen en terugnemen door meerdere leden", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const f = await addFeature(t, w.users.carol.id, "Tellen");
    for (const key of ["alice", "bob", "carol", "dave"] as const) {
      await asUser(t, w, key).mutation(api.features.upvote, { featureId: f });
    }
    await Promise.all([
      asUser(t, w, "bob").mutation(api.features.removeUpvote, { featureId: f }),
      asUser(t, w, "bob").mutation(api.features.removeUpvote, { featureId: f }),
    ]);
    const rows = await t.run((ctx) =>
      ctx.db.query("featureUpvotes").collect(),
    ).then((all) => all.filter((r) => r.featureId === f));
    expect(rows).toHaveLength(3);
    expect((await t.run((ctx) => ctx.db.get(f)))?.upvoteCount).toBe(3);
  });
});
