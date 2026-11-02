import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  asUser,
  expectNoData,
  newT,
  outcome,
  seedWorld,
  useWebmasterEnv,
  type R,
} from "./_world";

// WP23 — edge cases "lid verlaat groep" en "publicatie verdwijnt": toegang
// volgt per direct het lidmaatschap / de publicaties. Eigen foto's blijven
// leesbaar. Spec §Edge cases. Toegang wordt hier op `_id` gecheckt, niet op
// de vorm: die staat in de domein-tests, en zo faalt deze test alleen op
// toegang.

useWebmasterEnv();

describe("lid verlaat groep", () => {
  it("bob verlaat G1: geen groep-, album-, foto- en medelid-reads van G1 meer; eigen foto's wel", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bob = asUser(t, w, "bob");

    // Vooraf: bob heeft toegang.
    expect(
      ((await bob.query(api.photos.getById, {
        photoId: w.photos.pAlice,
      })) as R | null)?._id,
    ).toBe(w.photos.pAlice);

    await bob.mutation(api.groups.removeMember, {
      groupId: w.groups.G1,
      userId: w.users.bob.id,
    });

    expectNoData(
      await outcome(() =>
        bob.query(api.groups.getById, { groupId: w.groups.G1 }),
      ),
    );
    expectNoData(
      await outcome(() =>
        bob.query(api.albums.getById, { albumId: w.albums.A1 }),
      ),
    );
    expectNoData(
      await outcome(() =>
        bob.query(api.albums.listPhotos, { albumId: w.albums.A1 }),
      ),
    );
    expectNoData(
      await outcome(() =>
        bob.query(api.photos.getById, { photoId: w.photos.pAlice }),
      ),
    );
    expectNoData(
      await outcome(() =>
        bob.query(api.photos.getWithOwner, { photoId: w.photos.pAlice }),
      ),
    );
    expectNoData(
      await outcome(() =>
        bob.query(api.ratings.listForPhoto, { photoId: w.photos.pAlice }),
      ),
    );
    expectNoData(
      await outcome(() =>
        bob.query(api.users.getById, { userId: w.users.alice.id }),
      ),
    );

    // Eigen foto's: ook die uit het verlaten album (M1 haalde pBob uit A1).
    expect(
      ((await bob.query(api.photos.getById, {
        photoId: w.photos.pBob,
      })) as R | null)?._id,
    ).toBe(w.photos.pBob);
    expect(
      ((await bob.query(api.photos.getById, {
        photoId: w.photos.pBobPrivate,
      })) as R | null)?._id,
    ).toBe(w.photos.pBobPrivate);
  });

  it("de achterblijvers zien de vertrokken bob niet meer als medelid", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "bob").mutation(api.groups.removeMember, {
      groupId: w.groups.G1,
      userId: w.users.bob.id,
    });
    expectNoData(
      await outcome(() =>
        asUser(t, w, "alice").query(api.users.getById, {
          userId: w.users.bob.id,
        }),
      ),
    );
  });
});

describe("publicatie verdwijnt", () => {
  it("pAlice uit A3 (G3) gehaald: dave (alleen G3) verliest per direct de toegang", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const dave = asUser(t, w, "dave");
    expect(
      ((await dave.query(api.photos.getById, {
        photoId: w.photos.pAlice,
      })) as R | null)?._id,
    ).toBe(w.photos.pAlice);

    await asUser(t, w, "alice").mutation(api.albums.removePhoto, {
      albumId: w.albums.A3,
      photoId: w.photos.pAlice,
    });

    expectNoData(
      await outcome(() =>
        dave.query(api.photos.getById, { photoId: w.photos.pAlice }),
      ),
    );
    // Bob (G1) houdt toegang via A1.
    expect(
      await asUser(t, w, "bob").query(api.photos.getById, {
        photoId: w.photos.pAlice,
      }),
    ).not.toBeNull();
  });
});
