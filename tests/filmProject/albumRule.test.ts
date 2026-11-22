import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { finish, fullUpload, newT, PLAIN, POSTER, putAsApp, seedVideo, start } from "../videos/_videos";
import { advance, albumsOf, asFilm, filmApi, MINUTE_MS, openProject, seedFilmWorld, useFilmEnv } from "./_film";

// WP38a — de albumregel in de backend (besluit 2, invariant 2, A-invariant 2).
// Staat er in de groep een open project, dan komt elk nieuw filmpje in het
// filmalbum X, welk album van die groep ook gevraagd werd (ook door een oude
// app, antwoord 4: omleiden, niet weigeren). Beslist bij `startUpload`.
// Foto's, "Naar album" en albums van andere groepen vallen er niet onder.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §A-invarianten.

const env = useFilmEnv();

async function photoIdOf(res: Response): Promise<Id<"photos">> {
  expect(res.status).toBe(200);
  return ((await res.json()) as { photoId: Id<"photos"> }).photoId;
}

describe("een nieuw filmpje in een groep met een open project", () => {
  it("gevraagd album Y: het filmpje staat alleen in het filmalbum X", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const { res } = await fullUpload(asFilm.bob(t), env.r2, { uploadId: "naar-y", albumId: w.albums.tbilisi });
    const photoId = await photoIdOf(res);
    expect(await albumsOf(t, photoId)).toEqual([w.albums.georgie]);
  });

  it("gevraagd album X: in X", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const { res } = await fullUpload(asFilm.bob(t), env.r2, { uploadId: "naar-x", albumId: w.albums.georgie });
    expect(await albumsOf(t, await photoIdOf(res))).toEqual([w.albums.georgie]);
  });

  it("de oprichter zelf ook: Y wordt X", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const { res } = await fullUpload(asFilm.alice(t), env.r2, { uploadId: "a-y", albumId: w.albums.tbilisi });
    expect(await albumsOf(t, await photoIdOf(res))).toEqual([w.albums.georgie]);
  });

  it("beslist bij startUpload: sluit het project tussen aanvragen en afronden, dan toch X", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const s = await start(asFilm.bob(t), { uploadId: "sluit-tussendoor", albumId: w.albums.tbilisi });
    expect(s.kind).toBe("upload");
    await putAsApp(env.r2, (s as { url: string }).url, PLAIN);
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    const res = await finish(asFilm.bob(t), { uploadId: "sluit-tussendoor" });
    expect(await albumsOf(t, await photoIdOf(res))).toEqual([w.albums.georgie]);
  });

  it("beslist bij startUpload: gaat het project pas open na het aanvragen, dan blijft het Y", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const s = await start(asFilm.bob(t), { uploadId: "open-tussendoor", albumId: w.albums.tbilisi });
    await putAsApp(env.r2, (s as { url: string }).url, PLAIN);
    await openProject(t, w);
    const res = await finish(asFilm.bob(t), { uploadId: "open-tussendoor" });
    expect(await albumsOf(t, await photoIdOf(res))).toEqual([w.albums.tbilisi]);
  });
});

describe("wat er niet onder valt", () => {
  it("zonder open project (nooit, of gesloten): het gevraagde album", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const before = await photoIdOf((await fullUpload(asFilm.bob(t), env.r2, { uploadId: "voor", albumId: w.albums.tbilisi })).res);
    expect(await albumsOf(t, before)).toEqual([w.albums.tbilisi]);
    const projectId = await openProject(t, w);
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    const after = await photoIdOf((await fullUpload(asFilm.bob(t), env.r2, { uploadId: "na", albumId: w.albums.tbilisi })).res);
    expect(await albumsOf(t, after)).toEqual([w.albums.tbilisi]);
  });

  it("een foto naar Y tijdens een project: in Y (foto's gaan naar het gekozen album)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const res = await asFilm.bob(t).fetch("/upload", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "X-Upload-Id": "foto-y", "X-Album-Id": w.albums.tbilisi },
      body: POSTER as BodyInit,
    });
    expect(await albumsOf(t, await photoIdOf(res))).toEqual([w.albums.tbilisi]);
  });

  it("een filmpje naar een album van een andere groep: daar, ook als Reis een project heeft", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const { res } = await fullUpload(asFilm.dave(t), env.r2, { uploadId: "elders", albumId: w.albums.elders });
    expect(await albumsOf(t, await photoIdOf(res))).toEqual([w.albums.elders]);
  });

  it("'Naar album' met een bestaand filmpje naar Y mag tijdens het project (besluit 4)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const old = await seedVideo(t, env.r2, { ownerId: w.users.bob });
    const projectId = await openProject(t, w);
    advance(MINUTE_MS);
    await asFilm.bob(t).mutation(api.albums.addPhoto, { albumId: w.albums.tbilisi, photoId: old.photoId });
    expect(await albumsOf(t, old.photoId)).toEqual([w.albums.tbilisi]);
    // Geen inzending.
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).originals).toEqual([]);
  });
});
