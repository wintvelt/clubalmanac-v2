import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { formatsOf, I, seedPhoto, storageCount, textOf } from "./_helpers";

// WP25 — de formaat-stap na de upload en de backfill (spec §Signaturen,
// §De T0-keten; invariant 2, 11, 12, 17).
//
//   internal.photoFormats.makeFormats({ photoId })
//     → "created" | "alreadyDone" | "gone" | "failed"
//   internal.photoFormats.backfill({ cursor: string | null, batchSize })
//     → { cursor: string | null, created, alreadyDone, gone, failed: photoId[] }
//
// De beeldbibliotheek is hier gemockt: de pixels pint tests/photoFormats/
// images.test.ts in Node met de echte bibliotheek. Hier gaat het om wat de stap
// met de DB en storage doet. De mock leest het "origineel" als tekst:
//   - "kapot" erin: gooit, zoals bij bytes die geen beeld zijn;
//   - "tag=<n>" erin: de stand uit het bestand is n;
//   - "badmeta" erin: een breedte die geen getal is, zodat het vastleggen
//     mislukt (de args-validator van attachFormats weigert hem);
//   - anders: geen stand (geen tag, of HEIC).

vi.mock("../../convex/lib/photoFormats", () => ({
  makeFormatImages: async (bytes: Uint8Array) => {
    const text = new TextDecoder().decode(bytes);
    if (text.includes("kapot")) throw new Error("geen beeld");
    const tag = /tag=(\d)/.exec(text)?.[1];
    return {
      klein: new TextEncoder().encode(`klein:${text}`),
      groot: new TextEncoder().encode(`groot:${text}`),
      width: text.includes("badmeta") ? ("geen getal" as unknown as number) : 4000,
      height: 3000,
      ...(tag ? { exifOrientation: Number(tag) } : {}),
    };
  },
}));

type T = ReturnType<typeof convexTest>;
type Batch = {
  cursor: string | null;
  created: number;
  alreadyDone: number;
  gone: number;
  failed: Id<"photos">[];
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Eén volledige doorloop, zoals het CLI-commando `formaten` hem doet. */
async function fullPass(t: T, batchSize = 2) {
  const total = { created: 0, alreadyDone: 0, gone: 0, failed: [] as Id<"photos">[], batches: 0 };
  let cursor: string | null = null;
  do {
    const r: Batch = await t.action(I.photoFormats.backfill, { cursor, batchSize });
    total.created += r.created;
    total.alreadyDone += r.alreadyDone;
    total.gone += r.gone;
    total.failed.push(...r.failed);
    total.batches += 1;
    cursor = r.cursor;
    if (total.batches > 100) throw new Error("de doorloop eindigt niet");
  } while (cursor !== null);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return total;
}

async function owner(t: T) {
  return await registerUser(t, "user_owen", "owen@x.com", "Owen");
}

describe("upload plant de formaat-stap (invariant 2)", () => {
  it("POST /upload plant makeFormats één keer voor de nieuwe foto, naast extractMetadata", async () => {
    const t = convexTest(schema, modules);
    await owner(t);
    const init = {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "X-Upload-Id": "u-1" },
      body: "jpeg-bytes",
    };

    const res = await withUser(t, "user_owen").fetch("/upload", init);
    expect(res.status).toBe(200);
    const { photoId } = (await res.json()) as { photoId: string };
    // Een herhaalde upload (zelfde X-Upload-Id) plant niets nieuws.
    await withUser(t, "user_owen").fetch("/upload", init);

    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const calls = scheduled.filter((s) => /photoFormats.*makeFormats/.test(String(s.name)));
    expect(calls).toHaveLength(1);
    expect((calls[0]!.args as Array<{ photoId: string }>)[0]?.photoId).toBe(photoId);
    expect(scheduled.filter((s) => String(s.name).includes("extractMetadata"))).toHaveLength(1);
  });
});

describe("makeFormats: één foto", () => {
  it("'created': twee JPEG-objecten uit het origineel, vastgelegd op de foto", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t), { original: "foto-1 tag=6" });

    const result = await t.action(I.photoFormats.makeFormats, { photoId: p.photoId });

    expect(result).toBe("created");
    const f = await formatsOf(t, p.photoId);
    expect(f).toBeDefined();
    expect(await textOf(t, f!.klein)).toBe("klein:foto-1 tag=6");
    expect(await textOf(t, f!.groot)).toBe("groot:foto-1 tag=6");
    // convex-test zet geen `contentType` in `_storage` (alleen size en sha256),
    // maar bewaart de Blob zelf. Het type van die Blob is wat Convex in
    // productie als `contentType` vastlegt.
    const types = await t.run(async (ctx) => [
      (await ctx.storage.get(f!.klein))?.type,
      (await ctx.storage.get(f!.groot))?.type,
    ]);
    expect(types).toEqual(["image/jpeg", "image/jpeg"]);
    expect(await textOf(t, p.storageId), "het origineel blijft ongewijzigd").toBe("foto-1 tag=6");
  });

  it("invariant 12: de stand uit het bestand en de afmetingen komen mee, in dezelfde schrijfactie", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t), { original: "foto-1 tag=6" });

    await t.action(I.photoFormats.makeFormats, { photoId: p.photoId });

    const photo = await t.run((ctx) => ctx.db.get(p.photoId));
    expect(photo?.exifOrientation).toBe(6);
    expect([photo?.width, photo?.height]).toEqual([4000, 3000]);
  });

  it("'alreadyDone': een foto met formaten krijgt geen tweede set, en storage groeit niet", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t), { withFormats: true });
    const before = await storageCount(t);

    const result = await t.action(I.photoFormats.makeFormats, { photoId: p.photoId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(result).toBe("alreadyDone");
    expect(await formatsOf(t, p.photoId)).toEqual({ klein: p.klein, groot: p.groot });
    expect(await storageCount(t)).toBe(before);
  });

  it("'gone': de foto is weg, er blijft niets achter", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t));
    await t.run((ctx) => ctx.db.delete(p.photoId));
    const before = await storageCount(t);

    const result = await t.action(I.photoFormats.makeFormats, { photoId: p.photoId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(result).toBe("gone");
    expect(await storageCount(t)).toBe(before);
  });

  it("'failed': geen beeld, de foto blijft ongewijzigd, er blijft niets achter", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t), { original: "kapot tag=6" });
    const before = await storageCount(t);

    const result = await t.action(I.photoFormats.makeFormats, { photoId: p.photoId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(result).toBe("failed");
    expect(await formatsOf(t, p.photoId)).toBeUndefined();
    const photo = await t.run((ctx) => ctx.db.get(p.photoId));
    expect(photo?.exifOrientation, "geen stand zonder formaten (invariant 12)").toBeUndefined();
    expect(await storageCount(t)).toBe(before);
  });

  it("'failed': het origineel is weg uit storage (dangling), geen crash", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t));
    await t.run((ctx) => ctx.storage.delete(p.storageId));

    const result = await t.action(I.photoFormats.makeFormats, { photoId: p.photoId });

    expect(result).toBe("failed");
    expect(await formatsOf(t, p.photoId)).toBeUndefined();
  });

  it("invariant 7 en 12: een gedraaide foto houdt zijn stand", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t), { original: "foto tag=6", exifOrientation: 3 });

    await t.action(I.photoFormats.makeFormats, { photoId: p.photoId });

    const photo = await t.run((ctx) => ctx.db.get(p.photoId));
    expect(photo?.exifOrientation).toBe(3);
    expect(await formatsOf(t, p.photoId)).toBeDefined();
  });
});

describe("makeFormats: herstel en opruimen (fix-cyclus 1)", () => {
  it("invariant 22: een set waarvan 'klein' weg is, telt als 'geen formaten': 'created', nieuwe set, geen wees", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t), { original: "foto tag=6", withFormats: true, exifOrientation: 6 });
    await t.run((ctx) => ctx.storage.delete(p.klein!));

    const result = await t.action(I.photoFormats.makeFormats, { photoId: p.photoId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(result).toBe("created");
    const f = await formatsOf(t, p.photoId);
    expect(f?.klein).not.toBe(p.klein);
    expect(await textOf(t, f!.klein)).toBe("klein:foto tag=6");
    expect(await textOf(t, f!.groot)).toBe("groot:foto tag=6");
    expect(await storageCount(t), "origineel + de nieuwe set, niets van de oude").toBe(3);
  });

  it("S2-M16: mislukt het vastleggen, dan gaan de net opgeslagen objecten weer weg: 'failed', geen wees", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t), { original: "badmeta tag=6" });
    const before = await storageCount(t);

    const result = await t.action(I.photoFormats.makeFormats, { photoId: p.photoId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(result).toBe("failed");
    expect(await formatsOf(t, p.photoId)).toBeUndefined();
    expect(await storageCount(t)).toBe(before);
  });
});

describe("backfill (invariant 2, 11)", () => {
  it("één doorloop: elke foto krijgt formaten, de tellingen kloppen", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    const ids: Id<"photos">[] = [];
    for (let i = 0; i < 5; i++) ids.push((await seedPhoto(t, o, { original: `foto-${i}` })).photoId);
    const before = await storageCount(t);

    const run = await fullPass(t, 2);

    expect(run.created).toBe(5);
    expect(run.alreadyDone).toBe(0);
    expect(run.failed).toEqual([]);
    expect(run.batches, "batchSize 2 over 5 foto's").toBeGreaterThanOrEqual(3);
    for (const id of ids) expect(await formatsOf(t, id)).toBeDefined();
    expect(await storageCount(t)).toBe(before + 10);
    expect(await t.query(I.photos.formatStatus, {})).toMatchObject({ photos: 5, withoutFormats: 0 });
  });

  it("run 2 verandert niets: alles 'alreadyDone', storage gelijk, formaten gelijk", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    const ids: Id<"photos">[] = [];
    for (let i = 0; i < 4; i++) ids.push((await seedPhoto(t, o, { original: `foto-${i} tag=6` })).photoId);
    await fullPass(t);
    const formatsAfterRun1 = await Promise.all(ids.map((id) => formatsOf(t, id)));
    const storageAfterRun1 = await storageCount(t);

    const run2 = await fullPass(t);

    expect(run2.created).toBe(0);
    expect(run2.alreadyDone).toBe(4);
    expect(run2.failed).toEqual([]);
    expect(await storageCount(t)).toBe(storageAfterRun1);
    expect(await Promise.all(ids.map((id) => formatsOf(t, id)))).toEqual(formatsAfterRun1);
  });

  it("hervatten: een doorloop die na één batch stopte, gaat bij de volgende run verder", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    for (let i = 0; i < 5; i++) await seedPhoto(t, o, { original: `foto-${i}` });

    // Eén batch, daarna "valt de laptop dicht".
    const first: Batch = await t.action(I.photoFormats.backfill, { cursor: null, batchSize: 2 });
    expect(first.created).toBe(2);
    expect(first.cursor).not.toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Halverwege werkt alles: twee met formaten, drie zonder (invariant 3).
    expect(await t.query(I.photos.formatStatus, {})).toMatchObject({ withFormats: 2, withoutFormats: 3 });

    // Een nieuwe run begint gewoon opnieuw en slaat over wat klaar is.
    const rest = await fullPass(t, 2);
    expect(rest.created).toBe(3);
    expect(rest.alreadyDone).toBe(2);
    expect(await t.query(I.photos.formatStatus, {})).toMatchObject({ withFormats: 5, withoutFormats: 0 });
  });

  it("een foto die mislukt, blokkeert de rest niet en komt in de telling", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    await seedPhoto(t, o, { original: "foto-a" });
    const bad = await seedPhoto(t, o, { original: "kapot" });
    await seedPhoto(t, o, { original: "foto-c" });

    const run1 = await fullPass(t, 1);
    expect(run1.created).toBe(2);
    expect(run1.failed).toEqual([bad.photoId]);
    expect(await formatsOf(t, bad.photoId)).toBeUndefined();

    // Run 2 probeert hem opnieuw, en meldt hem opnieuw: niet stil.
    const run2 = await fullPass(t, 1);
    expect(run2.created).toBe(0);
    expect(run2.failed).toEqual([bad.photoId]);
  });

  it("invariant 12: de backfill zet de stand alleen als die leeg is", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    const fresh = await seedPhoto(t, o, { original: "migratie tag=6" });
    const noTag = await seedPhoto(t, o, { original: "migratie zonder tag" });
    const rotated = await seedPhoto(t, o, { original: "migratie tag=6", exifOrientation: 1 });

    await fullPass(t);

    const get = (id: Id<"photos">) => t.run((ctx) => ctx.db.get(id));
    expect((await get(fresh.photoId))?.exifOrientation).toBe(6);
    expect((await get(noTag.photoId))?.exifOrientation).toBeUndefined();
    expect((await get(rotated.photoId))?.exifOrientation).toBe(1);
  });

  it("een foto die tijdens de doorloop gewist wordt, laat geen wezen achter", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    for (let i = 0; i < 3; i++) await seedPhoto(t, o, { original: `foto-${i}` });
    const doomed = await seedPhoto(t, o, { original: "gaat weg" });
    const first: Batch = await t.action(I.photoFormats.backfill, { cursor: null, batchSize: 2 });
    // Gewist zoals een user dat doet (P3/P5/U7), al dan niet al verwerkt.
    await withUser(t, "user_owen").mutation(api.photos.remove, { photoId: doomed.photoId });

    let cursor = first.cursor;
    while (cursor !== null) {
      const r: Batch = await t.action(I.photoFormats.backfill, { cursor, batchSize: 2 });
      cursor = r.cursor;
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const inventory = await t.query(I.migration.storageInventory, {});
    expect(inventory.orphanCount).toBe(0);
    expect(inventory.danglingCount).toBe(0);
  });

  it("invariant 22: de backfill herstelt een set met een ontbrekend object (geen 'alreadyDone')", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t);
    const ok = await seedPhoto(t, o, { original: "heel", withFormats: true });
    const broken = await seedPhoto(t, o, { original: "half", withFormats: true });
    await t.run((ctx) => ctx.storage.delete(broken.groot!));

    const total = await fullPass(t);

    expect(total).toMatchObject({ created: 1, alreadyDone: 1, gone: 0, failed: [] });
    expect(await formatsOf(t, ok.photoId)).toEqual({ klein: ok.klein, groot: ok.groot });
    const f = await formatsOf(t, broken.photoId);
    expect(await textOf(t, f!.groot)).toBe("groot:half");
    expect(await t.query(I.migration.storageInventory, { sampleSize: 100 })).toMatchObject({
      orphanCount: 0,
      danglingCount: 0,
    });
  });

  it("lege deployment: één batch, cursor null, alles nul", async () => {
    const t = convexTest(schema, modules);
    const r: Batch = await t.action(I.photoFormats.backfill, { cursor: null, batchSize: 10 });
    expect(r).toEqual({ cursor: null, created: 0, alreadyDone: 0, gone: 0, failed: [] });
  });
});
