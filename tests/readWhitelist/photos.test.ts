import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  SHAPE,
  asGhost,
  asUser,
  expectNoData,
  expectNoOracle,
  expectNoUserSecrets,
  expectShape,
  newT,
  outcome,
  seedWorld,
  staleId,
  useWebmasterEnv,
  type R,
} from "./_world";

// WP23 — photos-reads. Spec §Vormen (foto, eigen/alle flag-velden, publiek
// profiel), invarianten 3-5 + 9, A-keuzes 2-4. Foto-toegang = eigenaar, of
// lid van een groep waarin de foto in een album staat.

useWebmasterEnv();

describe("photos.getById — foto-toegang", () => {
  it("niet-ingelogd en identity zonder users-rij: throwt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expect(
      t.query(api.photos.getById, { photoId: w.photos.pAlice }),
    ).rejects.toThrow();
    await expect(
      asGhost(t).query(api.photos.getById, { photoId: w.photos.pAlice }),
    ).rejects.toThrow();
  });

  it("lid van de groep: precies de foto-vorm (geen GPS, filename, mimeType of flag-velden)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const p = (await asUser(t, w, "alice").query(api.photos.getById, {
      photoId: w.photos.pBob,
    })) as R;
    expectShape(p, SHAPE.photo);
    expect(p._id).toBe(w.photos.pBob);
    expect(p.ownerId).toBe(w.users.bob.id);
    expect(p.locationLabel).toBe("Amsterdam");
  });

  it("eigenaar ziet eigen foto die in geen album staat; een ander niet", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const own = await asUser(t, w, "bob").query(api.photos.getById, {
      photoId: w.photos.pBobPrivate,
    });
    expectShape(own, SHAPE.photo);

    const gone = await staleId(t, w, "photos");
    await expectNoOracle(
      () => asUser(t, w, "alice").query(api.photos.getById, { photoId: gone }),
      () =>
        asUser(t, w, "alice").query(api.photos.getById, {
          photoId: w.photos.pBobPrivate,
        }),
    );
  });

  it("geen gedeelde groep met een publicatie: geen data, niet te onderscheiden van een onbekende foto", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const gone = await staleId(t, w, "photos");
    await expectNoOracle(
      () => asUser(t, w, "carol").query(api.photos.getById, { photoId: gone }),
      () =>
        asUser(t, w, "carol").query(api.photos.getById, {
          photoId: w.photos.pBob,
        }),
    );
  });

  it("foto in albums van twee groepen: lid van één van beide is genoeg", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // dave zit alleen in G3; pAlice staat in A1 (G1) én A3 (G3).
    const p = await asUser(t, w, "dave").query(api.photos.getById, {
      photoId: w.photos.pAlice,
    });
    expectShape(p, SHAPE.photo);
    // pBob staat alleen in G1.
    const gone = await staleId(t, w, "photos");
    await expectNoOracle(
      () => asUser(t, w, "dave").query(api.photos.getById, { photoId: gone }),
      () =>
        asUser(t, w, "dave").query(api.photos.getById, {
          photoId: w.photos.pBob,
        }),
    );
  });

  it("webmaster zonder lidmaatschap: geen bypass, ook niet op een gemelde foto", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const gone = await staleId(t, w, "photos");
    await expectNoOracle(
      () => asUser(t, w, "wm").query(api.photos.getById, { photoId: gone }),
      () =>
        asUser(t, w, "wm").query(api.photos.getById, { photoId: w.photos.pBob }),
    );
  });
});

describe("photos.getWithOwner", () => {
  it("niet-ingelogd: throwt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expect(
      t.query(api.photos.getWithOwner, { photoId: w.photos.pBob }),
    ).rejects.toThrow();
  });

  it("foto-vorm + owner als publiek profiel; geen email of subject van de eigenaar", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const p = (await asUser(t, w, "alice").query(api.photos.getWithOwner, {
      photoId: w.photos.pBob,
    })) as R;
    expectShape(p, [...SHAPE.photo, "owner"]);
    expectShape(p.owner, SHAPE.publicProfile);
    expect(p.owner._id).toBe(w.users.bob.id);
    expect(p.owner.name).toBe("Bob");
    expectNoUserSecrets(p, w);
  });

  it("geen foto-toegang: geen data, niet te onderscheiden van een onbekende foto", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const gone = await staleId(t, w, "photos");
    await expectNoOracle(
      () =>
        asUser(t, w, "carol").query(api.photos.getWithOwner, { photoId: gone }),
      () =>
        asUser(t, w, "carol").query(api.photos.getWithOwner, {
          photoId: w.photos.pBob,
        }),
    );
  });
});

describe("photos.listByOwner — alleen eigen foto's", () => {
  it("niet-ingelogd: throwt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expect(
      t.query(api.photos.listByOwner, { ownerId: w.users.bob.id }),
    ).rejects.toThrow();
  });

  it("eigen ownerId: alle eigen foto's (ook ongepubliceerd) in foto-vorm", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const list = (await asUser(t, w, "bob").query(api.photos.listByOwner, {
      ownerId: w.users.bob.id,
    })) as R[];
    expect(list.map((p) => p._id).sort()).toEqual(
      [w.photos.pBob, w.photos.pBobPrivate].sort(),
    );
    for (const p of list) expectShape(p, SHAPE.photo);
  });

  it("ownerId van een ander (ook een medelid): geen data", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const o = await outcome(() =>
      asUser(t, w, "bob").query(api.photos.listByOwner, {
        ownerId: w.users.alice.id,
      }),
    );
    expectNoData(o);
  });
});

describe("photos.listMyFlagged — eigenaar, voor bezwaar", () => {
  it("foto-vorm + eigen flag-velden; geen melder (flaggedBy) en geen reden", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const list = (await asUser(t, w, "bob").query(
      api.photos.listMyFlagged,
      {},
    )) as R[];
    expect(list.map((p) => p._id)).toEqual([w.photos.pBob]);
    expectShape(list[0], [...SHAPE.photo, ...SHAPE.ownFlag]);
    const json = JSON.stringify(list);
    expect(json, "melder-id lekt naar eigenaar").not.toContain(
      w.users.alice.id,
    );
    expect(json, "flag-reden lekt naar eigenaar").not.toContain(w.flagReason);
    expectNoUserSecrets(list, w);
  });

  it("niet-ingelogd: throwt (ongewijzigd)", async () => {
    const t = newT();
    await seedWorld(t);
    await expect(t.query(api.photos.listMyFlagged, {})).rejects.toThrow();
  });
});

describe("photos.listAllFlagged — webmaster", () => {
  it("foto-vorm + alle flag-velden, inclusief melder en reden", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const list = (await asUser(t, w, "wm").query(
      api.photos.listAllFlagged,
      {},
    )) as R[];
    expect(list.map((p) => p._id)).toEqual([w.photos.pBob]);
    expectShape(list[0], [...SHAPE.photo, ...SHAPE.allFlag]);
    expect(list[0]!.flaggedBy).toBe(w.users.alice.id);
    expect(list[0]!.flagReason).toBe(w.flagReason);
    expectNoUserSecrets(list, w);
  });

  it("niet-webmaster: throwt (ongewijzigd)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expect(
      asUser(t, w, "alice").query(api.photos.listAllFlagged, {}),
    ).rejects.toThrow();
  });
});
