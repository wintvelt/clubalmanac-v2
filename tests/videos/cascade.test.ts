import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { deleteAccount } from "../_helpers/deleteAccount";
import { as, DAY_MS, newT, outcome, seedVideo, seedWorld, start, useVideosEnv, type T } from "./_videos";

// WP37 — weg is weg, ook in R2 (invariant 6, A-invariant 21).
// Elk pad dat de rij wist, haalt ook het object in R2 weg (en, zoals nu, de
// poster en zijn formaten uit storage). Uit een album halen wist niets.
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §A-invarianten.

const env = useVideosEnv();

async function settle(t: T) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function storageCount(t: T): Promise<number> {
  return await t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);
}

describe("verwijderen haalt het filmpje uit R2", () => {
  it("photos.remove door de eigenaar: DELETE op de sleutel, poster weg, rij weg", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const v = await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie, key: "videos/een.mp4" });
    const other = await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie, key: "videos/twee.mp4" });
    await as.alice(t).mutation(api.photos.remove, { photoId: v.photoId });
    await settle(t);
    expect(env.r2.deletes()).toEqual(["videos/een.mp4"]);
    expect(env.r2.objects.has("videos/een.mp4")).toBe(false);
    expect(env.r2.objects.has(other.key)).toBe(true);
    expect(await t.run(async (ctx) => ctx.db.get(v.photoId))).toBeNull();
    expect(await t.run(async (ctx) => ctx.db.system.get(v.posterId))).toBeNull();
    expect(await storageCount(t)).toBe(1);
    for (const c of env.r2.calls) expect(c.signed).toBe(true);
  });

  it("een ander mag het niet verwijderen; dan blijft alles", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const v = await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie });
    const o = await outcome(() => as.bob(t).mutation(api.photos.remove, { photoId: v.photoId }));
    expect("err" in o).toBe(true);
    await settle(t);
    expect(env.r2.deletes()).toEqual([]);
    expect(env.r2.objects.has(v.key)).toBe(true);
  });

  it("de webmaster verwijdert een gemeld filmpje (photos.removeFlagged)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const v = await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie, flagged: true });
    await as.wm(t).mutation(api.photos.removeFlagged, { photoId: v.photoId });
    await settle(t);
    expect(env.r2.deletes()).toEqual([v.key]);
    expect(env.r2.objects.size).toBe(0);
  });

  it("de opruimronde na 14 dagen (FL1)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const v = await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie, flagged: true });
    vi.setSystemTime(Date.now() + 15 * DAY_MS);
    await t.mutation(internal.photos.cleanupFlaggedPhotos, {});
    await settle(t);
    expect(env.r2.deletes()).toEqual([v.key]);
  });

  it("account verwijderen haalt al zijn filmpjes uit R2, niet die van een ander", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const a1 = await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie, key: "videos/a1.mp4" });
    const a2 = await seedVideo(t, env.r2, { ownerId: w.users.alice, key: "videos/a2.mp4" });
    const b1 = await seedVideo(t, env.r2, { ownerId: w.users.bob, albumId: w.albums.georgie, key: "videos/b1.mp4" });
    await deleteAccount(t, as.alice(t));
    await settle(t);
    expect(env.r2.deletes().sort()).toEqual([a1.key, a2.key].sort());
    expect([...env.r2.objects.keys()]).toEqual([b1.key]);
  });

  it("een open video-upload van wie zijn account verwijdert: ook dat object weg", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run(async (ctx) =>
      ctx.db.insert("uploadIdempotency", {
        ownerId: w.users.alice,
        clientUploadId: "open-1",
        status: "in_progress",
        createdAt: Date.now(),
        videoKey: "videos/half.mp4",
      } as never),
    );
    env.r2.put("videos/half.mp4", new Uint8Array(100));
    await deleteAccount(t, as.alice(t));
    await settle(t);
    expect(env.r2.deletes()).toContain("videos/half.mp4");
    expect(env.r2.objects.size).toBe(0);
  });

  it("account verwijderen wist zijn rijen in videoUploadRequests (de daggrens), niet die van een ander (fixronde 3)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    for (const id of ["a", "b", "c"]) await start(as.alice(t), { uploadId: id, albumId: w.albums.georgie });
    await start(as.bob(t), { uploadId: "a", albumId: w.albums.georgie });
    const requestsOf = async (ownerId: unknown) =>
      (await t.run(async (ctx) => ctx.db.query("videoUploadRequests" as never).collect())).filter(
        (r) => (r as { ownerId: unknown }).ownerId === ownerId,
      ).length;
    expect(await requestsOf(w.users.alice), "sanity: de aanvragen van alice zijn geteld").toBe(3);
    await deleteAccount(t, as.alice(t));
    await settle(t);
    expect(await requestsOf(w.users.alice)).toBe(0);
    expect(await requestsOf(w.users.bob)).toBe(1);
  });

  it("R2 onbereikbaar bij het wissen: de rij is toch weg (de R2-check ziet het wees-object)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const v = await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie });
    env.r2.down = true;
    await as.alice(t).mutation(api.photos.remove, { photoId: v.photoId });
    await settle(t);
    expect(await t.run(async (ctx) => ctx.db.get(v.photoId))).toBeNull();
    env.r2.down = false;
    expect(env.r2.objects.has(v.key)).toBe(true);
  });
});

describe("uit een album halen wist niets", () => {
  it("albums.removePhoto laat rij en object staan", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const v = await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie });
    await as.alice(t).mutation(api.albums.removePhoto, { albumId: w.albums.georgie, photoId: v.photoId });
    await settle(t);
    expect(env.r2.deletes()).toEqual([]);
    expect(await t.run(async (ctx) => ctx.db.get(v.photoId))).not.toBeNull();
  });
});
