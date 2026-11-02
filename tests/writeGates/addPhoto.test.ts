import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  seedAlbum,
  seedPhoto,
  asGhost,
  asUser,
  expectNoMutationOracle,
  expectRejectedNoChange,
  newT,
  seedWorld,
  staleId,
  useWebmasterEnv,
} from "./_helpers";
import { outcome } from "../readWhitelist/_world";

// WP24 invariant 2 + A-keuze 1: albums.addPhoto vereist dat de caller de
// eigenaar van de foto is (v1-pariteit; strenger dan foto-toegang, en dus
// binnen invariant 1). De rol-check (lid van de groep van het album) blijft.

useWebmasterEnv();

describe("albums.addPhoto — write-gate", () => {
  it("niet ingelogd: geweigerd, state ongewijzigd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expectRejectedNoChange(t, () =>
      t.mutation(api.albums.addPhoto, {
        albumId: w.albums.A1,
        photoId: w.photos.pBobPrivate,
      }),
    );
  });

  it("identity zonder users-rij: geweigerd, state ongewijzigd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expectRejectedNoChange(t, () =>
      asGhost(t).mutation(api.albums.addPhoto, {
        albumId: w.albums.A1,
        photoId: w.photos.pBobPrivate,
      }),
    );
  });

  it("admin zonder foto-toegang zet geen vreemde foto in een eigen album, en leest hem daarna niet", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const carol = asUser(t, w, "carol");
    for (const photoId of [w.photos.pAlice, w.photos.pBob, w.photos.pBobPrivate]) {
      await expectRejectedNoChange(
        t,
        () => carol.mutation(api.albums.addPhoto, { albumId: w.albums.A2, photoId }),
        `addPhoto ${photoId}`,
      );
      const read = await outcome(() => carol.query(api.photos.getById, { photoId }));
      expect("err" in read, "carol leest de foto na de poging").toBe(true);
    }
  });

  it("webmaster zonder lidmaatschap, met een eigen groep: geen bypass", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const wm = asUser(t, w, "wm");
    const groupId = await wm.mutation(api.groups.create, { name: "WM" });
    const albumId = await wm.mutation(api.albums.create, { groupId, name: "WM" });
    await expectRejectedNoChange(t, () =>
      wm.mutation(api.albums.addPhoto, { albumId, photoId: w.photos.pAlice }),
    );
  });

  it("eigenaar zet een eigen ongepubliceerde foto in een album van zijn groep", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "bob").mutation(api.albums.addPhoto, {
      albumId: w.albums.A1,
      photoId: w.photos.pBobPrivate,
    });
    const aps = (await t.run(async (ctx) => ctx.db.query("albumPhotos").collect())).filter(
      (ap) => ap.photoId === w.photos.pBobPrivate,
    );
    expect(aps).toHaveLength(1);
    expect(aps[0]!.albumId).toBe(w.albums.A1);
    expect(aps[0]!.groupId).toBe(w.groups.G1);
    expect(aps[0]!.addedBy).toBe(w.users.bob.id);
  });

  it("eigenaar zet een eigen foto die elders al staat in een tweede album", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const A1b = await seedAlbum(t, w.groups.G1, w.users.alice.id);
    await asUser(t, w, "alice").mutation(api.albums.addPhoto, {
      albumId: A1b,
      photoId: w.photos.pAlice,
    });
    const aps = (await t.run(async (ctx) => ctx.db.query("albumPhotos").collect())).filter(
      (ap) => ap.albumId === A1b,
    );
    expect(aps.map((a) => a.photoId)).toEqual([w.photos.pAlice]);
  });

  it("rol-check blijft (invariant 7): eigenaar die geen lid is van de groep wordt geweigerd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "carol").mutation(api.albums.addPhoto, {
        albumId: w.albums.A1,
        photoId: w.photos.pCarol,
      }),
    );
  });

  it("vertrokken eigenaar zet zijn foto niet meer in een album van die groep", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bob = asUser(t, w, "bob");
    await bob.mutation(api.groups.removeMember, {
      groupId: w.groups.G1,
      userId: w.users.bob.id,
    });
    await expectRejectedNoChange(t, () =>
      bob.mutation(api.albums.addPhoto, {
        albumId: w.albums.A1,
        photoId: w.photos.pBobPrivate,
      }),
    );
  });
});

describe("A-keuze 1 (ter bevestiging) — alleen de eigenaar zet een foto in een album", () => {
  it("lid mét foto-toegang zet andermans foto niet in een album van een andere eigen groep", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // alice ziet pBob via A1 (G1); G3 (alice admin, dave lid) heeft pBob niet.
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "alice").mutation(api.albums.addPhoto, {
        albumId: w.albums.A3,
        photoId: w.photos.pBob,
      }),
    );
    const read = await outcome(() =>
      asUser(t, w, "dave").query(api.photos.getById, { photoId: w.photos.pBob }),
    );
    expect("err" in read, "dave leest pBob").toBe(true);
  });

  it("lid mét foto-toegang zet andermans foto niet in een tweede album van dezelfde groep", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const A1b = await seedAlbum(t, w.groups.G1, w.users.bob.id);
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "bob").mutation(api.albums.addPhoto, {
        albumId: A1b,
        photoId: w.photos.pAlice,
      }),
    );
  });

  it("geen orakel: niet-eigenaar met toegang, onbekend id tegenover andermans foto", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const A1b = await seedAlbum(t, w.groups.G1, w.users.bob.id);
    const missing = await staleId(t, w, "photos");
    const bob = asUser(t, w, "bob");
    await expectNoMutationOracle(
      t,
      () => bob.mutation(api.albums.addPhoto, { albumId: A1b, photoId: missing }),
      () => bob.mutation(api.albums.addPhoto, { albumId: A1b, photoId: w.photos.pAlice }),
    );
  });
});

describe("albums.addPhoto — geen bestaans-orakel (invariant 3)", () => {
  it("photo-id: onbekend tegenover bestaand zonder toegang", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "photos");
    const carol = asUser(t, w, "carol");
    for (const photoId of [w.photos.pAlice, w.photos.pBob, w.photos.pBobPrivate]) {
      await expectNoMutationOracle(
        t,
        () => carol.mutation(api.albums.addPhoto, { albumId: w.albums.A2, photoId: missing }),
        () => carol.mutation(api.albums.addPhoto, { albumId: w.albums.A2, photoId }),
      );
    }
  });

  it("A-keuze 3 — album-id: onbekend tegenover album van een groep zonder lidmaatschap", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "albums");
    const carol = asUser(t, w, "carol");
    await expectNoMutationOracle(
      t,
      () => carol.mutation(api.albums.addPhoto, { albumId: missing, photoId: w.photos.pCarol }),
      () => carol.mutation(api.albums.addPhoto, { albumId: w.albums.A1, photoId: w.photos.pCarol }),
    );
  });

  it("controle: eigenaar zet een nieuwe eigen foto in een eigen album", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const own = await seedPhoto(t, w.users.carol.id);
    await asUser(t, w, "carol").mutation(api.albums.addPhoto, {
      albumId: w.albums.A2,
      photoId: own,
    });
  });
});
