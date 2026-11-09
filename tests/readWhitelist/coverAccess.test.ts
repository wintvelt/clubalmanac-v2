import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  SHAPE,
  asUser,
  expectShape,
  newT,
  seedWorld,
  useWebmasterEnv,
  type R,
  type T,
  type World,
} from "./_world";

// WP23 invariant 10 (audit-ronde 1): een geneste foto (`cover` in
// groups.getWithCover en albums.getWithCover) volgt dezelfde foto-toegang als
// photos.getById. Zonder foto-toegang is `cover` null, ook als coverPhotoId
// gezet is. De groep-/album-vorm zelf blijft leesbaar; coverPhotoId mag blijven
// staan (een id zonder toegang ontsluit niets).
//
// Twee paden: (a) een cover-id waar de caller nooit toegang toe had (een admin
// kan elk photo-id als cover zetten); (b) een cover die zijn toegang verloor
// doordat de eigenaar de groep verliet.

useWebmasterEnv();

async function setCovers(t: T, w: World, photoId: Id<"photos">) {
  await t.run(async (ctx) => {
    await ctx.db.patch(w.groups.G1, { coverPhotoId: photoId });
    await ctx.db.patch(w.albums.A1, { coverPhotoId: photoId });
  });
}

// WP28 (A-invariant 3): een cover die zijn publicatie verliest, wordt gewist.
// Dan ontbreekt `coverPhotoId` in de vorm; de rest van de vorm blijft gelijk.
async function groupCover(t: T, w: World, who: "alice" | "bob", coverGone = false) {
  const g = (await asUser(t, w, who).query(api.groups.getWithCover, {
    groupId: w.groups.G1,
  })) as R;
  expectShape(g, [...SHAPE.group.filter((k) => !(coverGone && k === "coverPhotoId")), "cover"]);
  return g.cover as R | null;
}

async function albumCover(t: T, w: World, who: "alice" | "bob", coverGone = false) {
  const a = (await asUser(t, w, who).query(api.albums.getWithCover, {
    albumId: w.albums.A1,
  })) as R;
  expectShape(a, [...SHAPE.album.filter((k) => !(coverGone && k === "coverPhotoId")), "cover"]);
  return a.cover as R | null;
}

describe("invariant 10 — cover zonder foto-toegang is null", () => {
  it("(a) cover = foto uit een groep waar de caller geen lid van is: groep- en album-cover null", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // pCarol staat alleen in A2 (G2); alice en bob zitten niet in G2.
    await setCovers(t, w, w.photos.pCarol);
    for (const who of ["alice", "bob"] as const) {
      expect(await groupCover(t, w, who), `groep-cover voor ${who}`).toBeNull();
      expect(await albumCover(t, w, who), `album-cover voor ${who}`).toBeNull();
    }
  });

  it("(a) cover = ongepubliceerde foto van een lid: alleen de eigenaar ziet hem", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await setCovers(t, w, w.photos.pBobPrivate);

    const bobGroup = await groupCover(t, w, "bob");
    expectShape(bobGroup, SHAPE.photo);
    expect(bobGroup!._id).toBe(w.photos.pBobPrivate);
    const bobAlbum = await albumCover(t, w, "bob");
    expectShape(bobAlbum, SHAPE.photo);

    expect(await groupCover(t, w, "alice")).toBeNull();
    expect(await albumCover(t, w, "alice")).toBeNull();
  });

  it("(b) eigenaar van de cover verlaat de groep: achterblijvers zien geen cover meer", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // Seed: G1- en A1-cover = pBob. Bob vertrekt; M1 haalt pBob uit A1.
    expect((await groupCover(t, w, "alice"))?._id).toBe(w.photos.pBob);

    await asUser(t, w, "bob").mutation(api.groups.removeMember, {
      groupId: w.groups.G1,
      userId: w.users.bob.id,
    });

    expect(await groupCover(t, w, "alice", true)).toBeNull();
    expect(await albumCover(t, w, "alice", true)).toBeNull();
  });

  it("controle: cover met foto-toegang blijft gewoon zichtbaar", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await setCovers(t, w, w.photos.pAlice);
    for (const who of ["alice", "bob"] as const) {
      expect((await groupCover(t, w, who))?._id).toBe(w.photos.pAlice);
      expect((await albumCover(t, w, who))?._id).toBe(w.photos.pAlice);
    }
  });
});
