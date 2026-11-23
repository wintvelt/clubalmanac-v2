import { describe, expect, it, vi } from "vitest";
import { DAY_MS, FIXED_NOW, HOUR_MS, newT, parseR2Link, WEBMASTER, type T } from "../videos/_videos";
import {
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

// WP38a — een dagelijkse R2-check voor de originelen-bucket (A-invariant 14),
// naast die van WP37 (`videos.checkStorage`, die de originelen niet ziet).
// Een object zonder inzending (ouder dan een dag) en een inzending die binnen
// is zonder object geven één mail aan de webmaster; een origineel dat klopt
// meldt hij niet, ook niet als "wees" in de bucket van de albums. De check
// wist niets.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §A-invarianten.

const env = useFilmEnv();

async function check(t: T) {
  await t.action(filmInternal.checkStorage, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("filmProjects.checkStorage", () => {
  it("een origineel dat klopt: geen mail, niets gewist", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    await sendOriginal(asFilm.bob(t), env.orig, photoId);
    vi.setSystemTime(Date.now() + 2 * DAY_MS);
    await check(t);
    expect(env.r2.mails).toEqual([]);
    expect(env.orig.keys()).toHaveLength(1);
  });

  it("een object in de originelen-bucket zonder inzending, ouder dan een dag: één mail; het object blijft", async () => {
    const t = newT();
    await seedFilmWorld(t);
    env.orig.put("originals/wees.mov", ORIGINAL, FIXED_NOW - DAY_MS - HOUR_MS);
    await check(t);
    expect(env.r2.mails).toHaveLength(1);
    expect(JSON.stringify(env.r2.mails)).toContain(WEBMASTER);
    expect(env.orig.keys()).toEqual(["originals/wees.mov"]);
  });

  it("zonder R2_ORIGINALS_BUCKET: één mail dat de check niet kon draaien", async () => {
    const t = newT();
    await seedFilmWorld(t);
    delete process.env.R2_ORIGINALS_BUCKET;
    await check(t);
    expect(env.r2.mails).toHaveLength(1);
    expect(JSON.stringify(env.r2.mails)).toContain("R2_ORIGINALS_BUCKET");
  });

  it("een inzending die binnen is, zonder object: één mail", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    await sendOriginal(asFilm.bob(t), env.orig, photoId);
    env.orig.objects.clear();
    await check(t);
    expect(env.r2.mails).toHaveLength(1);
  });
});

// Fix-cyclus 1 (audit N1): wat MON3 meldt, staat ook in de mail.
describe("filmProjects.checkStorage: de inhoud van de mail (fix-cyclus 1)", () => {
  it("een inzending waarvan het object een andere grootte heeft: één mail met de inzending", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    const [key] = env.orig.keys();
    env.orig.put(key!, ORIGINAL.subarray(0, 1000));
    await check(t);
    expect(env.r2.mails).toHaveLength(1);
    expect(JSON.stringify(env.r2.mails[0])).toContain(originalId);
  });

  it("een halve upload zonder inzending, ouder dan 8 dagen: één mail met de sleutel; jonger, of van een inzending onderweg: niet", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w, 30 * DAY_MS);
    // Een inzending onderweg, met een upload die straks ook 9 dagen oud is.
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    const ownKey = parseR2Link(s.parts[0]!.url).key;
    const now = Date.now();
    env.orig.uploads.set("los-oud", { key: "originals/los-oud", uploadId: "los-oud", parts: new Map(), initiated: now - 9 * DAY_MS });
    env.orig.uploads.set("los-jong", { key: "originals/los-jong", uploadId: "los-jong", parts: new Map(), initiated: now - 7 * DAY_MS });
    for (const u of env.orig.uploads.values()) if (u.key === ownKey) u.initiated = now - 9 * DAY_MS;
    await check(t);
    expect(env.r2.mails).toHaveLength(1);
    const mail = JSON.stringify(env.r2.mails[0]);
    expect(mail).toContain("originals/los-oud");
    expect(mail).not.toContain("originals/los-jong");
    expect(mail).not.toContain(ownKey);
  });
});

// Fix-cyclus 1 (red-team S3, regie): de lifecycle-regel van R2 (365 dagen)
// kan een origineel rond het einde van zijn jaar wissen voordat de dagelijkse
// ronde het doet. Vanaf een dag vóór het einde van het jaar (of erna) meldt
// MON3 een inzending zonder bestand dus niet. Het jaar telt hier vanaf het
// aanmelden: R2 kan een object uit een multipart-upload dateren op het begin
// van de upload, en dat ligt nooit vóór het aanmelden.
describe("filmProjects.checkStorage: rond het einde van het jaar (fix-cyclus 1)", () => {
  async function receivedThenGone(t: T, at: number, completeAfterMs = 0) {
    const w = await seedFilmWorld(t);
    await openProject(t, w, 30 * DAY_MS);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    const submittedAt = Date.now();
    vi.setSystemTime(submittedAt + completeAfterMs);
    // Hervatten: verse links (een deel-link geldt 7 dagen).
    const fresh = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    expect(fresh.originalId).toBe(s.originalId);
    expect(await env.orig.putPart(fresh.parts[0]!.url, ORIGINAL)).toBe(200);
    expect(await asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })).toEqual({ kind: "done" });
    vi.setSystemTime(submittedAt + at);
    env.orig.objects.clear();
  }

  it("een halve dag vóór het einde van het jaar, zonder bestand: geen mail", async () => {
    const t = newT();
    await receivedThenGone(t, YEAR_MS - 12 * HOUR_MS);
    await check(t);
    expect(env.r2.mails).toEqual([]);
  });

  it("na het einde van het jaar, de opruimronde liep nog niet: geen mail", async () => {
    const t = newT();
    await receivedThenGone(t, YEAR_MS + 2 * HOUR_MS);
    await check(t);
    expect(env.r2.mails).toEqual([]);
  });

  it("twee dagen vóór het einde van het jaar, zonder bestand: wel een mail", async () => {
    const t = newT();
    await receivedThenGone(t, YEAR_MS - 2 * DAY_MS);
    await check(t);
    expect(env.r2.mails).toHaveLength(1);
  });

  it("tien dagen na het aanmelden binnen: een halve dag vóór een jaar na het aanmelden, zonder bestand, geen mail", async () => {
    const t = newT();
    await receivedThenGone(t, YEAR_MS - 12 * HOUR_MS, 10 * DAY_MS);
    await check(t);
    expect(env.r2.mails).toEqual([]);
  });
});

// Fix-cyclus 2 (regie, red-team N3): het jaar van MON3 begint bij het moment
// waarop de laatste upload in R2 is aangemaakt (ook bij hervatten met een
// nieuwe upload), niet alleen bij het aanmelden. Anders blijft echt verlies van
// een origineel dat maanden na het aanmelden binnenkwam maanden onopgemerkt.
describe("filmProjects.checkStorage: het jaar begint bij de laatste upload (fix-cyclus 2)", () => {
  async function lateUpload(t: T): Promise<number> {
    const w = await seedFilmWorld(t);
    await openProject(t, w, 200 * DAY_MS);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const first = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    const submittedAt = Date.now();
    // De lifecycle-regel brak de eerste upload af; 100 dagen later hervat de
    // app en krijgt een nieuwe upload.
    env.orig.uploads.delete(parseR2Link(first.parts[0]!.url).params.uploadId!);
    vi.setSystemTime(submittedAt + 100 * DAY_MS);
    const fresh = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    expect(fresh.originalId).toBe(first.originalId);
    expect(env.orig.creates()).toHaveLength(2);
    expect(await env.orig.putPart(fresh.parts[0]!.url, ORIGINAL)).toBe(200);
    expect(await asFilm.bob(t).action(filmApi.finishOriginal, { originalId: first.originalId })).toEqual({ kind: "done" });
    return submittedAt;
  }

  it("een halve dag vóór een jaar na het aanmelden, maar 100 dagen na de laatste upload, zonder bestand: wel een mail", async () => {
    const t = newT();
    const submittedAt = await lateUpload(t);
    vi.setSystemTime(submittedAt + YEAR_MS - 12 * HOUR_MS);
    env.orig.objects.clear();
    await check(t);
    expect(env.r2.mails).toHaveLength(1);
  });

  it("een halve dag vóór een jaar na de laatste upload, zonder bestand: geen mail", async () => {
    const t = newT();
    const submittedAt = await lateUpload(t);
    vi.setSystemTime(submittedAt + 100 * DAY_MS + YEAR_MS - 12 * HOUR_MS);
    env.orig.objects.clear();
    await check(t);
    expect(env.r2.mails).toEqual([]);
  });
});
