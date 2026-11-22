import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { deleteAccount } from "../_helpers/deleteAccount";
import { newT } from "../videos/_videos";
import {
  advance,
  albumsOf,
  announce,
  asFilm,
  expectCode,
  filmApi,
  filmInternal,
  newVideoInX,
  openProject,
  ORIGINAL,
  outcome,
  seedFilmWorld,
  sendOriginal,
  settle,
  useFilmEnv,
  YEAR_MS,
  type FilmWorld,
} from "./_film";

// WP38a — weg is weg, ook in R2 (besluit 5, 9; invariant 6; A-invariant 10,
// 11, 12). Terugtrekken (de inzender), verwijderen (de oprichter: één of
// alles), een jaar na binnenkomst, groep verwijderen en account verwijderen
// halen de inzending weg, met het object in R2 en een open upload. Het
// filmpje in het album blijft. "Uit album" raakt de inzending niet.
// Niet hier (besluit voor Wouter): vertrek uit de groep (12), het filmpje in
// het album verwijderen (16).
// Spec: docs/work-packages/WP38-filmproject-originelen.md §A-invarianten.

const env = useFilmEnv();
const HOUR = 60 * 60 * 1000;

async function binnen(t: ReturnType<typeof newT>, w: FilmWorld, owner: "bob" | "alice") {
  const photoId = await newVideoInX(t, env.r2, w, w.users[owner]);
  const originalId = await sendOriginal(asFilm[owner](t), env.orig, photoId);
  return { photoId, originalId };
}

async function onderweg(t: ReturnType<typeof newT>, w: FilmWorld, owner: "bob" | "alice") {
  const photoId = await newVideoInX(t, env.r2, w, w.users[owner]);
  const s = await announce(asFilm[owner](t), photoId, ORIGINAL.byteLength * 2 + 64 * 1024 * 1024);
  return { photoId, originalId: s.originalId };
}

async function idsIn(t: ReturnType<typeof newT>, projectId: string): Promise<string[]> {
  return (await asFilm.alice(t).query(filmApi.get, { projectId })).originals.map((o) => o.originalId).sort();
}

describe("terugtrekken (besluit 5)", () => {
  it("de inzender trekt een origineel terug dat binnen is: weg uit de lijst en uit R2; het filmpje blijft in X", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const b = await binnen(t, w, "bob");
    expect(env.orig.keys()).toHaveLength(1);
    await asFilm.bob(t).mutation(filmApi.withdraw, { originalId: b.originalId });
    expect(await idsIn(t, projectId)).toEqual([]);
    await settle(t);
    expect(env.orig.keys()).toEqual([]);
    expect(await albumsOf(t, b.photoId)).toEqual([w.albums.georgie]);
  });

  it("terugtrekken terwijl hij onderweg is: de upload in R2 wordt afgebroken", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const o = await onderweg(t, w, "bob");
    expect(env.orig.uploads.size).toBe(1);
    await asFilm.bob(t).mutation(filmApi.withdraw, { originalId: o.originalId });
    await settle(t);
    expect(env.orig.uploads.size).toBe(0);
    expect(env.orig.keys()).toEqual([]);
    expect(await idsIn(t, projectId)).toEqual([]);
  });

  it("een ander (ook de oprichter) kan niet terugtrekken: ORIGINAL_NOT_FOUND, alles blijft", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const b = await binnen(t, w, "bob");
    for (const who of [asFilm.alice, asFilm.erik, asFilm.carol]) {
      expectCode(await outcome(() => who(t).mutation(filmApi.withdraw, { originalId: b.originalId })), "ORIGINAL_NOT_FOUND");
    }
    await settle(t);
    expect(await idsIn(t, projectId)).toEqual([b.originalId]);
    expect(env.orig.keys()).toHaveLength(1);
  });

  it("'Uit album' op het filmpje in X raakt de inzending niet (besluit 4)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const b = await binnen(t, w, "bob");
    await asFilm.bob(t).mutation(api.albums.removePhoto, { albumId: w.albums.georgie, photoId: b.photoId });
    await settle(t);
    expect(await idsIn(t, projectId)).toEqual([b.originalId]);
    expect(env.orig.keys()).toHaveLength(1);
  });
});

describe("verwijderen door de oprichter (besluit 9)", () => {
  it("één origineel: weg uit lijst en R2; een admin mag het niet", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const b = await binnen(t, w, "bob");
    expectCode(await outcome(() => asFilm.erik(t).mutation(filmApi.removeOriginal, { originalId: b.originalId })), "ORIGINAL_NOT_FOUND");
    await asFilm.alice(t).mutation(filmApi.removeOriginal, { originalId: b.originalId });
    await settle(t);
    expect(await idsIn(t, projectId)).toEqual([]);
    expect(env.orig.keys()).toEqual([]);
    expect(await albumsOf(t, b.photoId)).toEqual([w.albums.georgie]);
  });

  it("alles van een project, binnen en onderweg; daarna is het gesloten project weg uit de groep", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await binnen(t, w, "bob");
    await binnen(t, w, "alice");
    await onderweg(t, w, "bob");
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    // Gesloten met originelen: nog zichtbaar (UI: na sluiten).
    expect((await asFilm.bob(t).query(filmApi.listForGroup, { groupId: w.groups.reis })).map((r) => [r.projectId, r.open])).toEqual([
      [projectId, false],
    ]);
    expectCode(await outcome(() => asFilm.erik(t).mutation(filmApi.removeAll, { projectId })), "NOT_ALLOWED");
    await asFilm.alice(t).mutation(filmApi.removeAll, { projectId });
    await settle(t);
    expect(env.orig.keys()).toEqual([]);
    expect(env.orig.uploads.size).toBe(0);
    expect(await asFilm.bob(t).query(filmApi.listForGroup, { groupId: w.groups.reis })).toEqual([]);
  });
});

describe("een jaar (besluit 9, A-invariant 11)", () => {
  it("een origineel gaat een jaar na binnenkomst weg, rij en object; niet eerder", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const b = await binnen(t, w, "bob");
    advance(YEAR_MS - HOUR);
    await t.mutation(filmInternal.expireOriginals, {});
    await settle(t);
    expect(await idsIn(t, projectId)).toEqual([b.originalId]);
    expect(env.orig.keys()).toHaveLength(1);

    advance(2 * HOUR);
    await t.mutation(filmInternal.expireOriginals, {});
    await settle(t);
    expect(await idsIn(t, projectId)).toEqual([]);
    expect(env.orig.keys()).toEqual([]);
    // Het filmpje in het album staat er nog.
    expect(await albumsOf(t, b.photoId)).toEqual([w.albums.georgie]);
  });
});

describe("cascades (A-invariant 12)", () => {
  it("groep verwijderen: projecten en originelen weg, ook in R2 (object en open upload)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    await binnen(t, w, "bob");
    await onderweg(t, w, "alice");
    await asFilm.alice(t).mutation(api.groups.remove, { groupId: w.groups.reis });
    await settle(t);
    expect(env.orig.keys()).toEqual([]);
    expect(env.orig.uploads.size).toBe(0);
    expect(await asFilm.bob(t).query(filmApi.listOpenForMe, {})).toEqual([]);
  });

  it("account verwijderen: zijn originelen weg, ook in R2; die van anderen blijven", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const mine = await binnen(t, w, "bob");
    const theirs = await binnen(t, w, "alice");
    await onderweg(t, w, "bob");
    expect(env.orig.keys()).toHaveLength(2);
    await deleteAccount(t, asFilm.bob(t));
    await settle(t);
    expect(await idsIn(t, projectId)).toEqual([theirs.originalId]);
    expect(env.orig.keys()).toHaveLength(1);
    expect(env.orig.uploads.size).toBe(0);
    expect(mine.originalId).not.toBe(theirs.originalId);
  });
});
