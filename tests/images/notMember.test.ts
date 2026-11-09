import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { seedMember } from "../_helpers/membership";

// WP17a invariant 7 (WP16 backlog N3). De reads achter het albumscherm en het
// foto-detail geven bij geen toegang, en bij een album of foto die niet
// (meer) bestaat, precies dezelfde ConvexError met code NOT_MEMBER. Zelfde
// patroon als de groep-reads in tests/groups/notMember.test.ts (WP16
// invariant 9): de app herkent de fout aan de code, nooit aan de tekst, en
// toont de melding met de weg naar Mijn groepen. Eén uitkomst, dus geen
// bestaans-orakel (WP23).
//
// Ook live: wie de toegang verliest terwijl het scherm open is, krijgt bij de
// volgende uitvoering van de query dezelfde fout.

type T = ReturnType<typeof convexTest>;

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("de aanroep had moeten falen");
}

async function expectNotMember(promise: Promise<unknown>): Promise<unknown> {
  const err = await caught(promise);
  expect(err).toBeInstanceOf(ConvexError);
  const data = (err as ConvexError<{ code: string }>).data;
  expect(data).toMatchObject({ code: "NOT_MEMBER" });
  return data;
}

/** Admin en Bob in groep G, album A met een foto van Admin. Eve is van niets lid. */
async function setup(t: T) {
  const adminId = await registerUser(t, "user_admin", "admin@x.com", "Admin");
  const bobId = await registerUser(t, "user_bob", "bob@x.com", "Bob");
  await registerUser(t, "user_eve", "eve@x.com", "Eve");
  const groupId = await withUser(t, "user_admin").mutation(api.groups.create, { name: "G" });
  await seedMember(t, { groupId, userId: bobId });
  const albumId = await withUser(t, "user_admin").mutation(api.albums.create, {
    groupId,
    name: "A",
  });
  const photoId = await t.run(async (ctx) =>
    ctx.db.insert("photos", {
      ownerId: adminId,
      storageId: await ctx.storage.store(new Blob(["x"])),
      ratingCount: 0,
      createdAt: Date.now(),
    }),
  );
  await withUser(t, "user_admin").mutation(api.albums.addPhoto, { albumId, photoId });
  return { adminId, bobId, groupId, albumId, photoId };
}

// --- album-reads -------------------------------------------------------------

const ALBUM_READS = [
  ["albums.getById", (t: T, s: string, albumId: Id<"albums">) =>
    withUser(t, s).query(api.albums.getById, { albumId })],
  ["albums.getWithGroup", (t: T, s: string, albumId: Id<"albums">) =>
    withUser(t, s).query(api.albums.getWithGroup, { albumId })],
  ["albums.getWithCover", (t: T, s: string, albumId: Id<"albums">) =>
    withUser(t, s).query(api.albums.getWithCover, { albumId })],
  ["albums.listPhotos", (t: T, s: string, albumId: Id<"albums">) =>
    withUser(t, s).query(api.albums.listPhotos, { albumId })],
] as const;

async function goneAlbumId(t: T, groupId: Id<"groups">): Promise<Id<"albums">> {
  const id = await withUser(t, "user_admin").mutation(api.albums.create, { groupId, name: "Weg" });
  await withUser(t, "user_admin").mutation(api.albums.remove, { albumId: id });
  return id;
}

describe.each(ALBUM_READS)("%s: NOT_MEMBER", (_name, read) => {
  it("een lid krijgt gewoon antwoord", async () => {
    const t = convexTest(schema, modules);
    const { albumId } = await setup(t);
    await expect(read(t, "user_bob", albumId)).resolves.toBeDefined();
  });

  it("geen lid: ConvexError met code NOT_MEMBER", async () => {
    const t = convexTest(schema, modules);
    const { albumId } = await setup(t);
    await expectNotMember(read(t, "user_eve", albumId));
  });

  it("onbekend album: dezelfde fout als geen lid (geen orakel)", async () => {
    const t = convexTest(schema, modules);
    const { albumId, groupId } = await setup(t);
    const gone = await goneAlbumId(t, groupId);
    const notMember = await expectNotMember(read(t, "user_eve", albumId));
    const unknown = await expectNotMember(read(t, "user_bob", gone));
    expect(unknown).toEqual(notMember);
  });

  it("uit de groep gehaald terwijl je kijkt: de volgende uitvoering geeft NOT_MEMBER", async () => {
    const t = convexTest(schema, modules);
    const { bobId, groupId, albumId } = await setup(t);
    await expect(read(t, "user_bob", albumId)).resolves.toBeDefined();
    await withUser(t, "user_admin").mutation(api.groups.removeMember, { groupId, userId: bobId });
    await expectNotMember(read(t, "user_bob", albumId));
  });

  it("album verwijderd terwijl je kijkt: NOT_MEMBER", async () => {
    const t = convexTest(schema, modules);
    const { albumId } = await setup(t);
    await expect(read(t, "user_bob", albumId)).resolves.toBeDefined();
    await withUser(t, "user_admin").mutation(api.albums.remove, { albumId });
    await expectNotMember(read(t, "user_bob", albumId));
  });
});

// --- foto-reads --------------------------------------------------------------

const PHOTO_READS = [
  ["photos.getById", (t: T, s: string, photoId: Id<"photos">) =>
    withUser(t, s).query(api.photos.getById, { photoId })],
  ["photos.getWithOwner", (t: T, s: string, photoId: Id<"photos">) =>
    withUser(t, s).query(api.photos.getWithOwner, { photoId })],
] as const;

describe.each(PHOTO_READS)("%s: NOT_MEMBER", (_name, read) => {
  it("een lid krijgt gewoon antwoord, de eigenaar ook", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await setup(t);
    await expect(read(t, "user_bob", photoId)).resolves.toBeDefined();
    await expect(read(t, "user_admin", photoId)).resolves.toBeDefined();
  });

  it("geen toegang: ConvexError met code NOT_MEMBER", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await setup(t);
    await expectNotMember(read(t, "user_eve", photoId));
  });

  it("onbekende foto: dezelfde fout als geen toegang (geen orakel)", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await setup(t);
    await withUser(t, "user_admin").mutation(api.photos.remove, { photoId });
    const unknown = await expectNotMember(read(t, "user_bob", photoId));
    const t2 = convexTest(schema, modules);
    const s2 = await setup(t2);
    const noAccess = await expectNotMember(read(t2, "user_eve", s2.photoId));
    expect(unknown).toEqual(noAccess);
  });

  it("uit de groep gehaald terwijl je kijkt: NOT_MEMBER", async () => {
    const t = convexTest(schema, modules);
    const { bobId, groupId, photoId } = await setup(t);
    await expect(read(t, "user_bob", photoId)).resolves.toBeDefined();
    await withUser(t, "user_admin").mutation(api.groups.removeMember, { groupId, userId: bobId });
    await expectNotMember(read(t, "user_bob", photoId));
  });

  it("foto uit het album gehaald terwijl je kijkt: NOT_MEMBER", async () => {
    const t = convexTest(schema, modules);
    const { albumId, photoId } = await setup(t);
    await expect(read(t, "user_bob", photoId)).resolves.toBeDefined();
    await withUser(t, "user_admin").mutation(api.albums.removePhoto, { albumId, photoId });
    await expectNotMember(read(t, "user_bob", photoId));
  });
});
