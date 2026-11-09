import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { I, seedPhoto } from "./_helpers";
import { seedMember } from "../_helpers/membership";

// WP25 fix-cyclus 2 — `hasFormats` in de foto-vorm en `profileHasFormats` in de
// user-vorm (A-invariant 26, kernvondst 14; red-team N1).
//
// `no-store` op de terugval houdt expo-image niet tegen: de app bewaart het
// origineel op schijf onder de URL van het formaat, en draait het na de
// backfill een tweede keer. De app moet dus weten of het beeldpad een formaat
// geeft of het origineel, en dat moet in dezelfde response staan als de stand.
// `hasFormats` is true als beide formaat-objecten nog in storage staan
// (invariant 22); dan geeft het beeldpad een formaat. Geen id, alleen een
// boolean. De aanwezigheid in elke vorm pint `SHAPE` in
// tests/readWhitelist/_world.ts; hier gaat het om de waarde.

type T = ReturnType<typeof convexTest>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

async function setup(t: T) {
  const owen = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  const mia = await registerUser(t, "user_mia", "mia@x.com", "Mia");
  const G = await withUser(t, "user_owen").mutation(api.groups.create, { name: "G" });
  await seedMember(t, { groupId: G, userId: mia });
  const A = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: G, name: "A" });
  return { owen, mia, G, A };
}

/** De foto-vorm van één foto, zoals vijf publieke reads hem geven. */
async function photoShapes(t: T, s: Awaited<ReturnType<typeof setup>>, photoId: Id<"photos">) {
  await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: s.A, photoId });
  await t.run(async (ctx) => {
    await ctx.db.patch(s.A, { coverPhotoId: photoId });
    await ctx.db.patch(s.G, { coverPhotoId: photoId });
  });
  const mia = withUser(t, "user_mia");
  const owen = withUser(t, "user_owen");
  const withOwner = (await mia.query(api.photos.getWithOwner, { photoId })) as R;
  const byId = (await mia.query(api.photos.getById, { photoId })) as R;
  const listed = ((await mia.query(api.albums.listPhotos, { albumId: s.A })) as R[]).find(
    (i) => i.photo?._id === photoId,
  )!;
  const albumCover = (await mia.query(api.albums.getWithCover, { albumId: s.A })) as R;
  const groupCover = (await mia.query(api.groups.getWithCover, { groupId: s.G })) as R;
  const own = ((await owen.query(api.photos.listByOwner, { ownerId: s.owen })) as R[]).find(
    (p) => p._id === photoId,
  )!;
  return [
    ["photos.getWithOwner", withOwner],
    ["photos.getById", byId],
    ["albums.listPhotos", listed.photo],
    ["albums.getWithCover", albumCover.cover],
    ["groups.getWithCover", groupCover.cover],
    ["photos.listByOwner", own],
  ] as [string, R][];
}

describe("hasFormats in de foto-vorm", () => {
  it("een volledige set: true, in elke foto-vorm", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await seedPhoto(t, s.owen, { withFormats: true, exifOrientation: 6 });
    for (const [name, shape] of await photoShapes(t, s, p.photoId)) {
      expect(shape?.hasFormats, name).toBe(true);
    }
  });

  it("geen formaten: false (niet weggelaten)", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await seedPhoto(t, s.owen);
    for (const [name, shape] of await photoShapes(t, s, p.photoId)) {
      expect(shape?.hasFormats, name).toBe(false);
    }
  });

  it("een dangling set: false, want het beeldpad geeft dan het origineel", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await seedPhoto(t, s.owen, { withFormats: true });
    await t.run((ctx) => ctx.storage.delete(p.groot!));
    for (const [name, shape] of await photoShapes(t, s, p.photoId)) {
      expect(shape?.hasFormats, name).toBe(false);
    }
  });

  it("de formaten worden vastgelegd: hasFormats en exifOrientation veranderen in dezelfde response", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await seedPhoto(t, s.owen);
    const mia = withUser(t, "user_mia");
    await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: s.A, photoId: p.photoId });

    const before = (await mia.query(api.photos.getById, { photoId: p.photoId })) as R;
    expect(before.hasFormats).toBe(false);
    expect(before.exifOrientation).toBeUndefined();

    const objects = await t.run(async (ctx) => ({
      klein: await ctx.storage.store(new Blob(["k"], { type: "image/jpeg" })),
      groot: await ctx.storage.store(new Blob(["g"], { type: "image/jpeg" })),
    }));
    await t.mutation(I.photos.attachFormats, { photoId: p.photoId, ...objects, exifOrientation: 6 });

    const after = (await mia.query(api.photos.getById, { photoId: p.photoId })) as R;
    expect(after.hasFormats).toBe(true);
    expect(after.exifOrientation).toBe(6);
  });

  it("alleen een boolean: geen formaat-id in de response (WP17a invariant 10)", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await seedPhoto(t, s.owen, { withFormats: true });
    for (const [name, shape] of await photoShapes(t, s, p.photoId)) {
      const json = JSON.stringify(shape);
      for (const id of [p.storageId, p.klein!, p.groot!]) expect(json, name).not.toContain(id);
    }
  });
});

describe("profileHasFormats in de user-vorm", () => {
  async function views(t: T, s: Awaited<ReturnType<typeof setup>>) {
    const mia = withUser(t, "user_mia");
    const byId = (await mia.query(api.users.getById, { userId: s.owen })) as R;
    const member = ((await mia.query(api.groups.listMembers, { groupId: s.G })) as R[]).find(
      (m) => m.user?._id === s.owen,
    )!;
    const current = (await withUser(t, "user_owen").query(api.users.current, {})) as R;
    return [
      ["users.getById", byId],
      ["groups.listMembers", member.user],
      ["users.current", current],
    ] as [string, R][];
  }

  it("de rij van het profielpad heeft een volledige set: true", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await seedPhoto(t, s.owen, { withFormats: true, exifOrientation: 6 });
    await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: p.storageId }));
    for (const [name, u] of await views(t, s)) expect(u?.profileHasFormats, name).toBe(true);
  });

  it("geen profielfoto, een los beeld, een rij zonder of met een dangling set: false", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    for (const [name, u] of await views(t, s)) expect(u?.profileHasFormats, `geen: ${name}`).toBe(false);

    const loose = await t.run((ctx) => ctx.storage.store(new Blob(["LOS"], { type: "image/jpeg" })));
    await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: loose }));
    for (const [name, u] of await views(t, s)) expect(u?.profileHasFormats, `los: ${name}`).toBe(false);

    const bare = await seedPhoto(t, s.owen);
    await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: bare.storageId }));
    for (const [name, u] of await views(t, s)) expect(u?.profileHasFormats, `zonder: ${name}`).toBe(false);

    const half = await seedPhoto(t, s.owen, { withFormats: true, exifOrientation: 6 });
    await t.run(async (ctx) => {
      await ctx.storage.delete(half.klein!);
      await ctx.db.patch(s.owen, { profilePhotoStorageId: half.storageId });
    });
    for (const [name, u] of await views(t, s)) expect(u?.profileHasFormats, `dangling: ${name}`).toBe(false);
  });

  it("volgt dezelfde rij als de stand: eigen rij zonder formaten, andere rij met → true, met de stand van die andere", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const own = await seedPhoto(t, s.owen, { original: "BEELD", exifOrientation: 8 });
    await t.run(async (ctx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ctx.db.insert("photos", {
        ownerId: s.mia,
        storageId: own.storageId,
        ratingCount: 0,
        createdAt: Date.now(),
        exifOrientation: 3,
        formats: {
          klein: await ctx.storage.store(new Blob(["klein van MIA"], { type: "image/jpeg" })),
          groot: await ctx.storage.store(new Blob(["groot van MIA"], { type: "image/jpeg" })),
        },
      } as any);
      await ctx.db.patch(s.owen, { profilePhotoStorageId: own.storageId });
    });

    for (const [name, u] of await views(t, s)) {
      expect(u?.profileHasFormats, name).toBe(true);
      expect(u?.profileOrientation, name).toBe(3);
    }
  });
});
