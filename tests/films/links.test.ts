import { describe, expect, it, vi } from "vitest";
import {
  as,
  ENV,
  expectValidSignature,
  FIXED_NOW,
  filmsApi,
  KEYS,
  newT,
  parseS3Link,
  seedFilmsWorld,
  THREE_HOURS_S,
  useFilmsEnv,
  type R,
} from "./_films";

// WP21 — de korte link zelf.
//   Invariant 2 en besluit 2: een film-link werkt 3 uur, een cover-link korter.
//   A-invariant 10: alleen het bestand uit de eigen lijst wordt ondertekend.
//   A-invariant 13: een link per film en per soort.
//   Invariant 3: de link draagt de access key ID (zo werkt S3), niet het geheim.
// De handtekening wordt herberekend met het test-geheim (geen AWS nodig): als
// hij klopt, opent S3 met deze link precies dit pad.
// Spec: docs/work-packages/WP21-videos.md §Testcontract.

useFilmsEnv();

describe("film-link (besluit 2, A-invariant 10, 13)", () => {
  it("ondertekent precies de videoKey van die film in de bucket uit de env", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    const res = (await as.alice(t).action(filmsApi.videoUrl, { filmId: w.films.filmB })) as R;
    const link = parseS3Link(res.url);
    expect(link.bucket).toBe(ENV.FILMS_S3_BUCKET);
    expect(link.key).toBe(KEYS.filmVideo);
    await expectValidSignature(link);
  });

  it("werkt precies 3 uur (X-Amz-Expires=10800), vanaf nu", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    const res = (await as.alice(t).action(filmsApi.videoUrl, { filmId: w.films.filmB })) as R;
    const link = parseS3Link(res.url);
    expect(link.expiresS).toBe(THREE_HOURS_S);
    expect(link.dateMs).toBe(FIXED_NOW);
  });

  it("expiresAt = ondertekenmoment + geldigheid", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    const res = (await as.alice(t).action(filmsApi.videoUrl, { filmId: w.films.filmB })) as R;
    const link = parseS3Link(res.url);
    expect(res.expiresAt).toBe(link.dateMs + link.expiresS * 1000);
    expect(Object.keys(res).sort()).toEqual(["expiresAt", "url"]);
  });

  it("de trailer krijgt zijn eigen videoKey", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    const res = (await as.alice(t).action(filmsApi.videoUrl, { filmId: w.films.trailerA })) as R;
    const link = parseS3Link(res.url);
    expect(link.key).toBe(KEYS.trailerVideo);
    await expectValidSignature(link);
  });

  it("de film zonder cover heeft wel een film-link", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    const res = (await as.alice(t).action(filmsApi.videoUrl, { filmId: w.films.filmC })) as R;
    expect(parseS3Link(res.url).key).toBe(KEYS.bareVideo);
  });

  it("een verse aanvraag geeft een verse link (opnieuw proberen, invariant 5)", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    const first = (await as.alice(t).action(filmsApi.videoUrl, { filmId: w.films.filmB })) as R;
    // Een uur later: de nieuwe link telt vanaf dan.
    vi.setSystemTime(FIXED_NOW + 60 * 60 * 1000);
    const second = (await as.alice(t).action(filmsApi.videoUrl, { filmId: w.films.filmB })) as R;
    expect(second.expiresAt).toBe(first.expiresAt + 60 * 60 * 1000);
    expect(second.url).not.toBe(first.url);
  });
});

describe("cover-link (besluit 2, A-invariant 13)", () => {
  it("ondertekent precies de coverKey van die film", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    const res = (await as.alice(t).action(filmsApi.coverUrl, { filmId: w.films.filmB })) as R;
    const link = parseS3Link(res.url);
    expect(link.bucket).toBe(ENV.FILMS_S3_BUCKET);
    expect(link.key).toBe(KEYS.filmCover);
    await expectValidSignature(link);
  });

  it("is korter geldig dan een film-link, en wel geldig", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    const res = (await as.alice(t).action(filmsApi.coverUrl, { filmId: w.films.filmB })) as R;
    const link = parseS3Link(res.url);
    expect(link.expiresS).toBeGreaterThan(0);
    expect(link.expiresS).toBeLessThan(THREE_HOURS_S);
    expect(res.expiresAt).toBe(link.dateMs + link.expiresS * 1000);
  });

  it("de cover-link van film B is niet de film-link van B en niet de cover van de trailer", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    const cover = parseS3Link(((await as.alice(t).action(filmsApi.coverUrl, { filmId: w.films.filmB })) as R).url);
    const video = parseS3Link(((await as.alice(t).action(filmsApi.videoUrl, { filmId: w.films.filmB })) as R).url);
    const trailerCover = parseS3Link(
      ((await as.alice(t).action(filmsApi.coverUrl, { filmId: w.films.trailerA })) as R).url,
    );
    expect(cover.key).not.toBe(video.key);
    expect(cover.key).not.toBe(trailerCover.key);
    expect(trailerCover.key).toBe(KEYS.trailerCover);
  });
});

describe("invariant 3: de link draagt geen geheim", () => {
  it("film- en cover-link bevatten het geheim niet, in geen enkele codering", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    const secret = ENV.FILMS_S3_SECRET_ACCESS_KEY;
    for (const fn of [filmsApi.videoUrl, filmsApi.coverUrl]) {
      const res = (await as.alice(t).action(fn, { filmId: w.films.filmB })) as R;
      const json = JSON.stringify(res);
      expect(json).not.toContain(secret);
      expect(json).not.toContain(encodeURIComponent(secret));
      expect(decodeURIComponent(res.url as string)).not.toContain(secret);
    }
  });
});
