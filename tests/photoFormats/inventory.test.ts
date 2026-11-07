import { convexTest } from "convex-test";
import type { FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { exists, seedPhoto } from "./_helpers";

// WP25 — de bewaking en de migratie kennen de formaten
// (invariant 9 en 10; A-invariant 14, 15, 16; A-kernvondst 3 en 4).
//
// Het gevaar zit in de wees-definitie. `prune-storage` wist elk object dat aan
// geen record hangt en niet in `convex-records.json` staat, en daar staat een
// formaat nooit in. Kent `storageInventory` de formaten niet, dan wist een
// prune na de backfill ze allemaal. WP10 zou ze elke ochtend mailen.
//
// A-invariant 14: een foto die ouder is dan een uur en geen formaten heeft, is
// een melding in de integriteitsscan (en dus in `verify`, via integrityReport).

const NOW = new Date("2026-11-20T04:30:00.000Z").getTime();
const HOUR = 60 * 60 * 1000;

const integrityCheck = (
  internal as unknown as {
    monitoring: { integrityCheck: FunctionReference<"mutation", "internal", Record<string, never>> };
  }
).monitoring.integrityCheck;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.MAILJET_VERIFIED_SENDERS = "info@clubalmanac.com";
  process.env.MAILJET_API_KEY = "k";
  process.env.MAILJET_API_SECRET = "s";
  process.env.WEBMASTER_EMAILS = "webmaster@x.com";
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.MAILJET_VERIFIED_SENDERS;
  delete process.env.MAILJET_API_KEY;
  delete process.env.MAILJET_API_SECRET;
  delete process.env.WEBMASTER_EMAILS;
});

type T = ReturnType<typeof convexTest>;

async function owner(t: T, photoCount: number) {
  const id = await registerUser(t, "user_owen", "owen@x.com");
  await t.run((ctx) => ctx.db.patch(id, { photoCount }));
  return id;
}

/** Hoeveel functies de integriteitscheck inplant: 1 = drift-mail, 0 = schoon. */
async function monitorDelta(t: T): Promise<number> {
  const count = async () =>
    (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).length;
  const before = await count();
  await t.mutation(integrityCheck, {});
  return (await count()) - before;
}

describe("WP10: de formaten zijn verwezen storage (invariant 9, A-invariant 15)", () => {
  it("een foto met formaten: geen wees, geen drift", async () => {
    const t = convexTest(schema, modules);
    await seedPhoto(t, await owner(t, 1), { withFormats: true, createdAt: NOW - 30 * 24 * HOUR });
    expect(await monitorDelta(t)).toBe(0);
    expect(await t.query(internal.migration.integrityReport, {})).toEqual([]);
  });

  it("formaten waar geen foto meer naar wijst: wezen, wel drift", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t, 0), { withFormats: true });
    await t.run(async (ctx) => {
      await ctx.db.delete(p.photoId);
      await ctx.storage.delete(p.storageId);
    });
    const lines = await t.query(internal.migration.integrityReport, {});
    expect(lines.some((l) => l.includes(p.klein!))).toBe(true);
    expect(lines.some((l) => l.includes(p.groot!))).toBe(true);
    expect(await monitorDelta(t)).toBe(1);
  });
});

describe("WP10: ontbrekende formaten zijn zichtbaar (A-invariant 14)", () => {
  it("een foto van meer dan een uur oud zonder formaten: drift, met het foto-id", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t, 1), { createdAt: NOW - 2 * HOUR });
    const lines = await t.query(internal.migration.integrityReport, {});
    expect(lines.some((l) => l.includes(p.photoId))).toBe(true);
    expect(await monitorDelta(t)).toBe(1);
  });

  it("S2-M14: een formaat-veld dat naar een gewist object wijst: drift 'formaten dangling', met het foto-id", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t, 1), { withFormats: true, createdAt: NOW - 2 * HOUR });
    await t.run((ctx) => ctx.storage.delete(p.klein!));
    const lines = await t.query(internal.migration.integrityReport, {});
    expect(lines.some((l) => l.includes(p.photoId) && l.includes("formaten dangling"))).toBe(true);
    expect(await monitorDelta(t)).toBe(1);
  });

  it("een verse upload (minder dan een uur) zonder formaten: nog geen drift", async () => {
    const t = convexTest(schema, modules);
    await seedPhoto(t, await owner(t, 1), { createdAt: NOW - 10 * 60 * 1000 });
    expect(await t.query(internal.migration.integrityReport, {})).toEqual([]);
    expect(await monitorDelta(t)).toBe(0);
  });
});

describe("storageInventory (WP12, A-invariant 15)", () => {
  it("formaten tellen als verwezen: geen wees, dus prune-storage wist ze niet", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t, 2);
    await seedPhoto(t, o, { withFormats: true });
    await seedPhoto(t, o, { withFormats: true });

    const inventory = await t.query(internal.migration.storageInventory, { sampleSize: 1000 });

    expect(inventory.storageObjects).toBe(6);
    expect(inventory.referencedByRecords).toBe(6);
    expect(inventory.orphanCount).toBe(0);
    expect(inventory.orphanSample).toEqual([]);
    expect(inventory.danglingCount).toBe(0);
  });

  it("een formaat-veld dat naar een gewist object wijst: dangling", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t, 1), { withFormats: true });
    await t.run((ctx) => ctx.storage.delete(p.klein!));

    const inventory = await t.query(internal.migration.storageInventory, { sampleSize: 1000 });

    expect(inventory.danglingCount).toBe(1);
    expect(inventory.danglingSample).toEqual([p.klein]);
  });

  it("een formaat-object zonder foto: wees, en de enige op de lijst", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t, 1);
    const kept = await seedPhoto(t, o, { withFormats: true });
    const gone = await seedPhoto(t, o, { withFormats: true });
    await t.run(async (ctx) => {
      await ctx.db.delete(gone.photoId);
      await ctx.storage.delete(gone.storageId);
    });

    const inventory = await t.query(internal.migration.storageInventory, { sampleSize: 1000 });

    expect(new Set(inventory.orphanSample)).toEqual(new Set([gone.klein, gone.groot]));
    expect(inventory.orphanSample).not.toContain(kept.klein);
    expect(inventory.orphanSample).not.toContain(kept.groot);
  });
});

describe("reset neemt de formaten mee (A-invariant 16)", () => {
  it("clearTable('photos'): de formaten van de gewiste foto's zijn weg, de originelen blijven", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t, 2);
    const a = await seedPhoto(t, o, { withFormats: true });
    const b = await seedPhoto(t, o, { withFormats: true });

    let remaining = true;
    while (remaining) {
      const r = await t.mutation(internal.migration.clearTable, { table: "photos", limit: 1 });
      remaining = r.remaining;
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    for (const p of [a, b]) {
      expect(await exists(t, p.klein!)).toBe(false);
      expect(await exists(t, p.groot!)).toBe(false);
      expect(await exists(t, p.storageId), "het origineel blijft voor load-records").toBe(true);
    }
  });
});
