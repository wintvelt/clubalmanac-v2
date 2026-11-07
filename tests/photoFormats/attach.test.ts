import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import { registerUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { exists, formatsOf, I, seedPhoto, storageCount } from "./_helpers";

// WP25 — een set formaten vastleggen: `internal.photos.attachFormats`
// (spec §Signaturen; A-invariant 12 en 17) en de telling `formatStatus`.
//
//   attachFormats({ photoId, klein, groot, width?, height?, exifOrientation? })
//     → "attached" | "alreadyDone" | "gone"
//
// Invariant 12: de oriëntatie uit het bestand komt alleen samen met de formaten
// in de DB, en alleen als `exifOrientation` nog leeg is (een draaiing van WP8
// blijft staan). `width`/`height` idem: alleen als ze leeg zijn.
// Invariant 17: de eerste set blijft. Een te late set (foto heeft al formaten,
// of is weg) wordt niet vastgelegd, en zijn objecten verdwijnen uit storage.

type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function newObjects(t: T, label: string) {
  return await t.run(async (ctx) => ({
    klein: await ctx.storage.store(new Blob([`klein ${label}`], { type: "image/jpeg" })),
    groot: await ctx.storage.store(new Blob([`groot ${label}`], { type: "image/jpeg" })),
  }));
}

async function setup(t: T) {
  const owner = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  return { owner };
}

describe("attachFormats: vastleggen", () => {
  it("legt de set vast en geeft 'attached'", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await setup(t);
    const p = await seedPhoto(t, owner);
    const set = await newObjects(t, "1");

    const result = await t.mutation(I.photos.attachFormats, { photoId: p.photoId, ...set });

    expect(result).toBe("attached");
    expect(await formatsOf(t, p.photoId)).toEqual(set);
    const photo = await t.run((ctx) => ctx.db.get(p.photoId));
    expect(photo?.storageId, "het origineel blijft het origineel").toBe(p.storageId);
  });

  it("invariant 12: vult exifOrientation, width en height als ze leeg zijn", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await setup(t);
    const p = await seedPhoto(t, owner);
    const set = await newObjects(t, "1");

    await t.mutation(I.photos.attachFormats, {
      photoId: p.photoId,
      ...set,
      width: 4032,
      height: 3024,
      exifOrientation: 6,
    });

    const photo = await t.run((ctx) => ctx.db.get(p.photoId));
    expect(photo?.exifOrientation).toBe(6);
    expect(photo?.width).toBe(4032);
    expect(photo?.height).toBe(3024);
  });

  it("invariant 12: een stand die er al staat (draaien, WP8) blijft staan", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await setup(t);
    const p = await seedPhoto(t, owner, { exifOrientation: 8, width: 3024, height: 4032 });
    const set = await newObjects(t, "1");

    await t.mutation(I.photos.attachFormats, {
      photoId: p.photoId,
      ...set,
      width: 4032,
      height: 3024,
      exifOrientation: 6,
    });

    const photo = await t.run((ctx) => ctx.db.get(p.photoId));
    expect(photo?.exifOrientation).toBe(8);
    expect(photo?.width).toBe(3024);
    expect(photo?.height).toBe(4032);
    expect(await formatsOf(t, p.photoId)).toEqual(set);
  });

  it("zonder stand (geen tag, of HEIC): exifOrientation blijft leeg", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await setup(t);
    const p = await seedPhoto(t, owner);
    const set = await newObjects(t, "1");

    await t.mutation(I.photos.attachFormats, { photoId: p.photoId, ...set });

    const photo = await t.run((ctx) => ctx.db.get(p.photoId));
    expect(photo?.exifOrientation).toBeUndefined();
  });
});

describe("attachFormats: één set per foto, ook bij een race (invariant 17)", () => {
  it("heeft de foto al formaten: 'alreadyDone', de eerste set blijft, de nieuwe objecten gaan weg", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await setup(t);
    const p = await seedPhoto(t, owner, { withFormats: true });
    const late = await newObjects(t, "te laat");

    const result = await t.mutation(I.photos.attachFormats, {
      photoId: p.photoId,
      ...late,
      exifOrientation: 6,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(result).toBe("alreadyDone");
    expect(await formatsOf(t, p.photoId)).toEqual({ klein: p.klein, groot: p.groot });
    expect(await exists(t, p.klein!)).toBe(true);
    expect(await exists(t, p.groot!)).toBe(true);
    expect(await exists(t, late.klein), "wees: klein van de te late set").toBe(false);
    expect(await exists(t, late.groot), "wees: groot van de te late set").toBe(false);
    const photo = await t.run((ctx) => ctx.db.get(p.photoId));
    expect(photo?.exifOrientation, "een te late set zet ook geen stand").toBeUndefined();
  });

  it("is de foto weg: 'gone', en de nieuwe objecten gaan weg", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await setup(t);
    const p = await seedPhoto(t, owner);
    await t.run((ctx) => ctx.db.delete(p.photoId));
    const set = await newObjects(t, "voor een gewiste foto");

    const result = await t.mutation(I.photos.attachFormats, { photoId: p.photoId, ...set });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(result).toBe("gone");
    expect(await exists(t, set.klein)).toBe(false);
    expect(await exists(t, set.groot)).toBe(false);
  });

  it("twee stappen tegelijk voor dezelfde foto: na afloop één set en geen wezen", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await setup(t);
    const p = await seedPhoto(t, owner);
    const a = await newObjects(t, "a");
    const b = await newObjects(t, "b");
    const before = await storageCount(t);

    const results = [
      await t.mutation(I.photos.attachFormats, { photoId: p.photoId, ...a }),
      await t.mutation(I.photos.attachFormats, { photoId: p.photoId, ...b }),
    ];
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(results).toEqual(["attached", "alreadyDone"]);
    expect(await formatsOf(t, p.photoId)).toEqual(a);
    expect(await storageCount(t)).toBe(before - 2);
  });
});

describe("formatStatus: de telling (invariant 2, pre-flight)", () => {
  it("telt foto's, met en zonder formaten, en met een stand", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await setup(t);
    await seedPhoto(t, owner, { withFormats: true, exifOrientation: 6 });
    await seedPhoto(t, owner, { withFormats: true });
    await seedPhoto(t, owner);
    await seedPhoto(t, owner, { exifOrientation: 3 });

    const status = await t.query(I.photos.formatStatus, {});

    expect(status).toEqual({
      photos: 4,
      withFormats: 2,
      withoutFormats: 2,
      withExifOrientation: 2,
    });
  });

  it("lege deployment: alles nul", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(I.photos.formatStatus, {})).toEqual({
      photos: 0,
      withFormats: 0,
      withoutFormats: 0,
      withExifOrientation: 0,
    });
  });
});

describe("attachFormats: een set met een ontbrekend object (fix-cyclus 1, invariant 22)", () => {
  // R3: `prune-storage` na een Ctrl-C terwijl een action nog loopt, wist de
  // objecten die die action net opsloeg. Legt hij ze daarna vast, dan wijst de
  // foto naar niets, en dat herstelde nooit: de backfill zag 'alreadyDone'.

  it("een set waarvan 'klein' weg is: de nieuwe set vervangt hem, het overgebleven oude object gaat weg", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await setup(t);
    const p = await seedPhoto(t, owner, { withFormats: true, exifOrientation: 6 });
    await t.run((ctx) => ctx.storage.delete(p.klein!));
    const set = await newObjects(t, "herstel");

    const result = await t.mutation(I.photos.attachFormats, { photoId: p.photoId, ...set, exifOrientation: 3 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(result).toBe("attached");
    expect(await formatsOf(t, p.photoId)).toEqual(set);
    expect(await exists(t, p.groot!), "wees: groot van de oude set").toBe(false);
    const photo = await t.run((ctx) => ctx.db.get(p.photoId));
    expect(photo?.exifOrientation, "de stand die er al stond, blijft (invariant 12)").toBe(6);
  });

  it("een set waarvan 'groot' weg is: ook vervangen", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await setup(t);
    const p = await seedPhoto(t, owner, { withFormats: true });
    await t.run((ctx) => ctx.storage.delete(p.groot!));
    const set = await newObjects(t, "herstel");

    expect(await t.mutation(I.photos.attachFormats, { photoId: p.photoId, ...set })).toBe("attached");
    expect(await formatsOf(t, p.photoId)).toEqual(set);
    expect(await exists(t, p.klein!), "wees: klein van de oude set").toBe(false);
  });

  it("een nieuw object dat niet (meer) bestaat: gooit, en schrijft niets", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await setup(t);
    const p = await seedPhoto(t, owner);
    const set = await newObjects(t, "al gewist");
    await t.run((ctx) => ctx.storage.delete(set.klein));

    await expect(
      t.mutation(I.photos.attachFormats, { photoId: p.photoId, ...set, exifOrientation: 6, width: 10, height: 10 }),
    ).rejects.toThrow();

    const photo = await t.run((ctx) => ctx.db.get(p.photoId));
    expect(photo?.formats).toBeUndefined();
    expect(photo?.exifOrientation).toBeUndefined();
    expect(photo?.width).toBeUndefined();
  });
});
