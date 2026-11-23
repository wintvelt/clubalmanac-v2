import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { deleteAccount } from "../_helpers/deleteAccount";
import { newT, type T } from "../videos/_videos";
import {
  announce,
  asFilm,
  expectOriginalRefusal,
  filmApi,
  flush,
  newVideoInX,
  openProject,
  ORIGINAL,
  outcome,
  seedFilmWorld,
  sendOriginal,
  settle,
  useFilmEnv,
  type FilmWorld,
} from "./_film";

// WP38a fix-cyclus 2 (regie, heraudit 1 = red-team Z1) — teruggetrokken
// blijft teruggetrokken.
//   - Na terugtrekken (de inzender) of verwijderen (de oprichter: één of alle)
//     neemt de backend voor dat filmpje geen inzending meer aan, ook zolang
//     het project open is: een telefoon die na `NoSuchUpload` hervat, of een
//     ander apparaat, krijgt `niet_toegestaan`, zonder nieuwe inzending of
//     upload in R2. Andere filmpjes van dezelfde inzender gaan gewoon.
//   - `finishOriginal` na terugtrekken: `niet_toegestaan`.
//   - Gaat het filmpje of het account weg, dan gaat de markering mee: geen
//     rij verwijst nog naar het filmpje, en de integriteitscheck blijft schoon.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Fix-cyclus 2.

const env = useFilmEnv();
const BIG = ORIGINAL.byteLength * 2 + 64 * 1024 * 1024;

async function projectStillOpen(t: T, w: FilmWorld, projectId: string): Promise<void> {
  const open = await asFilm.bob(t).query(filmApi.listOpenForMe, {});
  expect(open.map((p) => p.projectId)).toEqual([projectId]);
  expect(open[0]?.groupId).toBe(w.groups.reis);
}

async function refusedForGood(t: T, photoId: Id<"photos">, bytes: number, projectId: string, createsBefore: number): Promise<void> {
  for (let i = 0; i < 2; i++) {
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes })), "niet_toegestaan");
  }
  await flush(t);
  expect(env.orig.creates()).toHaveLength(createsBefore);
  expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals).toEqual([]);
  expect(env.orig.uploads.size).toBe(0);
}

describe("na terugtrekken geen nieuwe inzending voor dat filmpje", () => {
  it("teruggetrokken terwijl hij onderweg was; R2 kent de upload niet meer (NoSuchUpload): hervatten, ook vanaf een tweede apparaat, geeft niet_toegestaan", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, BIG);
    await asFilm.bob(t).mutation(filmApi.withdraw, { originalId: s.originalId });
    await flush(t);
    // Het afbreken in R2 is gebeurd: een PUT op de oude link geeft NoSuchUpload.
    expect(env.orig.uploads.size).toBe(0);
    expect(env.orig.creates()).toHaveLength(1);
    await projectStillOpen(t, w, projectId);
    await refusedForGood(t, photoId, BIG, projectId, 1);
    await projectStillOpen(t, w, projectId);
  });

  it("teruggetrokken nadat hij binnen was: opnieuw insturen geeft niet_toegestaan", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    await asFilm.bob(t).mutation(filmApi.withdraw, { originalId });
    await flush(t);
    expect(env.orig.keys()).toEqual([]);
    await projectStillOpen(t, w, projectId);
    await refusedForGood(t, photoId, ORIGINAL.byteLength, projectId, 1);
  });

  it("de oprichter verwijdert het origineel (removeOriginal): de inzender kan het niet opnieuw insturen", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    await asFilm.alice(t).mutation(filmApi.removeOriginal, { originalId });
    await flush(t);
    await projectStillOpen(t, w, projectId);
    await refusedForGood(t, photoId, ORIGINAL.byteLength, projectId, 1);
  });

  it("de oprichter verwijdert alles (removeAll), ook wat onderweg is: niets daarvan komt terug", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const received = await newVideoInX(t, env.r2, w, w.users.bob);
    await sendOriginal(asFilm.bob(t), env.orig, received);
    const pending = await newVideoInX(t, env.r2, w, w.users.bob);
    await announce(asFilm.bob(t), pending, BIG);
    await asFilm.alice(t).mutation(filmApi.removeAll, { projectId });
    await flush(t);
    await projectStillOpen(t, w, projectId);
    expectOriginalRefusal(
      await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId: received, bytes: ORIGINAL.byteLength })),
      "niet_toegestaan",
    );
    await refusedForGood(t, pending, BIG, projectId, 2);
  });

  it("finishOriginal na terugtrekken: niet_toegestaan", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    expect(await env.orig.putPart(s.parts[0]!.url, ORIGINAL)).toBe(200);
    await asFilm.bob(t).mutation(filmApi.withdraw, { originalId: s.originalId });
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })), "niet_toegestaan");
    await flush(t);
    expect(env.orig.keys()).toEqual([]);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals).toEqual([]);
  });

  it("een ander nieuw filmpje van dezelfde inzender gaat gewoon", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const first = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), first, BIG);
    await asFilm.bob(t).mutation(filmApi.withdraw, { originalId: s.originalId });
    await flush(t);
    const second = await newVideoInX(t, env.r2, w, w.users.bob);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, second);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals.map((o) => [o.originalId, o.status])).toEqual([
      [originalId, "binnen"],
    ]);
  });
});

/** Alle rijen in alle tabellen van het schema waarin dit id voorkomt (behalve de rij zelf). */
async function rowsMentioning(t: T, id: string): Promise<string[]> {
  const tables = Object.keys((schema as unknown as { tables: Record<string, unknown> }).tables);
  return await t.run(async (ctx) => {
    const hits: string[] = [];
    for (const table of tables) {
      for (const row of await ctx.db.query(table as never).collect()) {
        const r = row as { _id: string };
        if (r._id !== id && JSON.stringify(row).includes(id)) hits.push(`${table}:${r._id}`);
      }
    }
    return hits;
  });
}

describe("de markering gaat mee met het filmpje en het account", () => {
  it("het filmpje verwijderen na terugtrekken: geen rij verwijst nog naar het filmpje; de integriteitscheck blijft schoon", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    await asFilm.bob(t).mutation(filmApi.withdraw, { originalId });
    await flush(t);
    expect(await t.query(internal.migration.integrityReport, {})).toEqual([]);
    await asFilm.bob(t).mutation(api.photos.remove, { photoId });
    await flush(t);
    expect(await t.run(async (ctx) => ctx.db.get(photoId))).toBeNull();
    expect(await rowsMentioning(t, photoId)).toEqual([]);
    expect(await t.query(internal.migration.integrityReport, {})).toEqual([]);
  });

  it("het account verwijderen na terugtrekken: geen rij verwijst nog naar zijn filmpje", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const removed = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    await asFilm.alice(t).mutation(filmApi.removeOriginal, { originalId: removed });
    await flush(t);
    await deleteAccount(t, asFilm.bob(t));
    await settle(t);
    expect(await rowsMentioning(t, photoId)).toEqual([]);
    expect(await t.query(internal.migration.integrityReport, {})).toEqual([]);
  });
});
