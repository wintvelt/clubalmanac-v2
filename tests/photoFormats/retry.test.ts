import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { FORMATS_RETRY_DELAY_MS } from "../../convex/photos";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { JPEG } from "../http/_upload";
import { formatsOf, seedPhoto } from "./_helpers";

// Herkansing van de formaat-stap. Na elke upload plant `createFromUploadInternal`
// naast de directe poging een controle (`retryFormatsIfMissing`) op
// FORMATS_RETRY_DELAY_MS. Heeft de foto dan geen volledige set (A-invariant 22)
// en is hij niet afgetekend (A-invariant 25), dan start de stap één keer
// opnieuw. De controle hangt niet af van de eerste action: ook als die crashte
// en niets teruggaf, loopt hij. Hooguit één herkansing per upload.
//
// De beeldbibliotheek is gemockt (zoals in backfill.test.ts): `mode` bepaalt of
// een poging slaagt, en `calls` telt de pogingen.

const lib = vi.hoisted(() => ({ calls: 0, mode: "ok" as "ok" | "failFirst" | "failAlways" }));

vi.mock("../../convex/lib/photoFormats", () => ({
  makeFormatImages: async (bytes: Uint8Array) => {
    lib.calls += 1;
    if (lib.mode === "failAlways" || (lib.mode === "failFirst" && lib.calls === 1)) {
      throw new Error("geen beeld");
    }
    return {
      klein: new Uint8Array([1, ...bytes.slice(0, 4)]),
      groot: new Uint8Array([2, ...bytes.slice(0, 4)]),
      width: 4000,
      height: 3000,
    };
  },
}));

type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.useFakeTimers();
  lib.calls = 0;
  lib.mode = "ok";
});
afterEach(() => {
  vi.useRealTimers();
});

async function owner(t: T) {
  return await registerUser(t, "user_owen", "owen@x.com", "Owen");
}

async function uploadOne(t: T, uploadId = "u-1"): Promise<Id<"photos">> {
  const res = await withUser(t, "user_owen").fetch("/upload", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg", "X-Upload-Id": uploadId },
    body: JPEG,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { photoId: Id<"photos"> }).photoId;
}

async function scheduled(t: T) {
  return await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
}

/**
 * Eerst de directe stappen (vertraging 0) tot ze klaar zijn, dan de rest. Met
 * alleen `vi.runAllTimers` start de controle al terwijl de eerste poging nog
 * loopt; in productie ligt er een kwartier tussen.
 */
async function runInOrder(t: T) {
  vi.advanceTimersByTime(1);
  await t.finishInProgressScheduledFunctions();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

const isRetry = (name: string) => name.includes("retryFormatsIfMissing");
const isMake = (name: string) => /photoFormats.*makeFormats/.test(name);

describe("upload plant de controle", () => {
  it("één controle per upload, FORMATS_RETRY_DELAY_MS later, ruim binnen het uur van de integriteits-check", async () => {
    const t = convexTest(schema, modules);
    await owner(t);
    const before = Date.now();
    const photoId = await uploadOne(t);
    // Een herhaalde upload (zelfde X-Upload-Id) plant niets nieuws.
    await uploadOne(t);

    const retries = (await scheduled(t)).filter((s) => isRetry(String(s.name)));
    expect(retries).toHaveLength(1);
    expect((retries[0]!.args as Array<{ photoId: string }>)[0]?.photoId).toBe(photoId);
    expect(retries[0]!.scheduledTime).toBeGreaterThanOrEqual(before + FORMATS_RETRY_DELAY_MS);
    expect(FORMATS_RETRY_DELAY_MS).toBeLessThanOrEqual(30 * 60 * 1000);
  });
});

describe("retryFormatsIfMissing", () => {
  it("foto zonder formaten: plant makeFormats één keer, en de foto krijgt formaten", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t));

    expect(await t.mutation(internal.photos.retryFormatsIfMissing, { photoId: p.photoId })).toBe("retried");
    const s = await scheduled(t);
    expect(s.filter((x) => isMake(String(x.name)))).toHaveLength(1);
    expect(s.filter((x) => isRetry(String(x.name))), "de controle plant zichzelf niet opnieuw").toHaveLength(0);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await formatsOf(t, p.photoId)).toBeDefined();
  });

  it("foto met formaten: niets ingepland", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t), { withFormats: true });

    expect(await t.mutation(internal.photos.retryFormatsIfMissing, { photoId: p.photoId })).toBe("hasFormats");
    expect(await scheduled(t)).toHaveLength(0);
  });

  it("A-invariant 22: een set met een ontbrekend object telt als geen set, dus wel een herkansing", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t), { withFormats: true });
    await t.run((ctx) => ctx.storage.delete(p.klein!));

    expect(await t.mutation(internal.photos.retryFormatsIfMissing, { photoId: p.photoId })).toBe("retried");
    expect((await scheduled(t)).filter((x) => isMake(String(x.name)))).toHaveLength(1);
  });

  it("afgetekende foto: niets ingepland", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t));
    await t.mutation(internal.photos.acceptNoFormats, { photoIds: [p.photoId] });

    expect(await t.mutation(internal.photos.retryFormatsIfMissing, { photoId: p.photoId })).toBe("accepted");
    expect(await scheduled(t)).toHaveLength(0);
  });

  it("verwijderde foto: niets ingepland", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPhoto(t, await owner(t));
    await t.run((ctx) => ctx.db.delete(p.photoId));

    expect(await t.mutation(internal.photos.retryFormatsIfMissing, { photoId: p.photoId })).toBe("gone");
    expect(await scheduled(t)).toHaveLength(0);
  });
});

describe("na de upload, met de klok", () => {
  it("eerste poging slaagt: de controle plant niets, één poging in totaal", async () => {
    const t = convexTest(schema, modules);
    await owner(t);
    const photoId = await uploadOne(t);

    await runInOrder(t);

    expect(await formatsOf(t, photoId)).toBeDefined();
    expect(lib.calls).toBe(1);
    expect((await scheduled(t)).filter((s) => isMake(String(s.name)))).toHaveLength(1);
  });

  it("eerste poging geeft 'failed': de herkansing maakt de formaten", async () => {
    const t = convexTest(schema, modules);
    await owner(t);
    lib.mode = "failFirst";
    const photoId = await uploadOne(t);

    await runInOrder(t);

    expect(lib.calls).toBe(2);
    expect(await formatsOf(t, photoId)).toBeDefined();
  });

  it("eerste poging crasht (de action geeft niets terug): de controle loopt toch en maakt de formaten", async () => {
    const t = convexTest(schema, modules);
    await owner(t);
    const photoId = await uploadOne(t);
    // Simuleer een action die afbrak vóór hij iets deed: de eerste poging
    // loopt nooit. De controle staat er los van.
    const first = (await scheduled(t)).find((s) => isMake(String(s.name)))!;
    await t.run((ctx) => ctx.scheduler.cancel(first._id));

    vi.advanceTimersByTime(FORMATS_RETRY_DELAY_MS - 1000);
    await t.finishInProgressScheduledFunctions();
    expect(await formatsOf(t, photoId), "nog niet: de controle wacht").toBeUndefined();

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(lib.calls).toBe(1);
    expect(await formatsOf(t, photoId)).toBeDefined();
  });

  it("hooguit één herkansing: mislukt ook de tweede poging, dan blijft de foto zonder formaten", async () => {
    const t = convexTest(schema, modules);
    await owner(t);
    lib.mode = "failAlways";
    const photoId = await uploadOne(t);

    await runInOrder(t);

    expect(lib.calls).toBe(2);
    expect(await formatsOf(t, photoId)).toBeUndefined();
    const s = await scheduled(t);
    expect(s.filter((x) => isMake(String(x.name)))).toHaveLength(2);
    expect(s.filter((x) => isRetry(String(x.name)))).toHaveLength(1);
    expect(s.every((x) => x.state.kind !== "pending"), "niets meer ingepland").toBe(true);
  });
});
