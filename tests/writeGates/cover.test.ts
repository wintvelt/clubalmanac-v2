import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  asGhost,
  asUser,
  expectNoMutationOracle,
  expectRejectedNoChange,
  newT,
  seedAlbum,
  seedPhoto,
  seedWorld,
  staleId,
  useWebmasterEnv,
  type R,
  type T,
} from "./_helpers";
import { outcome } from "../readWhitelist/_world";

// WP24 invariant 2 (cover-pad via de mutation, WP23-closeout) + A-keuze 2:
// een album-cover staat in dát album, een groep-cover in een album van díe
// groep. Foto-toegang van de caller volgt daaruit. Rol-checks blijven: groep
// = admin, album = creator of groep-admin.

useWebmasterEnv();

async function groupCoverId(t: T, groupId: Id<"groups">) {
  return await t.run(async (ctx) => (await ctx.db.get(groupId))?.coverPhotoId);
}
async function albumCoverId(t: T, albumId: Id<"albums">) {
  return await t.run(async (ctx) => (await ctx.db.get(albumId))?.coverPhotoId);
}

describe("groups.update coverPhotoId — write-gate", () => {
  it("niet ingelogd en identity zonder users-rij: geweigerd, state ongewijzigd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const args = { groupId: w.groups.G1, coverPhotoId: w.photos.pAlice };
    await expectRejectedNoChange(t, () => t.mutation(api.groups.update, args), "anoniem");
    await expectRejectedNoChange(t, () => asGhost(t).mutation(api.groups.update, args), "ghost");
  });

  it("admin zonder foto-toegang zet geen vreemde foto als groep-cover, en ziet hem daarna niet", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const carol = asUser(t, w, "carol");
    for (const photoId of [w.photos.pAlice, w.photos.pBob, w.photos.pBobPrivate]) {
      await expectRejectedNoChange(
        t,
        () => carol.mutation(api.groups.update, { groupId: w.groups.G2, coverPhotoId: photoId }),
        `cover ${photoId}`,
      );
      const g = (await carol.query(api.groups.getWithCover, { groupId: w.groups.G2 })) as R;
      expect(g.cover?._id).toBe(w.photos.pCarol);
      const read = await outcome(() => carol.query(api.photos.getById, { photoId }));
      expect("err" in read).toBe(true);
    }
  });

  it("een geldige naam samen met een verboden cover: de hele mutation faalt, ook de naam blijft", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "carol").mutation(api.groups.update, {
        groupId: w.groups.G2,
        name: "Nieuwe naam",
        coverPhotoId: w.photos.pAlice,
      }),
    );
  });

  it("webmaster zonder lidmaatschap, met een eigen groep: geen bypass", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const wm = asUser(t, w, "wm");
    const groupId = await wm.mutation(api.groups.create, { name: "WM" });
    await expectRejectedNoChange(t, () =>
      wm.mutation(api.groups.update, { groupId, coverPhotoId: w.photos.pAlice }),
    );
  });

  it("admin zet een foto uit een album van de groep als groep-cover (eigen foto en andermans foto)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const alice = asUser(t, w, "alice");
    await alice.mutation(api.groups.update, { groupId: w.groups.G1, coverPhotoId: w.photos.pAlice });
    expect(await groupCoverId(t, w.groups.G1)).toBe(w.photos.pAlice);
    const g = (await asUser(t, w, "bob").query(api.groups.getWithCover, {
      groupId: w.groups.G1,
    })) as R;
    expect(g.cover?._id).toBe(w.photos.pAlice);

    await alice.mutation(api.groups.update, { groupId: w.groups.G1, coverPhotoId: w.photos.pBob });
    expect(await groupCoverId(t, w.groups.G1)).toBe(w.photos.pBob);
  });

  it("rol-check blijft (invariant 7): lid zonder admin-rol zet geen cover", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "bob").mutation(api.groups.update, {
        groupId: w.groups.G1,
        coverPhotoId: w.photos.pAlice,
      }),
    );
  });

  it("update zonder coverPhotoId slaagt, ook als de huidige cover niet meer in de groep staat", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // Seed: G1-cover = pBob. Bob vertrekt; M1 haalt pBob uit A1.
    await asUser(t, w, "bob").mutation(api.groups.removeMember, {
      groupId: w.groups.G1,
      userId: w.users.bob.id,
    });
    await asUser(t, w, "alice").mutation(api.groups.update, {
      groupId: w.groups.G1,
      name: "Hernoemd",
    });
    const g = await t.run(async (ctx) => ctx.db.get(w.groups.G1));
    expect(g?.name).toBe("Hernoemd");
  });
});

describe("albums.update coverPhotoId — write-gate", () => {
  it("niet ingelogd en identity zonder users-rij: geweigerd, state ongewijzigd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const args = { albumId: w.albums.A1, coverPhotoId: w.photos.pAlice };
    await expectRejectedNoChange(t, () => t.mutation(api.albums.update, args), "anoniem");
    await expectRejectedNoChange(t, () => asGhost(t).mutation(api.albums.update, args), "ghost");
  });

  it("admin zonder foto-toegang zet geen vreemde foto als album-cover, en ziet hem daarna niet", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const carol = asUser(t, w, "carol");
    for (const photoId of [w.photos.pAlice, w.photos.pBob, w.photos.pBobPrivate]) {
      await expectRejectedNoChange(
        t,
        () => carol.mutation(api.albums.update, { albumId: w.albums.A2, coverPhotoId: photoId }),
        `cover ${photoId}`,
      );
      const a = (await carol.query(api.albums.getWithCover, { albumId: w.albums.A2 })) as R;
      expect(a.cover?._id).toBe(w.photos.pCarol);
    }
  });

  it("webmaster zonder lidmaatschap, met een eigen album: geen bypass", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const wm = asUser(t, w, "wm");
    const groupId = await wm.mutation(api.groups.create, { name: "WM" });
    const albumId = await wm.mutation(api.albums.create, { groupId, name: "WM" });
    await expectRejectedNoChange(t, () =>
      wm.mutation(api.albums.update, { albumId, coverPhotoId: w.photos.pAlice }),
    );
  });

  it("admin zet een foto uit het album als album-cover", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "alice").mutation(api.albums.update, {
      albumId: w.albums.A1,
      coverPhotoId: w.photos.pAlice,
    });
    expect(await albumCoverId(t, w.albums.A1)).toBe(w.photos.pAlice);
  });

  it("creator zonder admin-rol zet een foto uit zijn album als cover", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bob = asUser(t, w, "bob");
    const albumId = await bob.mutation(api.albums.create, { groupId: w.groups.G1, name: "Bobs" });
    await bob.mutation(api.albums.addPhoto, { albumId, photoId: w.photos.pBobPrivate });
    await bob.mutation(api.albums.update, { albumId, coverPhotoId: w.photos.pBobPrivate });
    expect(await albumCoverId(t, albumId)).toBe(w.photos.pBobPrivate);
  });

  it("update zonder coverPhotoId slaagt, ook als de huidige cover niet meer in het album staat", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // Seed: A1-cover = pBob. Bob vertrekt; M1 haalt pBob uit A1.
    await asUser(t, w, "bob").mutation(api.groups.removeMember, {
      groupId: w.groups.G1,
      userId: w.users.bob.id,
    });
    await asUser(t, w, "alice").mutation(api.albums.update, {
      albumId: w.albums.A1,
      name: "Hernoemd",
    });
    const a = await t.run(async (ctx) => ctx.db.get(w.albums.A1));
    expect(a?.name).toBe("Hernoemd");
  });
});

describe("A-keuze 2 (ter bevestiging) — cover staat in dat album / in die groep", () => {
  it("groep-cover: foto met toegang via een andere groep, niet in deze groep: geweigerd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // alice ziet pBob via G1; G3 (alice admin) heeft pBob in geen album.
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "alice").mutation(api.groups.update, {
        groupId: w.groups.G3,
        coverPhotoId: w.photos.pBob,
      }),
    );
  });

  it("groep-cover: eigen foto in geen album: geweigerd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const own = await seedPhoto(t, w.users.alice.id);
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "alice").mutation(api.groups.update, {
        groupId: w.groups.G1,
        coverPhotoId: own,
      }),
    );
  });

  it("album-cover: foto uit een ander album van dezelfde groep: geweigerd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const A1b = await seedAlbum(t, w.groups.G1, w.users.alice.id);
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "alice").mutation(api.albums.update, {
        albumId: A1b,
        coverPhotoId: w.photos.pAlice,
      }),
    );
  });

  it("album-cover: foto met toegang via een andere groep: geweigerd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "alice").mutation(api.albums.update, {
        albumId: w.albums.A3,
        coverPhotoId: w.photos.pBob,
      }),
    );
  });

  it("album-cover: eigen foto in geen album: geweigerd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const own = await seedPhoto(t, w.users.alice.id);
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "alice").mutation(api.albums.update, {
        albumId: w.albums.A1,
        coverPhotoId: own,
      }),
    );
  });
});

describe("covers — geen bestaans-orakel (invariant 3)", () => {
  it("groups.update: onbekend photo-id tegenover bestaand zonder toegang", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "photos");
    const carol = asUser(t, w, "carol");
    for (const photoId of [w.photos.pAlice, w.photos.pBobPrivate]) {
      await expectNoMutationOracle(
        t,
        () => carol.mutation(api.groups.update, { groupId: w.groups.G2, coverPhotoId: missing }),
        () => carol.mutation(api.groups.update, { groupId: w.groups.G2, coverPhotoId: photoId }),
      );
    }
  });

  it("albums.update: onbekend photo-id tegenover bestaand zonder toegang", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "photos");
    const carol = asUser(t, w, "carol");
    for (const photoId of [w.photos.pAlice, w.photos.pBobPrivate]) {
      await expectNoMutationOracle(
        t,
        () => carol.mutation(api.albums.update, { albumId: w.albums.A2, coverPhotoId: missing }),
        () => carol.mutation(api.albums.update, { albumId: w.albums.A2, coverPhotoId: photoId }),
      );
    }
  });

  it("A-keuze 3 — albums.update album-id: onbekend tegenover album van een groep zonder lidmaatschap", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "albums");
    const carol = asUser(t, w, "carol");
    await expectNoMutationOracle(
      t,
      () => carol.mutation(api.albums.update, { albumId: missing, name: "X" }),
      () => carol.mutation(api.albums.update, { albumId: w.albums.A1, name: "X" }),
    );
  });
});
