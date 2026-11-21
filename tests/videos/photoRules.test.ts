import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { bytesOf, exifGps, GPS_JPEG, isJpeg } from "../_helpers/jpeg";
import { as, newT, outcome, seedPhoto, seedVideo, seedWorld, useVideosEnv, type R, type T } from "./_videos";

// WP37 — een filmpje is een rij in `photos` met `video` (A-keuze, vraag 8).
//   A-invariant 19: in een antwoord alleen `video: { durationMs }`.
//   A-invariant 27: een foto heeft geen `video`-veld, ook geen leeg.
//   A-invariant 15: de poster is het beeld van de rij (beeldpad, zonder GPS).
//   A-invariant 16, invariant 9: niet draaien, geen profielfoto (twee paden);
//   cover, melden en de kaart wel.
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §A-invarianten.

const env = useVideosEnv();
const SECRET_KEY = "videos/geheim-pad-0123456789.mp4";

async function world(t: T) {
  const w = await seedWorld(t);
  const video = await seedVideo(t, env.r2, {
    ownerId: w.users.alice,
    albumId: w.albums.georgie,
    key: SECRET_KEY,
    durationMs: 42_000,
    latitude: 41.7151,
    longitude: 44.8271,
    takenAt: Date.UTC(2026, 6, 14, 15, 32, 10),
  });
  const photoId = await seedPhoto(t, w.users.alice, w.albums.georgie);
  return { ...w, video, photoId };
}

function expectNoKey(value: unknown) {
  const json = JSON.stringify(value);
  expect(json).not.toContain(SECRET_KEY);
  expect(json).not.toContain("geheim-pad");
  expect(json).not.toMatch(/"bytes"/);
  expect(json).not.toMatch(/"key"/);
}

describe("de vorm (A-invariant 19, 27)", () => {
  it("photos.getById: een filmpje heeft video.durationMs, verder niets van R2", async () => {
    const t = newT();
    const w = await world(t);
    const v = (await as.bob(t).query(api.photos.getById, { photoId: w.video.photoId })) as R;
    expect(v.video).toEqual({ durationMs: 42_000 });
    expectNoKey(v);
  });

  it("photos.getById: een foto heeft geen video-veld", async () => {
    const t = newT();
    const w = await world(t);
    const p = (await as.bob(t).query(api.photos.getById, { photoId: w.photoId })) as R;
    expect("video" in p).toBe(false);
  });

  it("photos.getWithOwner", async () => {
    const t = newT();
    const w = await world(t);
    const v = (await as.bob(t).query(api.photos.getWithOwner, { photoId: w.video.photoId })) as R;
    expect(v.video).toEqual({ durationMs: 42_000 });
    expectNoKey(v);
  });

  it("albums.listPhotos: filmpje en foto door elkaar, alleen het filmpje met video", async () => {
    const t = newT();
    const w = await world(t);
    const rows = (await as.bob(t).query(api.albums.listPhotos, { albumId: w.albums.georgie })) as R[];
    const byId = new Map(rows.map((r) => [r.photo._id, r.photo]));
    expect(byId.get(w.video.photoId).video).toEqual({ durationMs: 42_000 });
    expect("video" in byId.get(w.photoId)).toBe(false);
    expectNoKey(rows);
  });

  it("photos.listMine (Mijn foto's, besluit B8)", async () => {
    const t = newT();
    const w = await world(t);
    const res = (await as.alice(t).query(api.photos.listMine, { paginationOpts: { numItems: 10, cursor: null } })) as R;
    const v = res.page.find((p: R) => p._id === w.video.photoId);
    expect(v.video).toEqual({ durationMs: 42_000 });
    expectNoKey(res);
  });

  it("de meldwachtrij van de webmaster toont het filmpje als filmpje", async () => {
    const t = newT();
    const w = await world(t);
    await as.bob(t).mutation(api.photos.flag, { photoId: w.video.photoId, reason: "test" });
    const list = (await as.wm(t).query(api.photos.listAllFlagged, {})) as R[];
    const found = JSON.stringify(list);
    expect(found).toContain(w.video.photoId);
    expectNoKey(list);
  });
});

describe("de kaart en de datum (invariant 3)", () => {
  it("albums.listLocations: een filmpje met plaats staat op de kaart", async () => {
    const t = newT();
    const w = await world(t);
    const spots = (await as.bob(t).query(api.albums.listLocations, { albumId: w.albums.georgie })) as R[];
    expect(spots).toContainEqual({ photoId: w.video.photoId, latitude: 41.7151, longitude: 44.8271 });
  });

  it("takenAt staat in de vorm, zoals bij een foto", async () => {
    const t = newT();
    const w = await world(t);
    const v = (await as.bob(t).query(api.photos.getById, { photoId: w.video.photoId })) as R;
    expect(v.takenAt).toBe(Date.UTC(2026, 6, 14, 15, 32, 10));
  });
});

describe("de poster via het beeldpad (A-invariant 15)", () => {
  it("een lid krijgt de poster (JPEG) op /beeld/foto/<id>; een niet-lid een 404", async () => {
    const t = newT();
    const w = await world(t);
    const ok = await as.bob(t).fetch(`/beeld/foto/${w.video.photoId}`);
    expect(ok.status).toBe(200);
    expect(isJpeg(await bytesOf(ok))).toBe(true);
    expect((await as.carol(t).fetch(`/beeld/foto/${w.video.photoId}`)).status).toBe(404);
  });

  it("een poster met GPS gaat zonder GPS naar buiten", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const v = await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie, poster: GPS_JPEG });
    const res = await as.bob(t).fetch(`/beeld/foto/${v.photoId}`);
    expect(res.status).toBe(200);
    expect(exifGps(await bytesOf(res)).hasGps).toBe(false);
  });

  it("het beeldpad stuurt nooit naar R2", async () => {
    const t = newT();
    const w = await world(t);
    await as.bob(t).fetch(`/beeld/foto/${w.video.photoId}`);
    expect(env.r2.calls).toEqual([]);
  });
});

describe("wat niet bij een filmpje past (A-invariant 16, invariant 9)", () => {
  it("photos.rotate wordt geweigerd, ook voor de eigenaar; de rij verandert niet", async () => {
    const t = newT();
    const w = await world(t);
    const before = await t.run(async (ctx) => ctx.db.get(w.video.photoId));
    const o = await outcome(() => as.alice(t).mutation(api.photos.rotate, { photoId: w.video.photoId, rotation: 90, flipY: false }));
    expect("err" in o).toBe(true);
    expect(await t.run(async (ctx) => ctx.db.get(w.video.photoId))).toEqual(before);
  });

  it("users.setProfilePhoto met een filmpje wordt geweigerd (eigenaar en lid)", async () => {
    const t = newT();
    const w = await world(t);
    for (const who of [as.alice(t), as.bob(t)]) {
      const o = await outcome(() => who.mutation(api.users.setProfilePhoto, { photoId: w.video.photoId }));
      expect("err" in o).toBe(true);
    }
    const users = await t.run(async (ctx) => Promise.all([ctx.db.get(w.users.alice), ctx.db.get(w.users.bob)]));
    for (const u of users) expect(u!.profilePhotoStorageId).toBeUndefined();
  });

  it("users.updateProfile met de poster van een eigen filmpje wordt geweigerd", async () => {
    const t = newT();
    const w = await world(t);
    const o = await outcome(() => as.alice(t).mutation(api.users.updateProfile, { profilePhotoStorageId: w.video.posterId }));
    expect("err" in o).toBe(true);
    expect((await t.run(async (ctx) => ctx.db.get(w.users.alice)))!.profilePhotoStorageId).toBeUndefined();
  });

  it("een gewone foto als profielfoto blijft werken", async () => {
    const t = newT();
    const w = await world(t);
    await as.bob(t).mutation(api.users.setProfilePhoto, { photoId: w.photoId });
    expect((await t.run(async (ctx) => ctx.db.get(w.users.bob)))!.profilePhotoStorageId).toBeDefined();
  });

  it("als album- en groepscover mag het wel (besluit B6)", async () => {
    const t = newT();
    const w = await world(t);
    await as.alice(t).mutation(api.albums.update, { albumId: w.albums.georgie, coverPhotoId: w.video.photoId });
    await as.alice(t).mutation(api.groups.update, { groupId: w.groups.reis, coverPhotoId: w.video.photoId });
    const [album, group] = await t.run(async (ctx) => Promise.all([ctx.db.get(w.albums.georgie), ctx.db.get(w.groups.reis)]));
    expect(album!.coverPhotoId).toBe(w.video.photoId);
    expect(group!.coverPhotoId).toBe(w.video.photoId);
  });

  it("melden mag wel", async () => {
    const t = newT();
    const w = await world(t);
    await as.bob(t).mutation(api.photos.flag, { photoId: w.video.photoId, reason: "past niet" });
    expect((await t.run(async (ctx) => ctx.db.get(w.video.photoId)))!.flaggedAt).toBeDefined();
  });
});
