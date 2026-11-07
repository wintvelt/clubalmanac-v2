import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { formatsOf, I, seedPhoto } from "./_helpers";

// WP25 fix-cyclus 2 — een foto zonder formaten bewust aftekenen (A-invariant 25,
// kernvondst 13).
//
// Een foto die blijft mislukken (kapot origineel, een JPEG van 64 MP die de
// action laat omvallen) hield T0 tegen: `formaten` eindigde op 1 en `verify`
// meldde `formaten ontbreken`. De operator tekent zo'n foto nu af, bij zijn id:
//
//   internal.photos.acceptNoFormats({ photoIds }) → het aantal
//
// Alles of niets. Daarna slaat de backfill de foto over (`accepted`), telt
// `formatStatus` hem apart, en meldt de integriteitsscan hem niet meer. De
// stap na een upload en `makeFormats` kijken niet naar het veld.
//
// De beeldbibliotheek is nep, zoals in backfill.test.ts; `seen` houdt bij welke
// originelen hij kreeg.

const seen = vi.hoisted(() => [] as string[]);

vi.mock("../../convex/lib/photoFormats", () => ({
  HEIC_MAX_PIXELS: 13_000_000,
  makeFormatImages: async (bytes: Uint8Array) => {
    const text = new TextDecoder().decode(bytes);
    seen.push(text);
    if (text.includes("kapot")) throw new Error("geen beeld");
    return {
      klein: new TextEncoder().encode(`klein:${text}`),
      groot: new TextEncoder().encode(`groot:${text}`),
      width: 4000,
      height: 3000,
    };
  },
}));

type T = ReturnType<typeof convexTest>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

const NOW = new Date("2026-11-20T04:30:00.000Z").getTime();
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  seen.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

async function owner(t: T) {
  return await registerUser(t, "user_owen", "owen@x.com", "Owen");
}

async function acceptedAt(t: T, photoId: Id<"photos">): Promise<unknown> {
  const photo = (await t.run((ctx) => ctx.db.get(photoId))) as R | null;
  return photo?.noFormatsAcceptedAt;
}

/** Eén volledige doorloop van de backfill; de opgetelde uitkomst. */
async function fullPass(t: T, batchSize = 2) {
  const total = { created: 0, alreadyDone: 0, gone: 0, accepted: 0, failed: [] as Id<"photos">[] };
  let cursor: string | null = null;
  let batches = 0;
  do {
    const r = (await t.action(I.photoFormats.backfill, { cursor, batchSize })) as R;
    total.created += r.created;
    total.alreadyDone += r.alreadyDone;
    total.gone += r.gone;
    total.accepted += r.accepted;
    total.failed.push(...r.failed);
    cursor = r.cursor;
    if (++batches > 100) throw new Error("de doorloop eindigt niet");
  } while (cursor !== null);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return total;
}

describe("acceptNoFormats: vastleggen, alles of niets", () => {
  it("legt per genoemde foto de tijd vast en geeft het aantal", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    const a = await seedPhoto(t, o, { original: "kapot a" });
    const b = await seedPhoto(t, o, { original: "kapot b" });
    const c = await seedPhoto(t, o, { original: "gewoon" });

    const n = await t.mutation(I.photos.acceptNoFormats, { photoIds: [a.photoId, b.photoId] });

    expect(n).toBe(2);
    expect(await acceptedAt(t, a.photoId)).toBe(NOW);
    expect(await acceptedAt(t, b.photoId)).toBe(NOW);
    expect(await acceptedAt(t, c.photoId), "niet genoemd: niet afgetekend").toBeUndefined();
  });

  it("een foto met een volledige set: gooit, en tekent ook de andere niet af", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    const bad = await seedPhoto(t, o, { original: "kapot" });
    const done = await seedPhoto(t, o, { withFormats: true });

    await expect(
      t.mutation(I.photos.acceptNoFormats, { photoIds: [bad.photoId, done.photoId] }),
    ).rejects.toThrow();

    expect(await acceptedAt(t, bad.photoId)).toBeUndefined();
    expect(await acceptedAt(t, done.photoId)).toBeUndefined();
  });

  it("een foto met een dangling set: gooit (eerst laat een gewone run hem herstellen)", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    const half = await seedPhoto(t, o, { withFormats: true });
    await t.run((ctx) => ctx.storage.delete(half.klein!));

    await expect(t.mutation(I.photos.acceptNoFormats, { photoIds: [half.photoId] })).rejects.toThrow();
    expect(await acceptedAt(t, half.photoId)).toBeUndefined();
  });

  it("een id dat geen foto (meer) is: gooit, en schrijft niets", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    const bad = await seedPhoto(t, o, { original: "kapot" });
    const gone = await seedPhoto(t, o);
    await t.run((ctx) => ctx.db.delete(gone.photoId));

    await expect(
      t.mutation(I.photos.acceptNoFormats, { photoIds: [bad.photoId, gone.photoId] }),
    ).rejects.toThrow();
    expect(await acceptedAt(t, bad.photoId)).toBeUndefined();
  });
});

describe("de backfill slaat een afgetekende foto over", () => {
  it("telt hem als accepted, niet als mislukt, en raakt zijn origineel niet aan", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    const a = await seedPhoto(t, o, { original: "kapot a" });
    const ok = await seedPhoto(t, o, { original: "gewoon" });
    await t.mutation(I.photos.acceptNoFormats, { photoIds: [a.photoId] });

    const total = await fullPass(t);

    expect(total).toMatchObject({ created: 1, alreadyDone: 0, gone: 0, accepted: 1, failed: [] });
    expect(seen).toEqual(["gewoon"]);
    expect(await formatsOf(t, a.photoId)).toBeUndefined();
    expect(await formatsOf(t, ok.photoId)).toBeDefined();
  });

  it("formatBatch zegt per foto of hij is afgetekend", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    const a = await seedPhoto(t, o, { original: "kapot" });
    const b = await seedPhoto(t, o, { original: "gewoon" });
    await t.mutation(I.photos.acceptNoFormats, { photoIds: [a.photoId] });

    const page = (await t.query(I.photos.formatBatch, { cursor: null, batchSize: 10 })) as R;

    const byId = new Map((page.photos as R[]).map((p) => [p.photoId, p]));
    expect(byId.get(a.photoId)).toMatchObject({ hasFormats: false, noFormatsAccepted: true });
    expect(byId.get(b.photoId)).toMatchObject({ hasFormats: false, noFormatsAccepted: false });
  });

  it("makeFormats zelf kijkt niet naar het veld: krijgt de foto toch formaten, dan gelden die", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    const a = await seedPhoto(t, o, { original: "toch leesbaar" });
    await t.mutation(I.photos.acceptNoFormats, { photoIds: [a.photoId] });

    expect(await t.action(I.photoFormats.makeFormats, { photoId: a.photoId })).toBe("created");
    expect(await formatsOf(t, a.photoId)).toBeDefined();
  });
});

describe("formatStatus en de bewaking", () => {
  it("formatStatus telt de afgetekende foto's zonder volledige set apart", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    const a = await seedPhoto(t, o, { original: "kapot a" });
    const b = await seedPhoto(t, o, { original: "later toch" });
    await seedPhoto(t, o, { original: "nog niet" });
    await seedPhoto(t, o, { withFormats: true });
    await t.mutation(I.photos.acceptNoFormats, { photoIds: [a.photoId, b.photoId] });
    await t.action(I.photoFormats.makeFormats, { photoId: b.photoId });

    expect(await t.query(I.photos.formatStatus, {})).toEqual({
      photos: 4,
      withFormats: 2,
      withoutFormats: 2,
      withExifOrientation: 0,
      acceptedWithoutFormats: 1,
    });
  });

  it("de integriteitsscan (WP10, verify) meldt een afgetekende foto niet als 'formaten ontbreken'", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    await t.run((ctx) => ctx.db.patch(o, { photoCount: 2 }));
    const a = await seedPhoto(t, o, { original: "kapot", createdAt: NOW - 30 * 24 * HOUR });
    const b = await seedPhoto(t, o, { original: "nog niet", createdAt: NOW - 2 * HOUR });
    await t.mutation(I.photos.acceptNoFormats, { photoIds: [a.photoId] });

    const lines = await t.query(internal.migration.integrityReport, {});

    expect(lines.some((l) => l.includes(a.photoId))).toBe(false);
    expect(lines.some((l) => l.includes(b.photoId) && l.includes("formaten ontbreken"))).toBe(true);
  });
});
