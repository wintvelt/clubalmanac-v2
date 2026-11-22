import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { newT, parseR2Link, POSTER, r2SignatureProblem, seedPhoto, seedVideo } from "../videos/_videos";
import {
  advance,
  announce,
  asFilm,
  expectOriginalRefusal,
  filmApi,
  filmInternal,
  MINUTE_MS,
  newVideoInX,
  openProject,
  ORIGINAL,
  ORIGINALS_BUCKET,
  outcome,
  PART_BYTES_ORACLE,
  PART_LINK_SECONDS_ORACLE,
  seedFilmWorld,
  sendOriginal,
  useFilmEnv,
} from "./_film";

// WP38a — een origineel insturen, in delen (invariant 1, 4, 5; A-invariant 3,
// 4, 5, 6, 7, 9, 13).
//   - Alleen de eigenaar van een nieuw filmpje in het filmalbum, gemaakt
//     terwijl het project open stond; één weigering voor de rest.
//   - Per filmpje hooguit één inzending; opnieuw aanmelden geeft dezelfde,
//     met alleen links voor de delen die nog niet in R2 staan.
//   - Deel-links: PUT op precies de sleutel in de originelen-bucket, met
//     deelnummer en upload-id, de grootte in de handtekening, 7 dagen.
//   - Binnen pas als alles er is; de bytes blijven precies zoals verstuurd
//     (met GPS); geen kopie, geen rij in `photos`.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §A-invarianten.

const env = useFilmEnv();

async function statusOf(t: ReturnType<typeof newT>, projectId: string, originalId: string) {
  const view = await asFilm.alice(t).query(filmApi.get, { projectId });
  return view.originals.find((o) => o.originalId === originalId)?.status ?? null;
}

describe("aanmelden en deel-links (A-invariant 3, 4)", () => {
  it("de eigenaar van een nieuw filmpje in X krijgt deel-links voor de originelen-bucket", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    expect(s.partSize).toBe(PART_BYTES_ORACLE);
    expect(s.parts.map((p) => p.partNumber)).toEqual([1]);
    const link = parseR2Link(s.parts[0]!.url);
    expect(link.bucket).toBe(ORIGINALS_BUCKET);
    expect(await r2SignatureProblem(link, "PUT", ORIGINAL.byteLength)).toBeNull();
    expect(link.expiresS).toBe(PART_LINK_SECONDS_ORACLE);
    expect(link.params.partNumber).toBe("1");
    // De upload-id is die van R2 en de sleutel komt niet uit het verzoek.
    expect(env.orig.uploads.has(link.params.uploadId ?? "")).toBe(true);
    expect(link.key).not.toContain(photoId);
    expect(link.key.toLowerCase()).not.toContain("bob");
    expect(env.orig.creates()).toHaveLength(1);
    // Een andere grootte past niet op de link.
    expect(await env.orig.putPart(s.parts[0]!.url, ORIGINAL.byteLength + 1)).toBe(403);
  });

  it("delen van 32 MiB, het laatste de rest; elke link met de grootte van zijn deel", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const bytes = 2 * PART_BYTES_ORACLE + 1000;
    const s = await announce(asFilm.bob(t), photoId, bytes);
    expect(s.parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    const sizes = [PART_BYTES_ORACLE, PART_BYTES_ORACLE, 1000];
    for (const [i, p] of s.parts.entries()) {
      expect(await r2SignatureProblem(parseR2Link(p.url), "PUT", sizes[i])).toBeNull();
    }
    // Alle drie dezelfde upload in R2.
    expect(new Set(s.parts.map((p) => parseR2Link(p.url).params.uploadId)).size).toBe(1);
  });

  it("opnieuw aanmelden: dezelfde inzending, geen tweede upload in R2, alleen de delen die nog ontbreken", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const bytes = 2 * PART_BYTES_ORACLE + 1000;
    const first = await announce(asFilm.bob(t), photoId, bytes);
    expect(await env.orig.putPart(first.parts[0]!.url, PART_BYTES_ORACLE)).toBe(200);
    const again = await announce(asFilm.bob(t), photoId, bytes);
    expect(again.originalId).toBe(first.originalId);
    expect(again.parts.map((p) => p.partNumber)).toEqual([2, 3]);
    expect(env.orig.creates()).toHaveLength(1);
    const view = await asFilm.bob(t).query(filmApi.get, { projectId });
    expect(view.originals).toHaveLength(1);
    expect(view.originals[0]).toMatchObject({ originalId: first.originalId, mine: true, status: "onderweg", ownerName: "Bob" });
  });

  it("al binnen: opnieuw aanmelden geeft { kind: 'done' } met dezelfde inzending", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    expect(await asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes: ORIGINAL.byteLength })).toEqual({ kind: "done", originalId });
    expect(env.orig.creates()).toHaveLength(1);
  });
});

describe("wie mag insturen (A-invariant 3): één weigering voor alles wat niet mag", () => {
  async function refusedWithoutTrace(t: ReturnType<typeof newT>, run: () => Promise<unknown>, projectId: string) {
    expectOriginalRefusal(await outcome(run), "niet_toegestaan");
    expect(env.orig.creates()).toHaveLength(0);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals).toEqual([]);
  }

  it("het filmpje van een ander", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.alice);
    await refusedWithoutTrace(t, () => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes: 1000 }), projectId);
  });

  it("een foto in X (geen filmpje)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    advance(MINUTE_MS);
    const photoId = await seedPhoto(t, w.users.bob, w.albums.georgie);
    await refusedWithoutTrace(t, () => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes: 1000 }), projectId);
  });

  it("een filmpje van vóór het project, ook als het in X staat (besluit 4)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const old = await seedVideo(t, env.r2, { ownerId: w.users.bob, albumId: w.albums.georgie });
    advance(MINUTE_MS);
    const projectId = await openProject(t, w);
    await refusedWithoutTrace(t, () => asFilm.bob(t).action(filmApi.startOriginal, { photoId: old.photoId, bytes: 1000 }), projectId);
  });

  it("een filmpje van vóór het project dat tijdens het project met 'Naar album' in X komt", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const old = await seedVideo(t, env.r2, { ownerId: w.users.bob });
    advance(MINUTE_MS);
    const projectId = await openProject(t, w);
    advance(MINUTE_MS);
    await asFilm.bob(t).mutation(api.albums.addPhoto, { albumId: w.albums.georgie, photoId: old.photoId });
    await refusedWithoutTrace(t, () => asFilm.bob(t).action(filmApi.startOriginal, { photoId: old.photoId, bytes: 1000 }), projectId);
  });

  it("een filmpje dat na het sluiten gemaakt is en in X staat", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes: 1000 })), "niet_toegestaan");
    expect(env.orig.creates()).toHaveLength(0);
  });

  it("een nieuw filmpje dat niet in X staat (bv. in een album van een andere groep)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    advance(MINUTE_MS);
    const v = await seedVideo(t, env.r2, { ownerId: w.users.dave, albumId: w.albums.elders });
    expectOriginalRefusal(await outcome(() => asFilm.dave(t).action(filmApi.startOriginal, { photoId: v.photoId, bytes: 1000 })), "niet_toegestaan");
    expect(env.orig.creates()).toHaveLength(0);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals).toEqual([]);
  });

  it("geen grootte boven nul: een weigering, niets aangemaakt", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    for (const bytes of [0, -5, 1.5]) {
      expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes })));
    }
    expect(env.orig.creates()).toHaveLength(0);
  });

  it("niet ingelogd: uitgelogd", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    expectOriginalRefusal(await outcome(() => t.action(filmApi.startOriginal, { photoId, bytes: 1000 })), "uitgelogd");
  });

  it("afronden van de inzending van een ander: niet_toegestaan, niets afgerond", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    expect(await env.orig.putPart(s.parts[0]!.url, ORIGINAL)).toBe(200);
    expectOriginalRefusal(await outcome(() => asFilm.alice(t).action(filmApi.finishOriginal, { originalId: s.originalId })), "niet_toegestaan");
    expect(await statusOf(t, projectId, s.originalId)).toBe("onderweg");
    expect(env.orig.keys()).toEqual([]);
  });
});

describe("binnen pas als het heel is (invariant 5, A-invariant 5)", () => {
  it("een ontbrekend deel: afronden noemt het, de inzending blijft onderweg, er is geen object", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const bytes = 2 * PART_BYTES_ORACLE + 1000;
    const s = await announce(asFilm.bob(t), photoId, bytes);
    expect(await env.orig.putPart(s.parts[0]!.url, ORIGINAL)).toBe(403); // verkeerde grootte
    expect(await env.orig.putPart(s.parts[0]!.url, PART_BYTES_ORACLE)).toBe(200);
    expect(await env.orig.putPart(s.parts[2]!.url, 1000)).toBe(200);
    expect(await asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })).toEqual({ kind: "missing", parts: [2] });
    expect(await statusOf(t, projectId, s.originalId)).toBe("onderweg");
    expect(env.orig.keys()).toEqual([]);

    expect(await env.orig.putPart(s.parts[1]!.url, PART_BYTES_ORACLE)).toBe(200);
    expect(await asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })).toEqual({ kind: "done" });
    expect(await statusOf(t, projectId, s.originalId)).toBe("binnen");
    const [key] = env.orig.keys();
    expect(env.orig.sizeOf(key!)).toBe(bytes);
    expect(env.orig.uploads.size).toBe(0);
  });

  it("niets verstuurd: afronden noemt alle delen", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, PART_BYTES_ORACLE + 5);
    expect(await asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })).toEqual({ kind: "missing", parts: [1, 2] });
  });

  it("geen filmpje (een JPEG als origineel): geen_video, object en inzending weg", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, POSTER.byteLength);
    expect(await env.orig.putPart(s.parts[0]!.url, POSTER)).toBe(200);
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })), "geen_video");
    expect(env.orig.keys()).toEqual([]);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals).toEqual([]);
    // Het filmpje in het album blijft (het hangt niet op het origineel).
    expect(await t.run(async (ctx) => ctx.db.get(photoId))).not.toBeNull();
  });

  it("de backend rondt zelf af wat helemaal binnen is, zonder de app (A-invariant 9)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    expect(await env.orig.putPart(s.parts[0]!.url, ORIGINAL)).toBe(200);
    await t.action(filmInternal.completeUploaded, {});
    expect(await statusOf(t, projectId, s.originalId)).toBe("binnen");
    // Een inzending waarvan nog iets ontbreekt, laat hij staan.
    const other = await newVideoInX(t, env.r2, w, w.users.alice);
    const s2 = await announce(asFilm.alice(t), other, PART_BYTES_ORACLE + 5);
    expect(await env.orig.putPart(s2.parts[0]!.url, PART_BYTES_ORACLE)).toBe(200);
    await t.action(filmInternal.completeUploaded, {});
    expect(await statusOf(t, projectId, s2.originalId)).toBe("onderweg");
  });
});

describe("het origineel blijft onaangetast en nergens anders zichtbaar (invariant 3, 4; A-invariant 6, 7)", () => {
  it("de bytes in R2 zijn precies wat de app stuurde, met de locatie erin; geen kopie of herschrijving", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    await sendOriginal(asFilm.bob(t), env.orig, photoId);
    const [key] = env.orig.keys();
    expect(env.orig.bytesOf(key!)).toEqual(ORIGINAL);
    expect(new TextDecoder("latin1").decode(env.orig.bytesOf(key!))).toContain("ISO6709");
    // De server schreef niets zelf: geen gewone PUT en geen CopyObject op de originelen-bucket.
    const writes = env.orig.calls.filter((c) => c.method === "PUT" && c.query.uploadId === undefined);
    expect(writes).toEqual([]);
    expect(env.orig.calls.some((c) => "x-amz-copy-source" in c.headers)).toBe(false);
    // En niets in de bucket van de albums.
    expect(env.r2.keys().filter((k) => !k.startsWith("videos/test-"))).toEqual([]);
  });

  it("een origineel maakt geen rij in photos: Mijn foto's en het album hebben alleen het filmpje", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const before = await t.run(async (ctx) => (await ctx.db.query("photos").collect()).length);
    await sendOriginal(asFilm.bob(t), env.orig, photoId);
    expect(await t.run(async (ctx) => (await ctx.db.query("photos").collect()).length)).toBe(before);
    const owner = await t.run(async (ctx) => ctx.db.get(w.users.bob));
    expect(owner?.photoCount).toBe(1);
    const album = (await asFilm.bob(t).query(api.albums.listPhotos, { albumId: w.albums.georgie })) as unknown;
    expect(JSON.stringify(album)).not.toContain(ORIGINALS_BUCKET);
  });
});

describe("config fail-loud, toegang eerst (A-invariant 13)", () => {
  it("zonder R2_ORIGINALS_BUCKET: wie niet mag krijgt de gewone weigering; de eigenaar R2_CONFIG_MISSING met de naam", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    delete process.env.R2_ORIGINALS_BUCKET;
    expectOriginalRefusal(await outcome(() => asFilm.alice(t).action(filmApi.startOriginal, { photoId, bytes: 1000 })), "niet_toegestaan");
    const o = await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes: 1000 }));
    expect("err" in o).toBe(true);
    if ("err" in o) {
      expect(o.err.message).toContain("R2_CONFIG_MISSING");
      expect(o.err.message).toContain("R2_ORIGINALS_BUCKET");
      expect(o.err.message).not.toContain("r2-testgeheim");
    }
    expect(env.orig.creates()).toHaveLength(0);
  });
});
