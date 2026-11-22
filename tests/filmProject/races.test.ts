import { describe, expect, it } from "vitest";
import { newT, parseR2Link, type T } from "../videos/_videos";
import {
  announce,
  asFilm,
  expectOriginalRefusal,
  filmApi,
  filmInternal,
  flush,
  newVideoInX,
  onceBefore,
  openProject,
  ORIGINAL,
  outcome,
  sameBytes,
  seedFilmWorld,
  useFilmEnv,
  type FilmWorld,
} from "./_film";

// WP38a fix-cyclus 1 — gelijktijdig afronden, hervatten en terugtrekken
// (audit B1 = red-team B1, red-team S1 en S2).
//   - Afronden kent drie uitkomsten voor de inzending: nu binnen, al binnen
//     (een gelijktijdige afronding was eerder), of weg (teruggetrokken of
//     verwijderd). Alleen bij "weg" gaat het object uit R2; bij "al binnen" is
//     het antwoord `done`.
//   - Een upload loskoppelen (opnieuw beginnen) mag alleen als de inzending
//     nog de upload heeft die de aanroeper zag; een nieuwere blijft staan.
//   - Hervatten terwijl een ander het origineel afrondt: is het object er al
//     met de aangemelde grootte, dan rondt hervatten af en zegt `done`; geen
//     nieuwe upload. Is de inzending intussen binnen, dan ook `done`.
// De volgorde ligt vast met `onceBefore`: de tweede aanroep loopt helemaal
// voordat het gekozen R2-verzoek van de eerste wordt afgehandeld.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Fix-cyclus 1.

const env = useFilmEnv();

async function statusOf(t: T, projectId: string, originalId: string) {
  const view = await asFilm.alice(t).query(filmApi.get, { projectId });
  return view.originals.find((o) => o.originalId === originalId)?.status ?? null;
}

/** Een inzending van bob met alle delen in R2, nog niet afgerond. */
async function allPartsSent(t: T, w: FilmWorld) {
  const projectId = await openProject(t, w);
  const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
  const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
  expect(await env.orig.putPart(s.parts[0]!.url, ORIGINAL)).toBe(200);
  return { projectId, photoId, originalId: s.originalId, key: parseR2Link(s.parts[0]!.url).key };
}

/** Binnen, met het object heel in R2, en de oprichter kan het downloaden. */
async function expectReceivedIntact(t: T, projectId: string, originalId: string, key: string) {
  await flush(t);
  expect(await statusOf(t, projectId, originalId)).toBe("binnen");
  expect(env.orig.keys()).toEqual([key]);
  expect(sameBytes(env.orig.bytesOf(key), ORIGINAL)).toBe(true);
  expect(env.orig.uploads.size).toBe(0);
  const d = await outcome(() => asFilm.alice(t).action(filmApi.downloadUrl, { originalId }));
  expect("ok" in d, `download: ${JSON.stringify(d)}`).toBe(true);
}

const isComplete = (c: { method: string; query: Record<string, string> }) => c.method === "POST" && c.query.uploadId !== undefined;
const isListParts = (c: { method: string; query: Record<string, string> }) => c.method === "GET" && c.query.uploadId !== undefined;
const isHead = (c: { method: string }) => c.method === "HEAD";
const isCreate = (c: { method: string; query: Record<string, string> }) => c.method === "POST" && "uploads" in c.query;

describe("twee keer tegelijk afronden (audit B1)", () => {
  it("de app rondt twee keer tegelijk af: beide done, het origineel is binnen en heel", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const o = await allPartsSent(t, w);
    const [a, b] = await Promise.all([
      outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: o.originalId })),
      outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: o.originalId })),
    ]);
    expect(a).toEqual({ ok: { kind: "done" } });
    expect(b).toEqual({ ok: { kind: "done" } });
    await expectReceivedIntact(t, o.projectId, o.originalId, o.key);
  });

  it("een tweede afronding loopt helemaal terwijl de eerste nog moet afronden in R2: de eerste zegt done en wist niets", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const o = await allPartsSent(t, w);
    let second: unknown = null;
    const hook = onceBefore(env.orig, isComplete, async () => {
      second = await outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: o.originalId }));
    });
    const first = await outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: o.originalId }));
    expect(hook.fired()).toBe(true);
    expect(second).toEqual({ ok: { kind: "done" } });
    expect(first).toEqual({ ok: { kind: "done" } });
    await expectReceivedIntact(t, o.projectId, o.originalId, o.key);
  });

  it("de cron met een oude stand: de app rondt af terwijl de cron bezig is; de cron wist het object niet", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const o = await allPartsSent(t, w);
    let app: unknown = null;
    // De cron heeft de inzending als "onderweg" gelezen; zijn eerste R2-verzoek
    // wacht tot de app helemaal heeft afgerond.
    const hook = onceBefore(env.orig, isListParts, async () => {
      app = await outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: o.originalId }));
    });
    await t.action(filmInternal.completeUploaded, {});
    expect(hook.fired()).toBe(true);
    expect(app).toEqual({ ok: { kind: "done" } });
    await expectReceivedIntact(t, o.projectId, o.originalId, o.key);
  });

  it("andersom: de cron rondt af terwijl de app bezig is; de app krijgt done", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const o = await allPartsSent(t, w);
    const hook = onceBefore(env.orig, isComplete, async () => {
      await t.action(filmInternal.completeUploaded, {});
    });
    const app = await outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: o.originalId }));
    expect(hook.fired()).toBe(true);
    expect(app).toEqual({ ok: { kind: "done" } });
    await expectReceivedIntact(t, o.projectId, o.originalId, o.key);
  });
});

describe("terugtrekken tijdens het afronden: het object gaat weg", () => {
  for (const [moment, match] of [
    ["vlak voordat R2 de upload afrondt", isComplete],
    ["nadat R2 de upload afrondde, vóór binnen", isHead],
  ] as const) {
    it(moment, async () => {
      const t = newT();
      const w = await seedFilmWorld(t);
      const o = await allPartsSent(t, w);
      const hook = onceBefore(env.orig, match, async () => {
        await asFilm.bob(t).mutation(filmApi.withdraw, { originalId: o.originalId });
      });
      const result = await outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: o.originalId }));
      expect(hook.fired()).toBe(true);
      expectOriginalRefusal(result, "niet_toegestaan");
      await flush(t);
      expect((await asFilm.alice(t).query(filmApi.get, { projectId: o.projectId })).originals).toEqual([]);
      expect(env.orig.keys()).toEqual([]);
      expect(env.orig.uploads.size).toBe(0);
    });
  }
});

describe("opnieuw beginnen met vergelijk-en-wissel (red-team S1)", () => {
  it("de cron met de oude upload U1 koppelt de nieuwe upload U2 van de app niet los", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const first = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    const u1 = parseR2Link(first.parts[0]!.url).params.uploadId!;
    // R2 kent U1 niet meer (afgebroken, bv. door de lifecycle-regel).
    env.orig.uploads.delete(u1);

    // De cron leest de inzending met U1. Voordat zijn lijst van delen terugkomt,
    // meldt de app zich opnieuw aan en krijgt een nieuwe upload U2.
    let again: Awaited<ReturnType<typeof announce>> | null = null;
    const hook = onceBefore(env.orig, (c) => isListParts(c) && c.query.uploadId === u1, async () => {
      again = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    });
    await t.action(filmInternal.completeUploaded, {});
    expect(hook.fired()).toBe(true);
    const second = again as Awaited<ReturnType<typeof announce>> | null;
    expect(second?.originalId).toBe(first.originalId);
    const u2 = parseR2Link(second!.parts[0]!.url).params.uploadId!;
    expect(u2).not.toBe(u1);

    // De app stuurt het deel op U2 en rondt af: dat moet lukken.
    expect(await env.orig.putPart(second!.parts[0]!.url, ORIGINAL)).toBe(200);
    expect(await asFilm.bob(t).action(filmApi.finishOriginal, { originalId: first.originalId })).toEqual({ kind: "done" });
    await expectReceivedIntact(t, projectId, first.originalId, parseR2Link(second!.parts[0]!.url).key);
    expect(env.orig.creates()).toHaveLength(2);
  });
});

describe("hervatten tijdens het afronden (red-team S2)", () => {
  it("R2 heeft de upload al afgerond, het object is er met de aangemelde grootte: startOriginal zegt done, geen nieuwe upload", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const o = await allPartsSent(t, w);
    let resumed: unknown = null;
    const hook = onceBefore(env.orig, isHead, async () => {
      resumed = await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId: o.photoId, bytes: ORIGINAL.byteLength }));
    });
    const finished = await outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: o.originalId }));
    expect(hook.fired()).toBe(true);
    expect(resumed).toEqual({ ok: { kind: "done", originalId: o.originalId } });
    expect(finished).toEqual({ ok: { kind: "done" } });
    expect(env.orig.creates()).toHaveLength(1);
    await expectReceivedIntact(t, o.projectId, o.originalId, o.key);
  });

  it("de inzending is binnen gekomen terwijl hervatten een nieuwe upload maakte: done, en die nieuwe upload wordt afgebroken", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const first = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    const u1 = parseR2Link(first.parts[0]!.url).params.uploadId!;
    env.orig.uploads.delete(u1);

    // Hervatten A ziet dat U1 weg is en maakt een nieuwe upload. Voordat R2
    // die aanmaakt, loopt hervatten B helemaal: nieuwe upload, deel, afronden.
    let key = "";
    const hook = onceBefore(env.orig, isCreate, async () => {
      const b = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
      key = parseR2Link(b.parts[0]!.url).key;
      expect(await env.orig.putPart(b.parts[0]!.url, ORIGINAL)).toBe(200);
      expect(await asFilm.bob(t).action(filmApi.finishOriginal, { originalId: b.originalId })).toEqual({ kind: "done" });
    });
    const a = await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes: ORIGINAL.byteLength }));
    expect(hook.fired()).toBe(true);
    expect(a).toEqual({ ok: { kind: "done", originalId: first.originalId } });
    await expectReceivedIntact(t, projectId, first.originalId, key);
  });
});
