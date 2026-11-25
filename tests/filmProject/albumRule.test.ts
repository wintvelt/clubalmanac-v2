import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { finish, fullUpload, newT, PLAIN, POSTER, putAsApp, seedVideo, start } from "../videos/_videos";
import {
  advance,
  albumsOf,
  asFilm,
  filmApi,
  MINUTE_MS,
  newVideoInX,
  openProject,
  seedFilmWorld,
  sendOriginal,
  useFilmEnv,
} from "./_film";

// Besluit 27 (Wouter, 2026-11-25, na build 89): alles wat het lid kiest, gaat
// naar het album dat het lid kiest, ook filmpjes. De backend leidt niets meer
// om (vervangt besluit 2 en A-invariant 2). Staat er in de groep een project
// open, dan mag van elk nieuw filmpje in elk album van die groep het origineel
// mee (A-invariant 3, besluit 27.2).
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Besluit 27 (A).

const env = useFilmEnv();

async function photoIdOf(res: Response): Promise<Id<"photos">> {
  expect(res.status).toBe(200);
  return ((await res.json()) as { photoId: Id<"photos"> }).photoId;
}

describe("een nieuw filmpje in een groep met een open project: in het gekozen album", () => {
  it("album Y (niet het album waar het project ooit aan hing): in Y", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const { res } = await fullUpload(asFilm.bob(t), env.r2, { uploadId: "naar-y", albumId: w.albums.tbilisi });
    expect(await albumsOf(t, await photoIdOf(res))).toEqual([w.albums.tbilisi]);
  });

  it("album Georgië: in Georgië", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const { res } = await fullUpload(asFilm.bob(t), env.r2, { uploadId: "naar-g", albumId: w.albums.georgie });
    expect(await albumsOf(t, await photoIdOf(res))).toEqual([w.albums.georgie]);
  });

  it("de oprichter zelf ook: in Y", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const { res } = await fullUpload(asFilm.alice(t), env.r2, { uploadId: "a-y", albumId: w.albums.tbilisi });
    expect(await albumsOf(t, await photoIdOf(res))).toEqual([w.albums.tbilisi]);
  });

  it("sluit het project tussen aanvragen en afronden: in Y", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const s = await start(asFilm.bob(t), { uploadId: "sluit-tussendoor", albumId: w.albums.tbilisi });
    expect(s.kind).toBe("upload");
    await putAsApp(env.r2, (s as { url: string }).url, PLAIN);
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    const res = await finish(asFilm.bob(t), { uploadId: "sluit-tussendoor" });
    expect(await albumsOf(t, await photoIdOf(res))).toEqual([w.albums.tbilisi]);
  });

  it("gaat het project pas open na het aanvragen: in Y", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const s = await start(asFilm.bob(t), { uploadId: "open-tussendoor", albumId: w.albums.tbilisi });
    await putAsApp(env.r2, (s as { url: string }).url, PLAIN);
    await openProject(t, w);
    const res = await finish(asFilm.bob(t), { uploadId: "open-tussendoor" });
    expect(await albumsOf(t, await photoIdOf(res))).toEqual([w.albums.tbilisi]);
  });
});

describe("het origineel van een nieuw filmpje in elk album van de groep (besluit 27.2)", () => {
  it("een nieuw filmpje in Y via het gewone upload-pad: het origineel komt binnen", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    advance(MINUTE_MS);
    const { res } = await fullUpload(asFilm.bob(t), env.r2, { uploadId: "y-origineel", albumId: w.albums.tbilisi });
    const photoId = await photoIdOf(res);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    const view = await asFilm.alice(t).query(filmApi.get, { projectId });
    expect(view.originals.map((o) => [o.originalId, o.status])).toEqual([[originalId, "binnen"]]);
  });

  it("een nieuw filmpje in Y, en ook in Georgië: één inzending", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob, { albumId: w.albums.tbilisi });
    await asFilm.bob(t).mutation(api.albums.addPhoto, { albumId: w.albums.georgie, photoId });
    await sendOriginal(asFilm.bob(t), env.orig, photoId);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals).toHaveLength(1);
  });

  it("'Uit album' haalt het filmpje uit Y; de inzending blijft (besluit 4)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob, { albumId: w.albums.tbilisi });
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    await asFilm.bob(t).mutation(api.albums.removePhoto, { albumId: w.albums.tbilisi, photoId });
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals.map((o) => o.originalId)).toEqual([originalId]);
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

  it("een foto naar Y tijdens een project: in Y", async () => {
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

  it("'Naar album' met een bestaand filmpje naar Y mag tijdens het project, zonder inzending (besluit 4)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const old = await seedVideo(t, env.r2, { ownerId: w.users.bob });
    const projectId = await openProject(t, w);
    advance(MINUTE_MS);
    await asFilm.bob(t).mutation(api.albums.addPhoto, { albumId: w.albums.tbilisi, photoId: old.photoId });
    expect(await albumsOf(t, old.photoId)).toEqual([w.albums.tbilisi]);
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).originals).toEqual([]);
  });
});
