import { describe, expect, it } from "vitest";
import { newT } from "../videos/_videos";
import {
  advance,
  announce,
  asFilm,
  filmApi,
  filmInternal,
  newVideoInX,
  openProject,
  ORIGINAL,
  seedFilmWorld,
  sendOriginal,
  useFilmEnv,
  YEAR_MS,
} from "./_film";

// WP38c, besluit 3 na A (Wouter, 2026-11-25): `filmProjects.get` geeft wat de
// downloadpagina toont.
//   - Per inzending de aangemelde grootte (`bytes`) en wanneer hij uiterlijk
//     weggaat (`goneAt`): een origineel dat binnen is een jaar na binnenkomst;
//     een origineel onderweg 14 dagen na het sluiten van het project (of de
//     einddatum, als die eerder is), en nooit later dan een jaar na het
//     aanmelden. Dat is wat de opruimronde doet (A-invariant 11, besluit 18).
//   - Per project de datum van sluiten (`closedAt`): `null` zolang hij open
//     is; anders het sluiten door de oprichter, of de einddatum als het
//     project vanzelf dicht ging (ook als de geplande stap nog niet liep).
//   - Wie het ziet, volgt de bestaande toegang: elk veld staat bij elke rij die
//     de caller al ziet. Geen veld alleen voor de oprichter: een grootte en een
//     datum zeggen niets over de inhoud of de plek.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Besluiten Wouter na A van 38c.

const env = useFilmEnv();
const DAY = 24 * 60 * 60 * 1000;
const AFTER_CLOSE_MS = 14 * DAY;

describe("get: de datum van sluiten (closedAt)", () => {
  it("open: null", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const v = await asFilm.bob(t).query(filmApi.get, { projectId });
    expect(v.project.open).toBe(true);
    expect(v.project.closedAt).toBeNull();
  });

  it("gesloten door de oprichter: het moment van sluiten, ook als de einddatum daarna verstrijkt", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w, 14 * DAY);
    advance(3 * DAY);
    const closedAt = Date.now();
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project).toMatchObject({ open: false, closedAt });
    advance(20 * DAY);
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project.closedAt).toBe(closedAt);
  });

  it("vanzelf dicht op de einddatum: de einddatum, ook als de geplande stap nog niet liep", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w, 5 * DAY);
    const { endsAt } = (await asFilm.alice(t).query(filmApi.get, { projectId })).project;
    advance(6 * DAY);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).project).toMatchObject({ open: false, closedAt: endsAt });
  });
});

describe("get: grootte en datum van weggaan per inzending", () => {
  it("binnen: de aangemelde grootte, en een jaar na binnenkomst", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const before = Date.now();
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    const after = Date.now();
    const row = (await asFilm.alice(t).query(filmApi.get, { projectId })).originals.find((o) => o.originalId === originalId)!;
    expect(row.bytes).toBe(ORIGINAL.byteLength);
    expect(row.goneAt).toBeGreaterThanOrEqual(before + YEAR_MS);
    expect(row.goneAt).toBeLessThanOrEqual(after + YEAR_MS);
  });

  it("binnen: 'goneAt' klopt met de opruimronde (een dag ervoor nog daar, een dag erna weg)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    const { goneAt } = (await asFilm.alice(t).query(filmApi.get, { projectId })).originals[0]!;
    advance(goneAt - DAY - Date.now());
    await t.mutation(filmInternal.expireOriginals, {});
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals.map((o) => o.originalId)).toEqual([originalId]);
    advance(2 * DAY);
    await t.mutation(filmInternal.expireOriginals, {});
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals).toEqual([]);
  });

  it("onderweg in een open project: de aangemelde grootte, en 14 dagen na de einddatum", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w, 10 * DAY);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const bytes = ORIGINAL.byteLength;
    await announce(asFilm.bob(t), photoId, bytes);
    const v = await asFilm.alice(t).query(filmApi.get, { projectId });
    expect(v.originals[0]).toMatchObject({ status: "onderweg", bytes, goneAt: v.project.endsAt + AFTER_CLOSE_MS });
  });

  it("onderweg: de einddatum verschuiven verschuift de datum van weggaan mee", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w, 10 * DAY);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    const endsAt = Date.now() + 30 * DAY;
    await asFilm.alice(t).mutation(filmApi.setEndsAt, { projectId, endsAt });
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals[0]!.goneAt).toBe(endsAt + AFTER_CLOSE_MS);
  });

  it("onderweg, eerder gesloten: 14 dagen na het sluiten", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w, 10 * DAY);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    advance(DAY);
    const closedAt = Date.now();
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).originals[0]!.goneAt).toBe(closedAt + AFTER_CLOSE_MS);
  });

  it("onderweg in een project dat bijna een jaar open staat: een jaar na het aanmelden", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w, 360 * DAY);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    const row = (await asFilm.bob(t).query(filmApi.get, { projectId })).originals[0]!;
    expect(row.goneAt).toBe(row.submittedAt + YEAR_MS);
  });
});

describe("get: wie ziet de nieuwe velden", () => {
  it("een lid (ook een admin) ziet grootte en datum bij andermans inzending die binnen is, gelijk aan de oprichter", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    await sendOriginal(asFilm.bob(t), env.orig, photoId);
    const founder = (await asFilm.alice(t).query(filmApi.get, { projectId })).originals[0]!;
    const admin = (await asFilm.erik(t).query(filmApi.get, { projectId })).originals[0]!;
    expect(admin).toEqual({ ...founder });
    expect(typeof admin.bytes).toBe("number");
    expect(typeof admin.goneAt).toBe("number");
  });

  it("de inzender ziet ze bij zijn eigen inzending onderweg; een ander lid ziet die rij (en dus ook die velden) niet", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).originals[0]).toMatchObject({ mine: true, bytes: ORIGINAL.byteLength });
    expect((await asFilm.erik(t).query(filmApi.get, { projectId })).originals).toEqual([]);
  });
});
