import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { asUser, newT, seedWorld, useWebmasterEnv, type T } from "../readWhitelist/_world";

// WP20 besluit 6, S2 (fix-cyclus 1): listMyFlagged en listAllFlagged lezen
// alleen gemelde foto's, niet meer alle foto's. Gedrag gelijk. Hoeveel rijen
// een query leest, ziet convex-test niet; dat deel is een eis in de spec die de
// audit in de code toetst. Hier: het gedrag blijft, ook met veel niet-gemelde
// foto's, gemigreerde meldingen (middernacht UTC, jaren terug, zonder
// verwijderdatum) en elke fase.
// Wereld: pBob (bob) gemeld, bezwaar afgewezen. Verder niets gemeld.
// Spec: docs/work-packages/WP20-melden.md §Besluiten na de audit, §Fix-cyclus 1 (A).

useWebmasterEnv();

const DAY = 24 * 60 * 60 * 1000;

async function addPhotos(t: T, ownerId: Id<"users">, n: number) {
  return await t.run(async (ctx) => {
    const ids: Id<"photos">[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(
        await ctx.db.insert("photos", {
          ownerId,
          storageId: await ctx.storage.store(new Blob([`x${i}`])),
          createdAt: Date.now() - i * DAY,
        }),
      );
    }
    return ids;
  });
}

const ids = (rows: { _id: string }[]) => rows.map((r) => r._id).sort();

describe("S2 — gedrag gelijk", () => {
  it("eigenaar: precies zijn gemelde foto's, in elke fase, ook gemigreerd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bobPlain = await addPhotos(t, w.users.bob.id, 40);
    const migrated = Date.UTC(2022, 4, 3); // middernacht UTC, dag-niveau (WP12)
    await t.run(async (ctx) => {
      await ctx.db.patch(bobPlain[3]!, { flaggedAt: migrated }); // gemigreerd, geen verwijderdatum
      await ctx.db.patch(bobPlain[7]!, { flaggedAt: Date.now() - DAY, flaggedDeleteDate: Date.now() + 13 * DAY });
      await ctx.db.patch(bobPlain[9]!, { flaggedAt: Date.now() - 3 * DAY, flaggedAppealDate: Date.now() - DAY });
    });
    const mine = await asUser(t, w, "bob").query(api.photos.listMyFlagged, {});
    expect(ids(mine)).toEqual([w.photos.pBob, bobPlain[3]!, bobPlain[7]!, bobPlain[9]!].sort());
    expect(mine.find((p) => p._id === bobPlain[3])?.flaggedAt).toBe(migrated);
  });

  it("eigenaar: gemelde foto's van een ander nooit; zonder meldingen een lege lijst", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const alicePlain = await addPhotos(t, w.users.alice.id, 20);
    expect(await asUser(t, w, "alice").query(api.photos.listMyFlagged, {})).toEqual([]);
    await t.run(async (ctx) => {
      await ctx.db.patch(alicePlain[0]!, { flaggedAt: Date.now() });
    });
    expect(ids(await asUser(t, w, "alice").query(api.photos.listMyFlagged, {}))).toEqual([alicePlain[0]!]);
    expect(ids(await asUser(t, w, "carol").query(api.photos.listMyFlagged, {}))).toEqual([]);
  });

  it("webmaster: alle gemelde foto's van alle eigenaren, verder niets", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const a = await addPhotos(t, w.users.alice.id, 25);
    const c = await addPhotos(t, w.users.carol.id, 25);
    const migrated = Date.UTC(2021, 0, 1);
    await t.run(async (ctx) => {
      await ctx.db.patch(a[2]!, { flaggedAt: migrated });
      await ctx.db.patch(c[11]!, { flaggedAt: Date.now(), flaggedDeleteDate: Date.now() + 14 * DAY });
    });
    const all = await asUser(t, w, "wm").query(api.photos.listAllFlagged, {});
    expect(ids(all)).toEqual([w.photos.pBob, a[2]!, c[11]!].sort());
  });

  it("na goedkeuren valt de foto uit beide lijsten", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "wm").mutation(api.photos.decideFlag, { photoId: w.photos.pBob, approve: true });
    expect(await asUser(t, w, "bob").query(api.photos.listMyFlagged, {})).toEqual([]);
    expect(await asUser(t, w, "wm").query(api.photos.listAllFlagged, {})).toEqual([]);
  });
});
