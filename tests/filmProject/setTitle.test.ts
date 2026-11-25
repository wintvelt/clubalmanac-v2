import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { newT } from "../videos/_videos";
import {
  asFilm,
  expectCode,
  filmApi,
  newVideoInX,
  openProject,
  outcome,
  PROJECT_TITLE,
  seedFilmWorld,
  sendOriginal,
  useFilmEnv,
} from "./_film";

// Besluit 27, open vraag 1 (Wouter, 2026-11-25: ja): de oprichter wijzigt de
// titel achteraf (`filmProjects.setTitle`).
//   - Toegang zoals `setEndsAt`: alleen de oprichter op het moment van het
//     verzoek; een admin of lid NOT_ALLOWED; wie geen lid is, een onbekend of
//     ongeldig project NOT_MEMBER; uitgelogd een weigering.
//   - De titelregels van `open` (lib/names.ts): getrimd, 1 tot 50 tekens, geen
//     onzichtbare tekens (NAME_REQUIRED, NAME_TOO_LONG, NAME_INVALID). Een
//     weigering verandert niets.
//   - A-keuze: ook na sluiten, zolang het project bestaat. De titel verandert
//     niets aan insturen of opruimen; een gesloten project staat nog tot een
//     jaar op de projectpagina, de downloadpagina en in de herinnering, en
//     juist dan valt een tikfout op. Dus geen PROJECT_CLOSED (anders dan
//     `setEndsAt`).
//   - Een project van vóór besluit 27 (alleen dev, zonder titel) krijgt zo een
//     eigen titel in plaats van de albumnaam.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Besluit 27 (A).

const env = useFilmEnv();
const DAY = 24 * 60 * 60 * 1000;

describe("filmProjects.setTitle: de oprichter", () => {
  it("wijzigt de titel, getrimd; overal de nieuwe titel", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    expect(await asFilm.alice(t).mutation(filmApi.setTitle, { projectId, title: "  Reis naar Georgië  " })).toBeNull();
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project.title).toBe("Reis naar Georgië");
    expect((await asFilm.bob(t).query(filmApi.listForGroup, { groupId: w.groups.reis })).map((r) => r.title)).toEqual(["Reis naar Georgië"]);
    expect((await asFilm.bob(t).query(filmApi.listOpenForMe, {})).map((r) => r.title)).toEqual(["Reis naar Georgië"]);
  });

  it("ook na sluiten (A-keuze), zolang er originelen zijn en het project in de groep staat", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    await sendOriginal(asFilm.bob(t), env.orig, photoId);
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    await asFilm.alice(t).mutation(filmApi.setTitle, { projectId, title: "Georgië 2026" });
    expect(await asFilm.bob(t).query(filmApi.listForGroup, { groupId: w.groups.reis })).toEqual([
      expect.objectContaining({ projectId, title: "Georgië 2026", open: false }),
    ]);
  });

  it("verandert alleen de titel: open, einddatum en inzendingen blijven", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w, 10 * DAY);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    const before = (await asFilm.alice(t).query(filmApi.get, { projectId })).project;
    await asFilm.alice(t).mutation(filmApi.setTitle, { projectId, title: "Nieuw" });
    const after = await asFilm.alice(t).query(filmApi.get, { projectId });
    expect(after.project).toEqual({ ...before, title: "Nieuw" });
    expect(after.originals.map((o) => o.originalId)).toEqual([originalId]);
  });

  it("een project van vóór besluit 27 (zonder titel): krijgt een eigen titel in plaats van de albumnaam", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await t.run(async (ctx) =>
      ctx.db.insert("filmProjects", {
        groupId: w.groups.reis,
        albumId: w.albums.georgie,
        albumName: "Georgië",
        endsAt: Date.now() + 10 * DAY,
        openedAt: Date.now(),
      } as never),
    );
    await asFilm.alice(t).mutation(filmApi.setTitle, { projectId, title: "Clubfilm" });
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project.title).toBe("Clubfilm");
  });

  it("na overdragen: de nieuwe oprichter wel, de oude niet", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await asFilm.alice(t).mutation(api.groups.transferFounder, { groupId: w.groups.reis, userId: w.users.erik });
    expectCode(await outcome(() => asFilm.alice(t).mutation(filmApi.setTitle, { projectId, title: "Oud" })), "NOT_ALLOWED");
    await asFilm.erik(t).mutation(filmApi.setTitle, { projectId, title: "Van Erik" });
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project.title).toBe("Van Erik");
  });
});

describe("filmProjects.setTitle: wie niet mag, en titels die niet kunnen", () => {
  it("een admin die geen oprichter is, en een lid: NOT_ALLOWED; de titel blijft", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    expectCode(await outcome(() => asFilm.erik(t).mutation(filmApi.setTitle, { projectId, title: "Erik" })), "NOT_ALLOWED");
    expectCode(await outcome(() => asFilm.bob(t).mutation(filmApi.setTitle, { projectId, title: "Bob" })), "NOT_ALLOWED");
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).project.title).toBe(PROJECT_TITLE);
  });

  it("wie geen lid is, een onbekend of ongeldig project: NOT_MEMBER", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    expectCode(await outcome(() => asFilm.carol(t).mutation(filmApi.setTitle, { projectId, title: "x" })), "NOT_MEMBER");
    expectCode(await outcome(() => asFilm.dave(t).mutation(filmApi.setTitle, { projectId, title: "x" })), "NOT_MEMBER");
    expectCode(await outcome(() => asFilm.alice(t).mutation(filmApi.setTitle, { projectId: "bestaat-niet", title: "x" })), "NOT_MEMBER");
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("filmProjects", { groupId: w.groups.reis, title: "Weg", endsAt: Date.now() + DAY, openedAt: Date.now() } as never);
      await ctx.db.delete(id);
      return id;
    });
    expectCode(await outcome(() => asFilm.alice(t).mutation(filmApi.setTitle, { projectId: gone, title: "x" })), "NOT_MEMBER");
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).project.title).toBe(PROJECT_TITLE);
  });

  it("niet ingelogd: een weigering, de titel blijft", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const o = await outcome(() => t.mutation(filmApi.setTitle, { projectId, title: "x" }));
    expect("err" in o).toBe(true);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).project.title).toBe(PROJECT_TITLE);
  });

  it.each([
    ["leeg", "NAME_REQUIRED", ""],
    ["alleen spaties", "NAME_REQUIRED", "   "],
    ["51 tekens", "NAME_TOO_LONG", "x".repeat(51)],
    ["een tab", "NAME_INVALID", "Reis\tGeorgië"],
  ])("een titel die niet kan (%s): %s, de titel blijft", async (_name, code, title) => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    expectCode(await outcome(() => asFilm.alice(t).mutation(filmApi.setTitle, { projectId, title })), code);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).project.title).toBe(PROJECT_TITLE);
  });

  it("50 tekens mag", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await asFilm.alice(t).mutation(filmApi.setTitle, { projectId, title: "y".repeat(50) });
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).project.title).toBe("y".repeat(50));
  });
});
