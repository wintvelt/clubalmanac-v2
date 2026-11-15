import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  asUser,
  expectNoMutationOracle,
  newT,
  seedWorld,
  staleId,
  useWebmasterEnv,
  type T,
} from "./_helpers";

// WP20 A-invariant 8: photos.appeal op een foto van een ander geeft dezelfde
// uitkomst als op een onbekend id, met of zonder foto-toegang, en wijzigt
// niets. Nu onderscheidt hij "Foto bestaat niet" van "Alleen eigenaar".
// Wereld (readWhitelist/_world): pBob is gemeld (bezwaar afgewezen) en staat
// in A1 (G1: alice, bob). pBobPrivate staat in geen album.
// Spec: docs/work-packages/WP20-melden.md §A-invarianten.

useWebmasterEnv();

async function flagNow(t: T, photoId: Id<"photos">) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.patch(photoId, { flaggedAt: now, flaggedDeleteDate: now + 14 * 86_400_000 });
  });
}

describe("photos.appeal — geen bestaans-orakel", () => {
  it("lid met foto-toegang, gemelde foto van een ander, tegenover onbekend id", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "photos");
    // pAlice gemeld, zonder bezwaar: bob (zelfde groep) probeert bezwaar te maken.
    await flagNow(t, w.photos.pAlice);
    const bob = asUser(t, w, "bob");
    await expectNoMutationOracle(
      t,
      () => bob.mutation(api.photos.appeal, { photoId: missing }),
      () => bob.mutation(api.photos.appeal, { photoId: w.photos.pAlice }),
    );
  });

  it("zonder foto-toegang, gemelde en niet-gemelde foto, tegenover onbekend id", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "photos");
    await flagNow(t, w.photos.pBobPrivate);
    const carol = asUser(t, w, "carol");
    for (const photoId of [w.photos.pBobPrivate, w.photos.pAlice]) {
      await expectNoMutationOracle(
        t,
        () => carol.mutation(api.photos.appeal, { photoId: missing }),
        () => carol.mutation(api.photos.appeal, { photoId }),
      );
    }
  });

  it("de webmaster is hier geen eigenaar: zelfde uitkomst als onbekend id", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "photos");
    await flagNow(t, w.photos.pAlice);
    const wm = asUser(t, w, "wm");
    await expectNoMutationOracle(
      t,
      () => wm.mutation(api.photos.appeal, { photoId: missing }),
      () => wm.mutation(api.photos.appeal, { photoId: w.photos.pAlice }),
    );
  });

  it("controle: de eigenaar maakt bezwaar; de verwijderdatum is weg", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await flagNow(t, w.photos.pAlice);
    await asUser(t, w, "alice").mutation(api.photos.appeal, { photoId: w.photos.pAlice });
    const p = await t.run((ctx) => ctx.db.get(w.photos.pAlice));
    expect(p?.flaggedAppealDate).toBeTypeOf("number");
    expect(p?.flaggedDeleteDate).toBeUndefined();
  });
});
