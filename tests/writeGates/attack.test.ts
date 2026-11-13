import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  asUser,
  expectRejectedNoChange,
  newAccount,
  newT,
  seedWorld,
  useWebmasterEnv,
  type T,
  type World,
} from "./_helpers";
import { expectNoData, outcome } from "../readWhitelist/_world";

// WP24 invariant 1, end-to-end: een account dat een photo-id kent maar geen
// foto-toegang heeft, maakt een eigen groep + album en probeert elk
// schrijfpad uit invariant 2 en 8. Elk pad faalt zonder state-wijziging, en
// daarna levert geen enkele publieke read de foto of zijn storageId.
//
// Doelen: pAlice (gepubliceerd, niet gemeld), pBob (gepubliceerd, gemeld),
// pBobPrivate (in geen album).

useWebmasterEnv();

type Client = ReturnType<typeof asUser>;

async function attackAndRead(
  t: T,
  w: World,
  attacker: Client,
  target: { photoId: Id<"photos">; ownerId: Id<"users"> },
) {
  const groupId = await attacker.mutation(api.groups.create, { name: "Eigen" });
  const albumId = await attacker.mutation(api.albums.create, { groupId, name: "Eigen" });
  const { photoId } = target;

  const paths: Array<[string, () => Promise<unknown>]> = [
    ["albums.addPhoto", () => attacker.mutation(api.albums.addPhoto, { albumId, photoId })],
    ["groups.update cover", () => attacker.mutation(api.groups.update, { groupId, coverPhotoId: photoId })],
    ["albums.update cover", () => attacker.mutation(api.albums.update, { albumId, coverPhotoId: photoId })],
    ["photos.flag", () => attacker.mutation(api.photos.flag, { photoId, reason: "x" })],
    // Invariant 8: het beeld van de foto, en het profielbeeld van de eigenaar.
    [
      "users.updateProfile beeld van de foto",
      async () =>
        attacker.mutation(api.users.updateProfile, {
          profilePhotoStorageId: await t.run(async (ctx) => (await ctx.db.get(photoId))!.storageId),
        }),
    ],
    [
      "users.updateProfile profielbeeld van de eigenaar",
      async () =>
        attacker.mutation(api.users.updateProfile, {
          profilePhotoStorageId: await t.run(
            async (ctx) => (await ctx.db.get(target.ownerId))!.profilePhotoStorageId!,
          ),
        }),
    ],
  ];
  for (const [label, run] of paths) {
    await expectRejectedNoChange(t, run, label);
  }

  // Directe reads op de foto: geen data.
  expectNoData(await outcome(() => attacker.query(api.photos.getById, { photoId })));
  expectNoData(await outcome(() => attacker.query(api.photos.getWithOwner, { photoId })));
  expectNoData(
    await outcome(() => attacker.query(api.photos.listByOwner, { ownerId: target.ownerId })),
  );
  expectNoData(await outcome(() => attacker.query(api.albums.listPhotos, { albumId })));

  // Covers van de eigen groep en het eigen album: leeg.
  const g = await attacker.query(api.groups.getWithCover, { groupId });
  expect(g?.cover ?? null).toBeNull();
  expect(g?.coverPhotoId).toBeUndefined();
  const a = await attacker.query(api.albums.getWithCover, { albumId });
  expect(a.cover).toBeNull();
  expect(a.coverPhotoId).toBeUndefined();

  // Geen enkele read die de aanvaller kan doen, noemt het id of het beeld.
  const storageId = await t.run(async (ctx) => (await ctx.db.get(photoId))!.storageId);
  const reads = await Promise.all([
    outcome(() => attacker.query(api.groups.listMine, {})),
    outcome(() => attacker.query(api.groups.getById, { groupId })),
    outcome(() => attacker.query(api.groups.getWithCover, { groupId })),
    outcome(() => attacker.query(api.albums.listByGroup, { groupId })),
    outcome(() => attacker.query(api.albums.listByGroupWithUnread, { groupId })),
    outcome(() => attacker.query(api.albums.getWithCover, { albumId })),
    outcome(() => attacker.query(api.albums.listPhotos, { albumId })),
    outcome(() => attacker.query(api.photos.listMyFlagged, {})),
    outcome(() => attacker.query(api.users.current, {})),
  ]);
  const json = JSON.stringify(reads);
  expect(json).not.toContain(photoId);
  expect(json).not.toContain(storageId);
}

describe("invariant 1 — aanval met een bekend photo-id via een eigen groep", () => {
  it("vers account: geen enkel schrijfpad geeft toegang tot een gepubliceerde foto", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { client } = await newAccount(t, "mallory");
    await attackAndRead(t, w, client, { photoId: w.photos.pAlice, ownerId: w.users.alice.id });
  });

  it("vers account: ook niet tot een gemelde foto", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { client } = await newAccount(t, "mallory");
    await attackAndRead(t, w, client, { photoId: w.photos.pBob, ownerId: w.users.bob.id });
  });

  it("vers account: ook niet tot een foto in geen enkel album", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { client } = await newAccount(t, "mallory");
    await attackAndRead(t, w, client, {
      photoId: w.photos.pBobPrivate,
      ownerId: w.users.bob.id,
    });
  });

  it("ex-lid (zag de foto ooit): na vertrek geeft geen schrijfpad de toegang terug", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const dave = asUser(t, w, "dave");
    // dave zag pAlice via G3; hij vertrekt uit G3 en heeft dan geen groepen meer.
    expect((await dave.query(api.photos.getById, { photoId: w.photos.pAlice }))._id).toBe(
      w.photos.pAlice,
    );
    await dave.mutation(api.groups.removeMember, {
      groupId: w.groups.G3,
      userId: w.users.dave.id,
    });
    await attackAndRead(t, w, dave, { photoId: w.photos.pAlice, ownerId: w.users.alice.id });
  });

  it("webmaster met een eigen groep: geen bypass (invariant 6)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await attackAndRead(t, w, asUser(t, w, "wm"), {
      photoId: w.photos.pAlice,
      ownerId: w.users.alice.id,
    });
  });
});
