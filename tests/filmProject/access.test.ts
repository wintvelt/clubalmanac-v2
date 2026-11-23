import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { newT, parseR2Link, r2SignatureProblem } from "../videos/_videos";
import {
  announce,
  asFilm,
  DOWNLOAD_LINK_SECONDS_ORACLE,
  expectCode,
  filmApi,
  newVideoInX,
  openProject,
  ORIGINAL,
  ORIGINALS_BUCKET,
  outcome,
  seedFilmWorld,
  sendOriginal,
  useFilmEnv,
} from "./_film";

// WP38a — wie ziet wat (invariant 1, 3; besluit 7, 8; A-invariant 7, 8).
//   - De lijst en de poster: alleen leden van de groep van het project. Van
//     anderen alleen wat binnen is; eigen inzendingen altijd; de oprichter
//     ziet alles. Geen sleutel, upload-id of link in het antwoord.
//   - De poster via een eigen beeldpad (`/beeld/inzending/<id>`), ook als het
//     filmpje uit het filmalbum is gehaald. Geen afspeellink.
//   - Downloaden: alleen de oprichter (op het moment van het verzoek), alleen
//     wat binnen is; een GET van 1 uur met `attachment` en een bestandsnaam
//     met datum en inzender. Iedereen anders: ORIGINAL_NOT_FOUND.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §A-invarianten.

const env = useFilmEnv();

describe("de projectpagina (get)", () => {
  it("van een ander alleen wat binnen is; eigen inzendingen altijd; de oprichter ziet alles", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob, { takenAt: Date.UTC(2026, 10, 3, 14, 22), durationMs: 4200 });
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);

    expect((await asFilm.erik(t).query(filmApi.get, { projectId })).originals).toEqual([]);
    const own = (await asFilm.bob(t).query(filmApi.get, { projectId })).originals;
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ originalId: s.originalId, mine: true, status: "onderweg", ownerName: "Bob" });
    const founder = (await asFilm.alice(t).query(filmApi.get, { projectId })).originals;
    expect(founder.map((o) => o.status)).toEqual(["onderweg"]);
    expect(founder[0]!.mine).toBe(false);

    expect(await env.orig.putPart(s.parts[0]!.url, ORIGINAL)).toBe(200);
    expect(await asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })).toEqual({ kind: "done" });
    const seen = (await asFilm.erik(t).query(filmApi.get, { projectId })).originals;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      originalId: s.originalId,
      ownerName: "Bob",
      mine: false,
      status: "binnen",
      durationMs: 4200,
      takenAt: Date.UTC(2026, 10, 3, 14, 22),
    });
    expect(typeof seen[0]!.submittedAt).toBe("number");
  });

  it("het antwoord bevat geen sleutel, upload-id, bucket of link", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    const link = parseR2Link(s.parts[0]!.url);
    for (const who of [asFilm.alice, asFilm.bob]) {
      const text = JSON.stringify(await who(t).query(filmApi.get, { projectId }));
      expect(text).not.toContain(link.key);
      expect(text).not.toContain(link.params.uploadId!);
      expect(text).not.toContain(ORIGINALS_BUCKET);
      expect(text).not.toContain("X-Amz");
    }
  });
});

describe("de poster (GET /beeld/inzending/<id>)", () => {
  it("een lid krijgt de poster, ook als het filmpje uit X is gehaald; wie geen lid is 404, uitgelogd 401", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    const path = `/beeld/inzending/${originalId}?formaat=klein`;

    const ok = await asFilm.erik(t).fetch(path);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    expect((await asFilm.carol(t).fetch(path)).status).toBe(404);
    expect((await asFilm.dave(t).fetch(path)).status).toBe(404);
    expect((await asFilm.wm(t).fetch(path)).status).toBe(404);
    expect((await t.fetch(path)).status).toBe(401);
    expect((await asFilm.erik(t).fetch(`/beeld/inzending/onbekend?formaat=klein`)).status).toBe(404);

    // "Uit album" (besluit 4): het beeldpad van de foto laat erik niet meer toe, dat van de inzending wel.
    await asFilm.bob(t).mutation(api.albums.removePhoto, { albumId: w.albums.georgie, photoId });
    expect((await asFilm.erik(t).fetch(`/beeld/foto/${photoId}?formaat=klein`)).status).toBe(404);
    expect((await asFilm.erik(t).fetch(path)).status).toBe(200);
  });
});

describe("downloaden (besluit 8, A-invariant 8)", () => {
  it("de oprichter krijgt een GET van 1 uur op precies het origineel, als bijlage met datum en naam", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob, { takenAt: Date.UTC(2026, 10, 3, 14, 22) });
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    const { url, expiresAt } = await asFilm.alice(t).action(filmApi.downloadUrl, { originalId });
    const link = parseR2Link(url);
    expect(link.bucket).toBe(ORIGINALS_BUCKET);
    expect(env.orig.keys()).toEqual([link.key]);
    expect(await r2SignatureProblem(link, "GET")).toBeNull();
    expect(link.expiresS).toBe(DOWNLOAD_LINK_SECONDS_ORACLE);
    expect(expiresAt).toBe(link.dateMs + DOWNLOAD_LINK_SECONDS_ORACLE * 1000);
    const disposition = link.params["response-content-disposition"] ?? "";
    expect(disposition).toMatch(/^attachment/);
    expect(disposition).toContain("2026-11-03");
    expect(disposition).toContain("Bob");
    expect(disposition.toLowerCase()).toContain(".mov");
  });

  // A-keuze bestandsnaam: `<jjjj-mm-dd uu.mm> <naam inzender>.mov`, met de
  // opnamedatum (kloktijd van de opname). B-keuze, door A bevestigd: zonder
  // opnamedatum de datum en tijd van inzenden in Nederlandse tijd (CET/CEST).
  it("bestandsnaam: de opnamedatum als die er is, anders het inzenden in Nederlandse tijd (winter en zomer)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const taken = await newVideoInX(t, env.r2, w, w.users.bob, { takenAt: Date.UTC(2026, 10, 3, 14, 22) });
    const takenId = await sendOriginal(asFilm.bob(t), env.orig, taken);
    const nameOf = async (originalId: string) =>
      parseR2Link((await asFilm.alice(t).action(filmApi.downloadUrl, { originalId })).url).params["response-content-disposition"] ?? "";
    expect(await nameOf(takenId)).toContain("2026-11-03 14.22 Bob.mov");

    // Winter: FIXED_NOW is 21-11-2026 12:00 UTC, dus 13:0x in Nederland.
    const winter = await newVideoInX(t, env.r2, w, w.users.bob);
    const winterId = await sendOriginal(asFilm.bob(t), env.orig, winter);
    expect(await nameOf(winterId)).toMatch(/2026-11-21 13\.0\d Bob\.mov/);
  });

  it("bestandsnaam zonder opnamedatum in de zomer: UTC plus twee uur", async () => {
    vi.setSystemTime(Date.UTC(2027, 6, 10, 10, 0));
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const summer = await newVideoInX(t, env.r2, w, w.users.bob);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, summer);
    const disposition = parseR2Link((await asFilm.alice(t).action(filmApi.downloadUrl, { originalId })).url).params["response-content-disposition"] ?? "";
    expect(disposition).toMatch(/2027-07-10 12\.0\d Bob\.mov/);
  });

  it("de inzender zelf, een admin, een lid, de webmaster en wie geen lid is: ORIGINAL_NOT_FOUND", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    for (const who of [asFilm.bob, asFilm.erik, asFilm.wm, asFilm.carol, asFilm.dave]) {
      expectCode(await outcome(() => who(t).action(filmApi.downloadUrl, { originalId })), "ORIGINAL_NOT_FOUND");
    }
    expectCode(await outcome(() => t.action(filmApi.downloadUrl, { originalId })), "ORIGINAL_NOT_FOUND");
  });

  it("een origineel dat nog onderweg is: ook voor de oprichter ORIGINAL_NOT_FOUND", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    expectCode(await outcome(() => asFilm.alice(t).action(filmApi.downloadUrl, { originalId: s.originalId })), "ORIGINAL_NOT_FOUND");
  });

  it("na overdragen downloadt de nieuwe oprichter; de oude niet meer", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    await asFilm.alice(t).mutation(api.groups.transferFounder, { groupId: w.groups.reis, userId: w.users.erik });
    expectCode(await outcome(() => asFilm.alice(t).action(filmApi.downloadUrl, { originalId })), "ORIGINAL_NOT_FOUND");
    const { url } = await asFilm.erik(t).action(filmApi.downloadUrl, { originalId });
    expect(parseR2Link(url).bucket).toBe(ORIGINALS_BUCKET);
  });

  it("toegang vóór config: zonder R2_ORIGINALS_BUCKET krijgt een lid toch ORIGINAL_NOT_FOUND", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    delete process.env.R2_ORIGINALS_BUCKET;
    expectCode(await outcome(() => asFilm.bob(t).action(filmApi.downloadUrl, { originalId })), "ORIGINAL_NOT_FOUND");
    const o = await outcome(() => asFilm.alice(t).action(filmApi.downloadUrl, { originalId }));
    expect("err" in o && o.err.message.includes("R2_CONFIG_MISSING")).toBe(true);
  });
});

// Fix-cyclus 1 (audit S1, N6).
describe("de poster: fix-cyclus 1", () => {
  it("de inzending van een ander die nog onderweg is: 404 voor een lid (ook een admin); de inzender en de oprichter zien hem", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    const path = `/beeld/inzending/${s.originalId}?formaat=klein`;
    expect((await asFilm.erik(t).fetch(path)).status).toBe(404);
    expect((await asFilm.bob(t).fetch(path)).status).toBe(200);
    expect((await asFilm.alice(t).fetch(path)).status).toBe(200);
  });

  it("?formaat=origineel: 400, zoals /beeld/foto/ (vóór alles, voor iedereen gelijk)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    const path = `/beeld/inzending/${originalId}?formaat=origineel`;
    expect((await asFilm.erik(t).fetch(path)).status).toBe(400);
    expect((await asFilm.carol(t).fetch(path)).status).toBe(400);
    expect((await t.fetch(path)).status).toBe(400);
    expect((await asFilm.erik(t).fetch(`/beeld/foto/${photoId}?formaat=origineel`)).status).toBe(400);
  });
});
