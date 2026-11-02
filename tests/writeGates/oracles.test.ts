import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  as,
  asUser,
  expectNoMutationOracle,
  expectRejectedNoChange,
  newT,
  seedWorld,
  staleId,
  useWebmasterEnv,
  type T,
} from "./_helpers";
import { WEBMASTER_EMAIL } from "../readWhitelist/_world";

// WP24 invariant 3 (album-id in albums.markSeen, feature-id in
// features.upvote/removeUpvote) en invariant 4 (een probleem van een ander
// gedraagt zich als een onbekend id; upvoteCount verandert niet door een
// ander dan indiener of webmaster).

useWebmasterEnv();

async function upvoteCount(t: T, featureId: Id<"features">) {
  return await t.run(async (ctx) => (await ctx.db.get(featureId))?.upvoteCount);
}

describe("albums.markSeen — geen bestaans-orakel", () => {
  it("onbekend album tegenover album van een groep zonder lidmaatschap", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "albums");
    const carol = asUser(t, w, "carol");
    await expectNoMutationOracle(
      t,
      () => carol.mutation(api.albums.markSeen, { albumId: missing }),
      () => carol.mutation(api.albums.markSeen, { albumId: w.albums.A1 }),
    );
  });

  it("controle: lid markeert een album als gezien", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "bob").mutation(api.albums.markSeen, { albumId: w.albums.A1 });
    const rows = await t.run(async (ctx) => ctx.db.query("albumLastSeen").collect());
    expect(rows.map((r) => [r.userId, r.albumId])).toEqual([[w.users.bob.id, w.albums.A1]]);
  });
});

describe("features.upvote — verborgen probleem = onbekend id", () => {
  it("probleem van een ander tegenover onbekend id: identiek, upvoteCount ongewijzigd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "features");
    const carol = asUser(t, w, "carol");
    await expectNoMutationOracle(
      t,
      () => carol.mutation(api.features.upvote, { featureId: missing }),
      () => carol.mutation(api.features.upvote, { featureId: w.features.fBobProblem }),
    );
    expect(await upvoteCount(t, w.features.fBobProblem)).toBe(1);
  });

  it("identity met webmaster-email zonder users-rij: geweigerd, state ongewijzigd (invariant 5)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expectRejectedNoChange(t, () =>
      as(t, "user_wm_ghost", WEBMASTER_EMAIL).mutation(api.features.upvote, {
        featureId: w.features.fCarolProblem,
      }),
    );
  });

  it("controle: feature upvoten mag iedereen; eigen probleem en webmaster op elk probleem ook", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "carol").mutation(api.features.upvote, { featureId: w.features.fFeature });
    expect(await upvoteCount(t, w.features.fFeature)).toBe(2);
    await asUser(t, w, "bob").mutation(api.features.upvote, { featureId: w.features.fBobProblem });
    expect(await upvoteCount(t, w.features.fBobProblem)).toBe(2);
    // A-keuze 6: webmaster mag (zoals de draft).
    await asUser(t, w, "wm").mutation(api.features.upvote, { featureId: w.features.fCarolProblem });
    expect(await upvoteCount(t, w.features.fCarolProblem)).toBe(2);
  });
});

describe("features.removeUpvote — verborgen probleem = onbekend id", () => {
  it("probleem van een ander tegenover onbekend id: identiek", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "features");
    const carol = asUser(t, w, "carol");
    await expectNoMutationOracle(
      t,
      () => carol.mutation(api.features.removeUpvote, { featureId: missing }),
      () => carol.mutation(api.features.removeUpvote, { featureId: w.features.fBobProblem }),
    );
  });

  it("ook met een bestaande upvote-rij (legacy) blijven rij en upvoteCount staan", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("featureUpvotes", {
        featureId: w.features.fBobProblem,
        userId: w.users.carol.id,
        createdAt: Date.now(),
      });
    });
    const missing = await staleId(t, w, "features");
    const carol = asUser(t, w, "carol");
    await expectNoMutationOracle(
      t,
      () => carol.mutation(api.features.removeUpvote, { featureId: missing }),
      () => carol.mutation(api.features.removeUpvote, { featureId: w.features.fBobProblem }),
    );
    expect(await upvoteCount(t, w.features.fBobProblem)).toBe(1);
  });

  it("controle: indiener trekt de eigen upvote op het eigen probleem in", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bob = asUser(t, w, "bob");
    await bob.mutation(api.features.upvote, { featureId: w.features.fBobProblem });
    await bob.mutation(api.features.removeUpvote, { featureId: w.features.fBobProblem });
    expect(await upvoteCount(t, w.features.fBobProblem)).toBe(1);
  });
});
