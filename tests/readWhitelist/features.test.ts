import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  SHAPE,
  asGhost,
  asUser,
  expectNoOracle,
  expectNoUserSecrets,
  expectShape,
  newT,
  seedWorld,
  staleId,
  useWebmasterEnv,
  type R,
} from "./_world";

// WP23 — features-reads. Spec A-keuze 5: een `problem` is alleen zichtbaar
// voor de indiener en de webmaster; `submittedBy` zit niet in de vorm.
// Auth = ingelogd. `hasUpvoted` ongewijzigd.

useWebmasterEnv();

describe("features.list", () => {
  it("niet-ingelogd en identity zonder users-rij: throwt", async () => {
    const t = newT();
    await seedWorld(t);
    await expect(t.query(api.features.list, {})).rejects.toThrow();
    await expect(asGhost(t).query(api.features.list, {})).rejects.toThrow();
  });

  it("gewone user: alle features + alleen eigen problemen, in de feature-vorm (geen submittedBy)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bobList = (await asUser(t, w, "bob").query(
      api.features.list,
      {},
    )) as R[];
    expect(bobList.map((f) => f._id).sort()).toEqual(
      [w.features.fFeature, w.features.fBobProblem].sort(),
    );
    for (const f of bobList) expectShape(f, SHAPE.feature);
    expectNoUserSecrets(bobList, w);

    const aliceList = (await asUser(t, w, "alice").query(
      api.features.list,
      {},
    )) as R[];
    expect(aliceList.map((f) => f._id)).toEqual([w.features.fFeature]);
  });

  it("filter type=problem voor een gewone user: alleen eigen problemen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expect(
      await asUser(t, w, "alice").query(api.features.list, { type: "problem" }),
    ).toEqual([]);
    const bob = (await asUser(t, w, "bob").query(api.features.list, {
      type: "problem",
    })) as R[];
    expect(bob.map((f) => f._id)).toEqual([w.features.fBobProblem]);
  });

  it("filter op status houdt dezelfde zichtbaarheid aan", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const list = (await asUser(t, w, "alice").query(api.features.list, {
      status: "open",
    })) as R[];
    expect(list.map((f) => f._id)).toEqual([w.features.fFeature]);
  });

  it("webmaster: alles, ook problemen van anderen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const list = (await asUser(t, w, "wm").query(
      api.features.list,
      {},
    )) as R[];
    expect(list.map((f) => f._id).sort()).toEqual(
      [
        w.features.fFeature,
        w.features.fBobProblem,
        w.features.fCarolProblem,
      ].sort(),
    );
    for (const f of list) expectShape(f, SHAPE.feature);
  });
});

describe("features.getById", () => {
  it("niet-ingelogd: throwt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expect(
      t.query(api.features.getById, { featureId: w.features.fFeature }),
    ).rejects.toThrow();
  });

  it("feature: precies de feature-vorm", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const f = await asUser(t, w, "carol").query(api.features.getById, {
      featureId: w.features.fFeature,
    });
    expectShape(f, SHAPE.feature);
    expectNoUserSecrets(f, w);
  });

  it("probleem van een ander: niet te onderscheiden van een onbekend id", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const gone = await staleId(t, w, "features");
    await expectNoOracle(
      () => asUser(t, w, "bob").query(api.features.getById, { featureId: gone }),
      () =>
        asUser(t, w, "bob").query(api.features.getById, {
          featureId: w.features.fCarolProblem,
        }),
    );
  });

  it("eigen probleem en webmaster: zichtbaar", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expectShape(
      await asUser(t, w, "carol").query(api.features.getById, {
        featureId: w.features.fCarolProblem,
      }),
      SHAPE.feature,
    );
    expectShape(
      await asUser(t, w, "wm").query(api.features.getById, {
        featureId: w.features.fCarolProblem,
      }),
      SHAPE.feature,
    );
  });
});

describe("features.hasUpvoted — ongewijzigd", () => {
  it("false zonder identity", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expect(
      await t.query(api.features.hasUpvoted, {
        featureId: w.features.fFeature,
      }),
    ).toBe(false);
  });
});
