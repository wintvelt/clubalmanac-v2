import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { fullUpload, newT } from "../videos/_videos";
import {
  advance,
  albumsOf,
  announce,
  asFilm,
  expectCode,
  expectOriginalRefusal,
  filmApi,
  MINUTE_MS,
  newVideoInX,
  openProject,
  ORIGINAL,
  outcome,
  runUntil,
  seedFilmWorld,
  useFilmEnv,
} from "./_film";

// WP38a — project openen en sluiten (besluit 1, invariant 1, A-invariant 1).
// Alleen de oprichter (`groups.createdBy`, op het moment van het verzoek); een
// admin of lid krijgt NOT_ALLOWED, wie geen lid is NOT_MEMBER (zoals de
// beheerpaden van WP28). Het filmalbum hoort bij de groep; de einddatum ligt
// in de toekomst en hooguit een jaar vooruit; hooguit één open project per
// groep; het sluit vanzelf en de oprichter mag de einddatum verschuiven
// (besluit 13).
// Spec: docs/work-packages/WP38-filmproject-originelen.md §A-invarianten.

const env = useFilmEnv();
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

// Besluit 13 (Wouter: ja en ja): het project sluit vanzelf op de einddatum, en
// de einddatum ligt hooguit een jaar vooruit. De oprichter mag hem verschuiven
// zolang het project open staat (`setEndsAt`, hieronder).
describe("einddatum (besluit 13)", () => {
  it("meer dan een jaar vooruit: DATE_INVALID; ruim binnen het jaar mag", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    expectCode(
      await outcome(() =>
        asFilm.alice(t).mutation(filmApi.open, { groupId: w.groups.reis, albumId: w.albums.georgie, endsAt: Date.now() + 400 * DAY }),
      ),
      "DATE_INVALID",
    );
    expect(await asFilm.alice(t).query(filmApi.listForGroup, { groupId: w.groups.reis })).toEqual([]);
    const projectId = await asFilm.alice(t).mutation(filmApi.open, {
      groupId: w.groups.reis,
      albumId: w.albums.georgie,
      endsAt: Date.now() + 360 * DAY,
    });
    expect((await asFilm.bob(t).query(filmApi.listOpenForMe, {})).map((r) => r.projectId)).toEqual([projectId]);
  });

  it("sluit vanzelf op de einddatum: geen open project meer, een nieuw filmpje gaat weer naar het gekozen album", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w, 2 * DAY);
    await runUntil(t, DAY);
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project.open).toBe(true);

    await runUntil(t, DAY + MINUTE_MS);
    expect(await asFilm.bob(t).query(filmApi.listOpenForMe, {})).toEqual([]);
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project.open).toBe(false);
    const { res } = await fullUpload(asFilm.bob(t), env.r2, { uploadId: "na-einde", albumId: w.albums.tbilisi });
    expect(res.status).toBe(200);
    const photoId = ((await res.json()) as { photoId: Id<"photos"> }).photoId;
    expect(await albumsOf(t, photoId)).toEqual([w.albums.tbilisi]);
    // En er kan een nieuw project open.
    await openProject(t, w);
  });

  it("ook zonder de geplande stap telt de einddatum: na het einde is het project dicht", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w, DAY);
    advance(DAY + MINUTE_MS); // klok verder, de geplande stap loopt (nog) niet
    expect(await asFilm.bob(t).query(filmApi.listOpenForMe, {})).toEqual([]);
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project.open).toBe(false);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes: 1000 })), "niet_toegestaan");
  });
});

// Besluit 13: de einddatum verschuiven zolang het project open staat. Alleen de
// oprichter (op het moment van het verzoek), dezelfde grenzen als bij openen
// (in de toekomst, hooguit een jaar vooruit vanaf nu), en de geplande sluiting
// verschuift mee: eerder of later. Een gesloten project (gesloten of de
// einddatum voorbij) verschuift niet: PROJECT_CLOSED.
describe("filmProjects.setEndsAt (besluit 13)", () => {
  it("later: het project blijft open na de oude einddatum en sluit op de nieuwe", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w, 2 * DAY);
    const later = Date.now() + 10 * DAY;
    expect(await asFilm.alice(t).mutation(filmApi.setEndsAt, { projectId, endsAt: later })).toBeNull();
    expect(await asFilm.bob(t).query(filmApi.listOpenForMe, {})).toEqual([
      { groupId: w.groups.reis, projectId, albumId: w.albums.georgie, albumName: "Georgië", endsAt: later },
    ]);
    expect((await asFilm.bob(t).query(filmApi.listForGroup, { groupId: w.groups.reis }))[0]?.endsAt).toBe(later);

    // De oude einddatum voorbij, met de geplande stappen: nog open.
    await runUntil(t, 3 * DAY);
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project).toMatchObject({ open: true, endsAt: later });
    // Een nieuw filmpje na de oude einddatum gaat nog naar X en mag insturen.
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    expect(s.parts).toHaveLength(1);
    const { res } = await fullUpload(asFilm.bob(t), env.r2, { uploadId: "na-oud-einde", albumId: w.albums.tbilisi });
    expect(await albumsOf(t, ((await res.json()) as { photoId: Id<"photos"> }).photoId)).toEqual([w.albums.georgie]);

    // De nieuwe einddatum voorbij: dicht.
    await runUntil(t, 7 * DAY + MINUTE_MS);
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project.open).toBe(false);
    expect(await asFilm.bob(t).query(filmApi.listOpenForMe, {})).toEqual([]);
  });

  it("eerder: het project sluit op de nieuwe, vroegere einddatum", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w, 10 * DAY);
    const sooner = Date.now() + 2 * DAY;
    await asFilm.alice(t).mutation(filmApi.setEndsAt, { projectId, endsAt: sooner });
    await runUntil(t, DAY);
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project).toMatchObject({ open: true, endsAt: sooner });
    await runUntil(t, DAY + MINUTE_MS);
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project.open).toBe(false);
    expect(await asFilm.bob(t).query(filmApi.listOpenForMe, {})).toEqual([]);
    // Ook voorbij de oude einddatum blijft hij dicht.
    await runUntil(t, 10 * DAY);
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project.open).toBe(false);
  });

  it("dezelfde grenzen als bij openen: in het verleden, nu of meer dan een jaar vooruit is DATE_INVALID; er verandert niets", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const endsAt = Date.now() + 14 * DAY;
    const projectId = await openProject(t, w, 14 * DAY);
    for (const bad of [Date.now() - DAY, Date.now(), Date.now() + 400 * DAY]) {
      expectCode(await outcome(() => asFilm.alice(t).mutation(filmApi.setEndsAt, { projectId, endsAt: bad })), "DATE_INVALID");
    }
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project).toMatchObject({ open: true, endsAt });
  });

  it("alleen de oprichter: een admin of lid NOT_ALLOWED, wie geen lid is of een onbekend project NOT_MEMBER, uitgelogd een weigering", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const endsAt = Date.now() + 14 * DAY;
    const projectId = await openProject(t, w, 14 * DAY);
    const args = { projectId, endsAt: Date.now() + 20 * DAY };
    expectCode(await outcome(() => asFilm.erik(t).mutation(filmApi.setEndsAt, args)), "NOT_ALLOWED");
    expectCode(await outcome(() => asFilm.bob(t).mutation(filmApi.setEndsAt, args)), "NOT_ALLOWED");
    expectCode(await outcome(() => asFilm.carol(t).mutation(filmApi.setEndsAt, args)), "NOT_MEMBER");
    expectCode(await outcome(() => asFilm.dave(t).mutation(filmApi.setEndsAt, args)), "NOT_MEMBER");
    expectCode(await outcome(() => asFilm.alice(t).mutation(filmApi.setEndsAt, { ...args, projectId: "geen-project" })), "NOT_MEMBER");
    expect("err" in (await outcome(() => t.mutation(filmApi.setEndsAt, args)))).toBe(true);
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project.endsAt).toBe(endsAt);
  });

  it("de rechten volgen de oprichter op het moment van het verzoek (na overdragen)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await asFilm.alice(t).mutation(api.groups.transferFounder, { groupId: w.groups.reis, userId: w.users.erik });
    const endsAt = Date.now() + 20 * DAY;
    expectCode(await outcome(() => asFilm.alice(t).mutation(filmApi.setEndsAt, { projectId, endsAt })), "NOT_ALLOWED");
    await asFilm.erik(t).mutation(filmApi.setEndsAt, { projectId, endsAt });
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project.endsAt).toBe(endsAt);
  });

  it("een gesloten project, of een waarvan de einddatum voorbij is: PROJECT_CLOSED, het blijft dicht", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const closed = await openProject(t, w);
    await asFilm.alice(t).mutation(filmApi.close, { projectId: closed });
    expectCode(
      await outcome(() => asFilm.alice(t).mutation(filmApi.setEndsAt, { projectId: closed, endsAt: Date.now() + 20 * DAY })),
      "PROJECT_CLOSED",
    );
    expect((await asFilm.bob(t).query(filmApi.get, { projectId: closed })).project.open).toBe(false);

    const ended = await openProject(t, w, DAY);
    advance(DAY + MINUTE_MS); // de einddatum voorbij, ook als de geplande stap nog niet liep
    expectCode(
      await outcome(() => asFilm.alice(t).mutation(filmApi.setEndsAt, { projectId: ended, endsAt: Date.now() + 20 * DAY })),
      "PROJECT_CLOSED",
    );
    expect(await asFilm.bob(t).query(filmApi.listOpenForMe, {})).toEqual([]);
  });
});
