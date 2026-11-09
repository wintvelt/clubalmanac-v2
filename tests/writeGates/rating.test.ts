import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  asGhost,
  asUser,
  expectNoMutationOracle,
  expectRejectedNoChange,
  newT,
  seedWorld,
  staleId,
  useWebmasterEnv,
  type T,
  type World,
} from "./_helpers";

// WP24 invariant 2: ratings.upsert vereist foto-toegang. Open vraag 3: de
// eigenaar mag de eigen foto beoordelen, ook als die in geen album staat.

useWebmasterEnv();

async function ratingOf(t: T, photoId: Id<"photos">, userId: Id<"users">) {
  const all = await t.run(async (ctx) => ctx.db.query("ratings").collect());
  return all.find((r) => r.photoId === photoId && r.userId === userId) ?? null;
}

function rate(t: T, w: World, who: "alice" | "bob" | "carol" | "dave" | "wm", photoId: Id<"photos">, value = 4) {
  return asUser(t, w, who).mutation(api.ratings.upsert, { photoId, value });
}

describe("ratings.upsert — write-gate", () => {
  it("niet ingelogd en identity zonder users-rij: geweigerd, state ongewijzigd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const args = { photoId: w.photos.pAlice, value: 4 };
    await expectRejectedNoChange(t, () => t.mutation(api.ratings.upsert, args), "anoniem");
    await expectRejectedNoChange(t, () => asGhost(t).mutation(api.ratings.upsert, args), "ghost");
  });

  it("ingelogd zonder foto-toegang: geweigerd, geen rating en geen aggregaat-wijziging", async () => {
    const t = newT();
    const w = await seedWorld(t);
    for (const photoId of [w.photos.pAlice, w.photos.pBob, w.photos.pBobPrivate]) {
      await expectRejectedNoChange(t, () => rate(t, w, "carol", photoId), `rate ${photoId}`);
    }
  });

  it("webmaster zonder lidmaatschap: geen bypass", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expectRejectedNoChange(t, () => rate(t, w, "wm", w.photos.pAlice));
  });

  it("lid vertrekt: een bestaande rating is daarna niet meer te wijzigen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // Seed: bob gaf pAlice een 5. Sinds WP28 fix-cyclus 1 (A-invariant 7)
    // gaat die rating weg bij zijn vertrek, en hij kan geen nieuwe zetten.
    await asUser(t, w, "bob").mutation(api.groups.removeMember, {
      groupId: w.groups.G1,
      userId: w.users.bob.id,
    });
    expect(await ratingOf(t, w.photos.pAlice, w.users.bob.id)).toBeFalsy();
    await expectRejectedNoChange(t, () => rate(t, w, "bob", w.photos.pAlice, 1));
    expect(await ratingOf(t, w.photos.pAlice, w.users.bob.id)).toBeFalsy();
  });

  it("lid met toegang via één van twee groepen beoordeelt; aggregaat volgt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await rate(t, w, "dave", w.photos.pAlice, 3);
    expect((await ratingOf(t, w.photos.pAlice, w.users.dave.id))?.value).toBe(3);
    const p = await t.run(async (ctx) => ctx.db.get(w.photos.pAlice));
    // Seed-ratings op pAlice: bob 5. Plus dave 3.
    expect(p?.ratingCount).toBe(2);
    expect(p?.ratingAverage).toBe(4);
  });

  it("vraag 3 — eigenaar beoordeelt de eigen foto, ook als die in geen album staat", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await rate(t, w, "bob", w.photos.pBobPrivate, 2);
    expect((await ratingOf(t, w.photos.pBobPrivate, w.users.bob.id))?.value).toBe(2);
    await rate(t, w, "alice", w.photos.pAlice, 5);
    expect((await ratingOf(t, w.photos.pAlice, w.users.alice.id))?.value).toBe(5);
  });
});

describe("ratings.upsert — geen bestaans-orakel (invariant 3)", () => {
  it("onbekend id tegenover bestaand id zonder toegang", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "photos");
    for (const photoId of [w.photos.pAlice, w.photos.pBobPrivate]) {
      await expectNoMutationOracle(
        t,
        () => rate(t, w, "carol", missing),
        () => rate(t, w, "carol", photoId),
      );
    }
  });
});
