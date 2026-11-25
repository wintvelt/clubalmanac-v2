import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { newT, parseR2Link, POSTER, r2SignatureProblem, seedPhoto, seedVideo } from "../videos/_videos";
import {
  advance,
  announce,
  asFilm,
  expectOriginalRefusal,
  filmApi,
  filmInternal,
  MIB,
  CRON_LINK_WINDOW_MS_ORACLE,
  MIN_ORIGINAL_BYTES_ORACLE,
  MINUTE_MS,
  OPEN_ORIGINALS_PER_MEMBER_ORACLE,
  ORIGINAL_CALLS_PER_DAY_ORACLE,
  newVideoInX,
  openProject,
  ORIGINAL,
  ORIGINALS_BUCKET,
  outcome,
  padTo,
  PART_BYTES_ORACLE,
  sameBytes,
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

  it("besluit 27: een nieuw filmpje in een ander album van de groep (Y) mag wel", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob, { albumId: w.albums.tbilisi });
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals.map((o) => o.originalId)).toEqual([originalId]);
  });

  it("besluit 27: een filmpje van vóór het project in Y blijft geweigerd (besluit 4)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const old = await seedVideo(t, env.r2, { ownerId: w.users.bob, albumId: w.albums.tbilisi });
    advance(MINUTE_MS);
    const projectId = await openProject(t, w);
    await refusedWithoutTrace(t, () => asFilm.bob(t).action(filmApi.startOriginal, { photoId: old.photoId, bytes: 1000 }), projectId);
  });

  it("een nieuw filmpje dat in geen album van de groep staat (bv. in een album van een andere groep)", async () => {
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
    // Deel 1 begint met de echte bytes van een filmpje (met `ftyp`): de
    // controle op het merk (A-invariant 5) mag hier niet de reden zijn.
    const first = new Uint8Array(PART_BYTES_ORACLE);
    first.set(ORIGINAL);
    expect(await env.orig.putPart(s.parts[0]!.url, first)).toBe(200);
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
    // Aangevuld tot ruim boven de ondergrens van 1 MiB en tot meer dan één
    // deel van R2 (5 MiB): het merk is de reden, niet de grootte.
    const jpeg = padTo(POSTER, 6 * MIB);
    const s = await announce(asFilm.bob(t), photoId, jpeg.byteLength);
    expect(await env.orig.putPart(s.parts[0]!.url, jpeg)).toBe(200);
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })), "geen_video");
    expect(env.orig.keys()).toEqual([]);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals).toEqual([]);
    // Het filmpje in het album blijft (het hangt niet op het origineel).
    expect(await t.run(async (ctx) => ctx.db.get(photoId))).not.toBeNull();
  });

  // Fix-cyclus 2, punt 1: weg om een andere reden markeert niet. Na
  // `geen_video` kan hetzelfde filmpje opnieuw, nu met het echte bestand.
  it("na geen_video kan hetzelfde filmpje opnieuw worden aangemeld, en komt dan binnen", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const jpeg = padTo(POSTER, 6 * MIB);
    const s = await announce(asFilm.bob(t), photoId, jpeg.byteLength);
    expect(await env.orig.putPart(s.parts[0]!.url, jpeg)).toBe(200);
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })), "geen_video");

    const again = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    expect(again.parts.map((p) => p.partNumber)).toEqual([1]);
    expect(await env.orig.putPart(again.parts[0]!.url, ORIGINAL)).toBe(200);
    expect(await asFilm.bob(t).action(filmApi.finishOriginal, { originalId: again.originalId })).toEqual({ kind: "done" });
    expect(await statusOf(t, projectId, again.originalId)).toBe("binnen");
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
    expect(sameBytes(env.orig.bytesOf(key!), ORIGINAL)).toBe(true);
    expect(new TextDecoder("latin1").decode(env.orig.bytesOf(key!)!.subarray(0, 64 * 1024))).toContain("ISO6709");
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
    const o = await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes: ORIGINAL.byteLength }));
    expect("err" in o).toBe(true);
    if ("err" in o) {
      expect(o.err.message).toContain("R2_CONFIG_MISSING");
      expect(o.err.message).toContain("R2_ORIGINALS_BUCKET");
      expect(o.err.message).not.toContain("r2-testgeheim");
    }
    expect(env.orig.creates()).toHaveLength(0);
  });
});

// Besluit 11 (Wouter: ja): hooguit 2 GiB per origineel, 200 GiB per project
// en 400 GiB voor alle projecten samen (A-invariant 15). De backend weigert
// al bij het aanmelden (`te_groot`, `vol`); wat onderweg is telt mee.
const GIB = 1024 * MIB;

/** Een inzending direct in de tabel, als bezetting (zonder R2). */
async function seedOriginal(
  t: ReturnType<typeof newT>,
  opts: { projectId: string; ownerId: Id<"users">; albumId: Id<"albums">; bytes: number; status: "onderweg" | "binnen" },
): Promise<void> {
  const photoId = (await seedVideo(t, env.r2, { ownerId: opts.ownerId, albumId: opts.albumId })).photoId;
  await t.run(async (ctx) => {
    const projectId = ctx.db.normalizeId("filmProjects", opts.projectId)!;
    const project = (await ctx.db.get(projectId))!;
    await ctx.db.insert("filmOriginals", {
      projectId,
      groupId: project.groupId,
      ownerId: opts.ownerId,
      photoId,
      key: `originals/bezet-${Math.random().toString(36).slice(2)}`,
      bytes: opts.bytes,
      status: opts.status,
      submittedAt: Date.now(),
      ...(opts.status === "binnen" ? { completedAt: Date.now() } : {}),
    } as never);
  });
}

describe("grenzen (besluit 11, A-invariant 15)", () => {
  it("per origineel hooguit 2 GiB: meer is te_groot, niets aangemaakt; precies 2 GiB mag", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const tooBig = await newVideoInX(t, env.r2, w, w.users.bob);
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId: tooBig, bytes: 2 * GIB + 1 })), "te_groot");
    expect(env.orig.creates()).toHaveLength(0);
    const s = await announce(asFilm.bob(t), tooBig, 2 * GIB);
    expect(s.parts).toHaveLength(64);
  });

  it("per project hooguit 200 GiB, wat onderweg is telt mee: daarboven vol", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await seedOriginal(t, { projectId, ownerId: w.users.alice, albumId: w.albums.georgie, bytes: 150 * GIB, status: "binnen" });
    await seedOriginal(t, { projectId, ownerId: w.users.alice, albumId: w.albums.georgie, bytes: 49 * GIB, status: "onderweg" });
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes: 2 * GIB })), "vol");
    expect(env.orig.creates()).toHaveLength(0);
    // Tot precies de grens mag.
    await announce(asFilm.bob(t), photoId, 1 * GIB);
  });

  it("alles samen hooguit 400 GiB, over projecten en groepen heen: daarboven vol", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    // Een oud, gesloten project in Reis en een open project in Ander.
    const old = await openProject(t, w);
    await seedOriginal(t, { projectId: old, ownerId: w.users.alice, albumId: w.albums.georgie, bytes: 49 * GIB, status: "binnen" });
    await asFilm.alice(t).mutation(filmApi.close, { projectId: old });
    const elders = await asFilm.dave(t).mutation(filmApi.open, { groupId: w.groups.ander, title: "Elders", endsAt: Date.now() + 14 * 24 * 60 * MINUTE_MS });
    await seedOriginal(t, { projectId: elders, ownerId: w.users.dave, albumId: w.albums.elders, bytes: 200 * GIB, status: "binnen" });
    const projectId = await openProject(t, w);
    await seedOriginal(t, { projectId, ownerId: w.users.alice, albumId: w.albums.georgie, bytes: 150 * GIB, status: "onderweg" });
    // Samen 399 GiB; dit project 150 GiB (ruim binnen zijn eigen grens).
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes: 2 * GIB })), "vol");
    expect(env.orig.creates()).toHaveLength(0);
    await announce(asFilm.bob(t), photoId, 1 * GIB);
  });

  it("terugtrekken maakt de ruimte weer vrij", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await seedOriginal(t, { projectId, ownerId: w.users.alice, albumId: w.albums.georgie, bytes: 198 * GIB, status: "binnen" });
    const first = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), first, 2 * GIB);
    const second = await newVideoInX(t, env.r2, w, w.users.bob);
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId: second, bytes: 1 * GIB })), "vol");
    await asFilm.bob(t).mutation(filmApi.withdraw, { originalId: s.originalId });
    await announce(asFilm.bob(t), second, 1 * GIB);
  });
});

// B-keuze, door A bevestigd: opnieuw aanmelden met een andere grootte is een
// ander bestand. De backend weigert (`niet_toegestaan`) en laat de inzending
// zoals hij is. Zo kunnen delen van twee bestanden nooit in één origineel
// belanden. Terugtrekken en opnieuw insturen kan niet: na terugtrekken neemt
// de backend voor dat filmpje geen origineel meer aan (fix-cyclus 2, punt 1).
// De app stuurt dus precies het bestand dat hij aanmeldde (38b).
describe("opnieuw aanmelden met een andere grootte", () => {
  it("niet_toegestaan; de inzending, de upload en de delen blijven; met de oude grootte gaat het verder", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const bytes = 2 * PART_BYTES_ORACLE + 1000;
    const first = await announce(asFilm.bob(t), photoId, bytes);
    expect(await env.orig.putPart(first.parts[0]!.url, PART_BYTES_ORACLE)).toBe(200);
    for (const other of [bytes + 1, bytes - 1, PART_BYTES_ORACLE]) {
      expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes: other })), "niet_toegestaan");
    }
    expect(env.orig.creates()).toHaveLength(1);
    expect(env.orig.uploads.size).toBe(1);
    const view = await asFilm.bob(t).query(filmApi.get, { projectId });
    expect(view.originals.map((o) => [o.originalId, o.status])).toEqual([[first.originalId, "onderweg"]]);
    const again = await announce(asFilm.bob(t), photoId, bytes);
    expect(again.originalId).toBe(first.originalId);
    expect(again.parts.map((p) => p.partNumber)).toEqual([2, 3]);
  });
});

// Fix-cyclus 1 (audit N2): een `ftyp` met een merk dat geen QuickTime of mp4
// is (bv. een HEIC-foto, die ook met `ftyp` begint) is geen filmpje.
describe("een vreemd merk in ftyp", () => {
  it("ftyp heic: geen_video, object en inzending weg", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const heic = padTo(ORIGINAL, ORIGINAL.byteLength);
    heic.set(new TextEncoder().encode("heic"), 8);
    expect(new TextDecoder("latin1").decode(heic.subarray(4, 12))).toBe("ftypheic");
    const s = await announce(asFilm.bob(t), photoId, heic.byteLength);
    expect(await env.orig.putPart(s.parts[0]!.url, heic)).toBe(200);
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })), "geen_video");
    expect(env.orig.keys()).toEqual([]);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals).toEqual([]);
  });
});

// Fix-cyclus 1 (red-team S4) en 2 (regie: red-team N1, N2): kosten. Een
// origineel is minstens 1 MiB (`te_klein`). En per lid hooguit 600 aanroepen
// van `startOriginal` en `finishOriginal` samen in 24 uur, glijdend, zoals de
// daggrens van WP37 (`te_vaak`); een geweigerde aanroep telt niet en doet
// niets in R2.
describe("kosten (fix-cyclus 1 en 2)", () => {
  it("kleiner dan 1 MiB: te_klein, niets aangemaakt; precies 1 MiB mag", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    for (const bytes of [1, 1000, MIN_ORIGINAL_BYTES_ORACLE - 1]) {
      expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes })), "te_klein");
    }
    expect(env.orig.creates()).toHaveLength(0);
    const s = await announce(asFilm.bob(t), photoId, MIN_ORIGINAL_BYTES_ORACLE);
    expect(s.parts).toHaveLength(1);
  });

  it("wie niet mag, krijgt bij een te klein bestand nog steeds niet_toegestaan (toegang eerst)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    expectOriginalRefusal(await outcome(() => asFilm.alice(t).action(filmApi.startOriginal, { photoId, bytes: 1000 })), "niet_toegestaan");
  });

  it("600 aanroepen per lid in 24 uur (aanmelden en afronden samen); de 601e is te_vaak, zonder R2; een ander lid niet; na 24 uur weer", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const bytes = PART_BYTES_ORACLE + MIN_ORIGINAL_BYTES_ORACLE;
    const s = await announce(asFilm.bob(t), photoId, bytes);
    for (let i = 1; i < ORIGINAL_CALLS_PER_DAY_ORACLE; i++) {
      if (i % 2 === 0) await announce(asFilm.bob(t), photoId, bytes);
      else expect(await asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })).toEqual({ kind: "missing", parts: [1, 2] });
    }
    const callsBefore = env.orig.calls.length;
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes })), "te_vaak");
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })), "te_vaak");
    expect(env.orig.calls.length).toBe(callsBefore);

    // Een ander lid heeft zijn eigen grens.
    const other = await newVideoInX(t, env.r2, w, w.users.alice);
    await announce(asFilm.alice(t), other, MIN_ORIGINAL_BYTES_ORACLE);

    // Glijdend: 24 uur na de eerste aanroepen mag bob weer.
    advance(24 * 60 * MINUTE_MS + MINUTE_MS);
    await announce(asFilm.bob(t), photoId, bytes);
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).originals).toHaveLength(1);
  }, 60_000);
});

// Fix-cyclus 2 (regie, red-team N2): een korte clip gaat mee. Een origineel
// van één deel mag kleiner zijn dan 5 MiB (R2 eist dat alleen van delen vóór
// het laatste).
describe("een kort origineel (fix-cyclus 2)", () => {
  it("een origineel van precies 1 MiB komt binnen, heel", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const clip = padTo(ORIGINAL.subarray(0, 64 * 1024), MIN_ORIGINAL_BYTES_ORACLE);
    expect(clip.byteLength).toBe(MIB);
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId, clip);
    expect(await statusOf(t, projectId, originalId)).toBe("binnen");
    const [key] = env.orig.keys();
    expect(sameBytes(env.orig.bytesOf(key!), clip)).toBe(true);
  });
});

// Fix-cyclus 2 (regie, red-team Z2): hooguit 30 inzendingen per lid tegelijk
// onderweg, over alle projecten. Een nieuwe aanmelding daarboven is `bezig`
// (A-keuze, zoals WP37 bij te veel open video-uploads), zonder R2 en zonder
// mee te tellen voor de daggrens. Hervatten van een inzending die al onderweg
// is mag altijd.
describe("inzendingen onderweg per lid (fix-cyclus 2)", () => {
  async function requestsOf(t: ReturnType<typeof newT>, ownerId: Id<"users">): Promise<number> {
    return (await t.run(async (ctx) => ctx.db.query("originalRequests" as never).collect())).filter(
      (r) => (r as { ownerId: unknown }).ownerId === ownerId,
    ).length;
  }

  it("de 31e nieuwe is bezig, zonder R2 en zonder te tellen; hervatten mag; na binnen of terugtrekken weer een nieuwe; een ander lid niet", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const bytes = PART_BYTES_ORACLE + MIB;
    const open: { photoId: Id<"photos">; originalId: string }[] = [];
    for (let i = 0; i < OPEN_ORIGINALS_PER_MEMBER_ORACLE; i++) {
      const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
      open.push({ photoId, originalId: (await announce(asFilm.bob(t), photoId, bytes)).originalId });
    }
    const extra = await newVideoInX(t, env.r2, w, w.users.bob);
    const creates = env.orig.creates().length;
    const counted = await requestsOf(t, w.users.bob);
    const refused = await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId: extra, bytes }));
    expectOriginalRefusal(refused, "bezig");
    expect(env.orig.creates()).toHaveLength(creates);
    expect(await requestsOf(t, w.users.bob)).toBe(counted);
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).originals).toHaveLength(OPEN_ORIGINALS_PER_MEMBER_ORACLE);

    // Hervatten van een die al onderweg is: gewoon links.
    const resumed = await announce(asFilm.bob(t), open[0]!.photoId, bytes);
    expect(resumed.originalId).toBe(open[0]!.originalId);

    // Een ander lid heeft zijn eigen grens.
    const alices = await newVideoInX(t, env.r2, w, w.users.alice);
    await announce(asFilm.alice(t), alices, MIN_ORIGINAL_BYTES_ORACLE);

    // Een teruggetrokken inzending maakt plaats.
    await asFilm.bob(t).mutation(filmApi.withdraw, { originalId: open[1]!.originalId });
    await announce(asFilm.bob(t), extra, bytes);
    const another = await newVideoInX(t, env.r2, w, w.users.bob);
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId: another, bytes })), "bezig");
  }, 60_000);

  it("een inzending die binnen komt, maakt plaats", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const first = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), first, ORIGINAL.byteLength);
    for (let i = 1; i < OPEN_ORIGINALS_PER_MEMBER_ORACLE; i++) {
      await announce(asFilm.bob(t), await newVideoInX(t, env.r2, w, w.users.bob), ORIGINAL.byteLength);
    }
    const extra = await newVideoInX(t, env.r2, w, w.users.bob);
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId: extra, bytes: ORIGINAL.byteLength })), "bezig");
    expect(await env.orig.putPart(s.parts[0]!.url, ORIGINAL)).toBe(200);
    expect(await asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })).toEqual({ kind: "done" });
    await announce(asFilm.bob(t), extra, ORIGINAL.byteLength);
  }, 60_000);
});

// Fix-cyclus 2 (regie, red-team Z2): de uurlijkse afrond-cron kijkt alleen
// inzendingen na waarvoor `startOriginal` in de laatste 7 dagen plus 1 dag
// deel-links gaf. Een link geldt 7 dagen; de dag erbij vangt een deel dat op
// het laatste moment binnenkwam. Daarna kan er zonder nieuwe aanmelding niets
// meer binnenkomen. De app rondt zelf altijd af. De grens precies op 8 dagen
// ligt bij B; de tests liggen op 7 dagen en 22 uur (wel) en 9 dagen (niet).
describe("de afrond-cron en oude links (fix-cyclus 2)", () => {
  const DAY = 24 * 60 * MINUTE_MS;

  it("9 dagen na de laatste links: de cron doet niets in R2 voor die inzending; de app rondt wel af", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w, 30 * DAY);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    const key = parseR2Link(s.parts[0]!.url).key;
    expect(await env.orig.putPart(s.parts[0]!.url, ORIGINAL)).toBe(200);
    advance(CRON_LINK_WINDOW_MS_ORACLE + DAY);
    const before = env.orig.calls.length;
    await t.action(filmInternal.completeUploaded, {});
    expect(env.orig.calls.slice(before).filter((c) => c.key === key)).toEqual([]);
    expect(await statusOf(t, projectId, s.originalId)).toBe("onderweg");

    expect(await asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })).toEqual({ kind: "done" });
    expect(await statusOf(t, projectId, s.originalId)).toBe("binnen");
  });

  it("7 dagen en 22 uur na de links, een deel op het laatste moment van zijn link: de cron rondt nog af", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w, 30 * DAY);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    advance(7 * DAY - MINUTE_MS);
    expect(await env.orig.putPart(s.parts[0]!.url, ORIGINAL)).toBe(200);
    advance(22 * 60 * MINUTE_MS + MINUTE_MS);
    await t.action(filmInternal.completeUploaded, {});
    expect(await statusOf(t, projectId, s.originalId)).toBe("binnen");
  });

  it("de laatste links tellen: na een nieuwe aanmelding op dag 6 rondt de cron op dag 12 nog af", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w, 30 * DAY);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    advance(6 * DAY);
    const again = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    expect(await env.orig.putPart(again.parts[0]!.url, ORIGINAL)).toBe(200);
    advance(6 * DAY + 22 * 60 * MINUTE_MS);
    await t.action(filmInternal.completeUploaded, {});
    expect(await statusOf(t, projectId, again.originalId)).toBe("binnen");
  });
});
