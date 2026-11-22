import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { newT } from "../videos/_videos";
import { asFilm, expectCode, filmApi, openProject, outcome, seedFilmWorld, useFilmEnv } from "./_film";

// WP38a — project openen en sluiten (besluit 1, invariant 1, A-invariant 1).
// Alleen de oprichter (`groups.createdBy`, op het moment van het verzoek); een
// admin of lid krijgt NOT_ALLOWED, wie geen lid is NOT_MEMBER (zoals de
// beheerpaden van WP28). Het filmalbum hoort bij de groep; de einddatum ligt
// in de toekomst; hooguit één open project per groep.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §A-invarianten.

useFilmEnv();
const DAY = 24 * 60 * 60 * 1000;

describe("filmProjects.open", () => {
  it("de oprichter zet een project open; elk lid ziet het in de groep", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const endsAt = Date.now() + 14 * DAY;
    const projectId = await asFilm.alice(t).mutation(filmApi.open, { groupId: w.groups.reis, albumId: w.albums.georgie, endsAt });
    expect(typeof projectId).toBe("string");
    const rows = await asFilm.bob(t).query(filmApi.listForGroup, { groupId: w.groups.reis });
    expect(rows).toEqual([{ projectId, albumId: w.albums.georgie, albumName: "Georgië", endsAt, open: true }]);
    expect(await asFilm.bob(t).query(filmApi.listOpenForMe, {})).toEqual([
      { groupId: w.groups.reis, projectId, albumId: w.albums.georgie, albumName: "Georgië", endsAt },
    ]);
  });

  it("een admin die geen oprichter is, en een lid: NOT_ALLOWED; niets aangemaakt", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const args = { groupId: w.groups.reis, albumId: w.albums.georgie, endsAt: Date.now() + DAY };
    expectCode(await outcome(() => asFilm.erik(t).mutation(filmApi.open, args)), "NOT_ALLOWED");
    expectCode(await outcome(() => asFilm.bob(t).mutation(filmApi.open, args)), "NOT_ALLOWED");
    expect(await asFilm.alice(t).query(filmApi.listForGroup, { groupId: w.groups.reis })).toEqual([]);
  });

  it("wie geen lid is, of een groep die er niet meer is: NOT_MEMBER", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const args = { groupId: w.groups.reis, albumId: w.albums.georgie, endsAt: Date.now() + DAY };
    expectCode(await outcome(() => asFilm.carol(t).mutation(filmApi.open, args)), "NOT_MEMBER");
    expectCode(await outcome(() => asFilm.dave(t).mutation(filmApi.open, args)), "NOT_MEMBER");
    const gone = await t.run(async (ctx) => {
      const g = await ctx.db.insert("groups", { name: "Weg", createdBy: w.users.alice, createdAt: Date.now() });
      await ctx.db.delete(g);
      return g;
    });
    expectCode(
      await outcome(() => asFilm.alice(t).mutation(filmApi.open, { groupId: gone, albumId: w.albums.georgie, endsAt: Date.now() + DAY })),
      "NOT_MEMBER",
    );
  });

  it("niet ingelogd: een weigering, geen project", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const o = await outcome(() => t.mutation(filmApi.open, { groupId: w.groups.reis, albumId: w.albums.georgie, endsAt: Date.now() + DAY }));
    expect("err" in o).toBe(true);
    expect(await asFilm.alice(t).query(filmApi.listForGroup, { groupId: w.groups.reis })).toEqual([]);
  });

  it("een album van een andere groep als filmalbum: NOT_MEMBER", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    // dave is oprichter van Ander, maar Georgië is van Reis.
    expectCode(
      await outcome(() => asFilm.dave(t).mutation(filmApi.open, { groupId: w.groups.ander, albumId: w.albums.georgie, endsAt: Date.now() + DAY })),
      "NOT_MEMBER",
    );
    expect(await asFilm.dave(t).query(filmApi.listForGroup, { groupId: w.groups.ander })).toEqual([]);
  });

  it("een einddatum in het verleden of nu: DATE_INVALID", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    for (const endsAt of [Date.now() - DAY, Date.now()]) {
      expectCode(
        await outcome(() => asFilm.alice(t).mutation(filmApi.open, { groupId: w.groups.reis, albumId: w.albums.georgie, endsAt })),
        "DATE_INVALID",
      );
    }
    expect(await asFilm.alice(t).query(filmApi.listForGroup, { groupId: w.groups.reis })).toEqual([]);
  });

  it("hooguit één open project per groep: de tweede is PROJECT_ALREADY_OPEN, ook met een ander album", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const first = await openProject(t, w);
    expectCode(
      await outcome(() =>
        asFilm.alice(t).mutation(filmApi.open, { groupId: w.groups.reis, albumId: w.albums.tbilisi, endsAt: Date.now() + DAY }),
      ),
      "PROJECT_ALREADY_OPEN",
    );
    const rows = await asFilm.alice(t).query(filmApi.listForGroup, { groupId: w.groups.reis });
    expect(rows.map((r) => r.projectId)).toEqual([first]);
  });

  it("een open project in een andere groep staat los", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const other = await asFilm.dave(t).mutation(filmApi.open, { groupId: w.groups.ander, albumId: w.albums.elders, endsAt: Date.now() + DAY });
    expect((await asFilm.dave(t).query(filmApi.listForGroup, { groupId: w.groups.ander })).map((r) => r.projectId)).toEqual([other]);
    // bob is alleen lid van Reis: hij ziet alleen dat project.
    expect((await asFilm.bob(t).query(filmApi.listOpenForMe, {})).map((r) => r.groupId)).toEqual([w.groups.reis]);
    expect(await asFilm.carol(t).query(filmApi.listOpenForMe, {})).toEqual([]);
  });
});

describe("filmProjects.close", () => {
  it("alleen de oprichter sluit; daarna geen open project meer en kan er een nieuw open", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    expectCode(await outcome(() => asFilm.erik(t).mutation(filmApi.close, { projectId })), "NOT_ALLOWED");
    expectCode(await outcome(() => asFilm.bob(t).mutation(filmApi.close, { projectId })), "NOT_ALLOWED");
    expectCode(await outcome(() => asFilm.carol(t).mutation(filmApi.close, { projectId })), "NOT_MEMBER");
    expect((await asFilm.bob(t).query(filmApi.listOpenForMe, {})).length).toBe(1);

    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    expect(await asFilm.bob(t).query(filmApi.listOpenForMe, {})).toEqual([]);
    // Gesloten en zonder originelen: niet meer in de groep (A-invariant 11).
    expect(await asFilm.bob(t).query(filmApi.listForGroup, { groupId: w.groups.reis })).toEqual([]);
    // Nog een keer sluiten verandert niets.
    await asFilm.alice(t).mutation(filmApi.close, { projectId });

    const next = await asFilm.alice(t).mutation(filmApi.open, { groupId: w.groups.reis, albumId: w.albums.tbilisi, endsAt: Date.now() + DAY });
    expect(next).not.toBe(projectId);
    expect((await asFilm.bob(t).query(filmApi.listOpenForMe, {})).map((r) => r.albumName)).toEqual(["Tbilisi"]);
  });

  it("de rechten volgen de oprichter op het moment van het verzoek (na overdragen)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await asFilm.alice(t).mutation(api.groups.transferFounder, { groupId: w.groups.reis, userId: w.users.erik });
    expectCode(await outcome(() => asFilm.alice(t).mutation(filmApi.close, { projectId })), "NOT_ALLOWED");
    await asFilm.erik(t).mutation(filmApi.close, { projectId });
    expect(await asFilm.alice(t).query(filmApi.listOpenForMe, {})).toEqual([]);
  });
});

describe("lezen: alleen leden", () => {
  it("listForGroup en get geven wie geen lid is NOT_MEMBER", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    expectCode(await outcome(() => asFilm.carol(t).query(filmApi.listForGroup, { groupId: w.groups.reis })), "NOT_MEMBER");
    expectCode(await outcome(() => asFilm.dave(t).query(filmApi.get, { projectId })), "NOT_MEMBER");
    const view = await asFilm.bob(t).query(filmApi.get, { projectId });
    expect(view.project).toMatchObject({ projectId, groupId: w.groups.reis, albumId: w.albums.georgie, albumName: "Georgië", open: true });
    expect(view.isFounder).toBe(false);
    expect(view.originals).toEqual([]);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).isFounder).toBe(true);
    expect((await asFilm.erik(t).query(filmApi.get, { projectId })).isFounder).toBe(false);
  });
});
