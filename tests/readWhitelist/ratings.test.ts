import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  SHAPE,
  asGhost,
  asUser,
  expectNoOracle,
  expectShape,
  newT,
  seedWorld,
  staleId,
  useWebmasterEnv,
  type R,
} from "./_world";

// WP23 — ratings.listForPhoto. Spec A-keuze 1: alleen de eigen rating van de
// caller; het aggregaat staat in de foto-vorm. Auth = foto-toegang.

useWebmasterEnv();

describe("ratings.listForPhoto", () => {
  it("niet-ingelogd en identity zonder users-rij: throwt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expect(
      t.query(api.ratings.listForPhoto, { photoId: w.photos.pBob }),
    ).rejects.toThrow();
    await expect(
      asGhost(t).query(api.ratings.listForPhoto, { photoId: w.photos.pBob }),
    ).rejects.toThrow();
  });

  it("[A-keuze 1] alleen de eigen rating, in de rating-vorm — niet die van anderen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // pBob heeft ratings van alice (4) en bob (2).
    const aliceList = (await asUser(t, w, "alice").query(
      api.ratings.listForPhoto,
      { photoId: w.photos.pBob },
    )) as R[];
    expect(aliceList).toHaveLength(1);
    expectShape(aliceList[0], SHAPE.rating);
    expect(aliceList[0]).toEqual({ photoId: w.photos.pBob, value: 4 });
    expect(JSON.stringify(aliceList)).not.toContain(w.users.bob.id);

    const bobList = (await asUser(t, w, "bob").query(
      api.ratings.listForPhoto,
      { photoId: w.photos.pBob },
    )) as R[];
    expect(bobList).toEqual([{ photoId: w.photos.pBob, value: 2 }]);
  });

  it("toegang maar zelf niet geraten: lege lijst", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // dave ziet pAlice via G3; bob raatte pAlice, dave niet.
    const list = await asUser(t, w, "dave").query(api.ratings.listForPhoto, {
      photoId: w.photos.pAlice,
    });
    expect(list).toEqual([]);
  });

  it("geen foto-toegang: geen data, niet te onderscheiden van een onbekende foto", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const gone = await staleId(t, w, "photos");
    await expectNoOracle(
      () =>
        asUser(t, w, "carol").query(api.ratings.listForPhoto, {
          photoId: gone,
        }),
      () =>
        asUser(t, w, "carol").query(api.ratings.listForPhoto, {
          photoId: w.photos.pBob,
        }),
    );
  });
});
