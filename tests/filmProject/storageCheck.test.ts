import { describe, expect, it, vi } from "vitest";
import { DAY_MS, FIXED_NOW, HOUR_MS, newT, WEBMASTER, type T } from "../videos/_videos";
import { asFilm, filmInternal, newVideoInX, openProject, ORIGINAL, seedFilmWorld, sendOriginal, useFilmEnv } from "./_film";

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
