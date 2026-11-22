import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { newT, type T } from "../videos/_videos";
import { announce, asFilm, filmApi, flush, newVideoInX, openProject, ORIGINAL, seedFilmWorld, sendOriginal, useFilmEnv } from "./_film";

// WP38a + WP10 (regie): de filmprojecten en inzendingen staan in de
// integriteitscheck (`MONITORED_FKS`; de lijst zelf staat in
// tests/migration/fkOracle.ts). Twee kanten:
//   - een gewone levensloop (openen, insturen, sluiten, het filmalbum na
//     sluiten verwijderen, terugtrekken, vertrek, groep weg) laat geen losse
//     verwijzing achter: de check blijft schoon;
//   - een losse verwijzing in een van de nieuwe tabellen meldt hij wel.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §A-invarianten (12, 17).

const env = useFilmEnv();

const report = (t: T) => t.query(internal.migration.integrityReport, {});

async function world(t: T) {
  const w = await seedFilmWorld(t);
  const projectId = await openProject(t, w);
  const bobVideo = await newVideoInX(t, env.r2, w, w.users.bob);
  const bobOriginal = await sendOriginal(asFilm.bob(t), env.orig, bobVideo);
  const aliceVideo = await newVideoInX(t, env.r2, w, w.users.alice);
  const alicePending = await announce(asFilm.alice(t), aliceVideo, ORIGINAL.byteLength * 2 + 64 * 1024 * 1024);
  return { w, projectId, bobVideo, bobOriginal, aliceVideo, alicePending };
}

describe("de integriteitscheck blijft schoon bij een gewone levensloop", () => {
  it("open project met een origineel binnen en een onderweg", async () => {
    const t = newT();
    await world(t);
    expect(await report(t)).toEqual([]);
  });

  it("gesloten, en daarna het filmalbum verwijderd (besluit 17): het project wijst niet naar een album dat er niet is", async () => {
    const t = newT();
    const s = await world(t);
    await asFilm.alice(t).mutation(filmApi.close, { projectId: s.projectId });
    await asFilm.alice(t).mutation(api.albums.remove, { albumId: s.w.albums.georgie });
    await flush(t);
    expect(await report(t)).toEqual([]);
  });

  it("vertrek, het filmpje verwijderen en de groep verwijderen", async () => {
    const t = newT();
    const s = await world(t);
    await asFilm.alice(t).mutation(api.photos.remove, { photoId: s.aliceVideo });
    await asFilm.bob(t).mutation(api.groups.removeMember, { groupId: s.w.groups.reis, userId: s.w.users.bob });
    await flush(t);
    expect(await report(t)).toEqual([]);
    await asFilm.alice(t).mutation(api.groups.remove, { groupId: s.w.groups.reis });
    await flush(t);
    expect(await report(t)).toEqual([]);
  });
});

describe("een losse verwijzing in de nieuwe tabellen meldt de check", () => {
  it("een inzending waarvan het filmpje weg is (buiten de wis-paden om)", async () => {
    const t = newT();
    const s = await world(t);
    await t.run(async (ctx) => {
      await ctx.db.delete(s.bobVideo);
    });
    const lines = await report(t);
    expect(lines.some((l) => l.includes("filmOriginals") && l.includes("photoId")), JSON.stringify(lines)).toBe(true);
  });

  it("een project waarvan het album weg is maar nog wel genoemd wordt", async () => {
    const t = newT();
    const s = await world(t);
    await t.run(async (ctx) => {
      await ctx.db.delete(s.w.albums.georgie);
    });
    const lines = await report(t);
    expect(lines.some((l) => l.includes("filmProjects") && l.includes("albumId")), JSON.stringify(lines)).toBe(true);
  });

  it("een project en inzendingen waarvan de groep weg is", async () => {
    const t = newT();
    const s = await world(t);
    await t.run(async (ctx) => {
      await ctx.db.delete(s.w.groups.reis);
    });
    const lines = await report(t);
    expect(lines.some((l) => l.includes("filmProjects") && l.includes("groupId")), JSON.stringify(lines)).toBe(true);
    expect(lines.some((l) => l.includes("filmOriginals") && l.includes("groupId")), JSON.stringify(lines)).toBe(true);
  });
});
