import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { exists, formatsOf, seedPhoto, storageCount } from "./_helpers";

// WP25 — wissen neemt de formaten mee, draaien raakt ze niet
// (invariant 7 en 8; cascade-matrix P3, U7, FL1; A-kernvondst 5).
//
// Alle routes naar het wissen van een foto lopen via `internalRemovePhoto`, dat
// de opruiming van storage inplant. Die opruiming neemt nu ook de twee
// formaat-objecten mee. Een profielfoto vervangen wist niets: het formaat van
// een profielfoto is dat van de foto met hetzelfde beeld, en die foto blijft.

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("wissen neemt de formaten mee (invariant 8)", () => {
  it("photos.remove (P3/U7): origineel, klein en groot zijn weg", async () => {
    const t = convexTest(schema, modules);
    const owen = await registerUser(t, "user_owen", "owen@x.com");
    const p = await seedPhoto(t, owen, { withFormats: true });

    await withUser(t, "user_owen").mutation(api.photos.remove, { photoId: p.photoId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await exists(t, p.storageId)).toBe(false);
    expect(await exists(t, p.klein!)).toBe(false);
    expect(await exists(t, p.groot!)).toBe(false);
  });

  it("users.deleteSelf (U7): de formaten van al zijn foto's zijn weg, die van een ander blijven", async () => {
    const t = convexTest(schema, modules);
    const owen = await registerUser(t, "user_owen", "owen@x.com");
    const bob = await registerUser(t, "user_bob", "bob@x.com");
    const mine = [await seedPhoto(t, owen, { withFormats: true }), await seedPhoto(t, owen, { withFormats: true })];
    const other = await seedPhoto(t, bob, { withFormats: true });
    await t.run((ctx) => ctx.db.patch(owen, { photoCount: 2 }));
    await t.run((ctx) => ctx.db.patch(bob, { photoCount: 1 }));

    await withUser(t, "user_owen").mutation(api.users.deleteSelf, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    for (const p of mine) {
      expect(await exists(t, p.klein!)).toBe(false);
      expect(await exists(t, p.groot!)).toBe(false);
    }
    expect(await exists(t, other.klein!)).toBe(true);
    expect(await exists(t, other.groot!)).toBe(true);
    expect(await storageCount(t), "alleen Bobs origineel en formaten blijven").toBe(3);
  });

  it("FL1: een gemelde foto die na 14 dagen weggaat, neemt zijn formaten mee", async () => {
    const t = convexTest(schema, modules);
    const owen = await registerUser(t, "user_owen", "owen@x.com");
    const p = await seedPhoto(t, owen, { withFormats: true });
    await t.run((ctx) => ctx.db.patch(owen, { photoCount: 1 }));
    await t.run((ctx) =>
      ctx.db.patch(p.photoId, { flaggedAt: Date.now() - 15 * DAY, flaggedDeleteDate: Date.now() - DAY }),
    );

    await t.mutation(internal.photos.cleanupFlaggedPhotos, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await exists(t, p.klein!)).toBe(false);
    expect(await exists(t, p.groot!)).toBe(false);
  });

  it("een profielfoto vervangen wist geen formaten: de foto erachter houdt ze", async () => {
    const t = convexTest(schema, modules);
    const owen = await registerUser(t, "user_owen", "owen@x.com");
    const first = await seedPhoto(t, owen, { withFormats: true });
    const second = await seedPhoto(t, owen, { withFormats: true });
    await t.run((ctx) => ctx.db.patch(owen, { profilePhotoStorageId: first.storageId }));

    await withUser(t, "user_owen").mutation(api.users.updateProfile, {
      profilePhotoStorageId: second.storageId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await formatsOf(t, first.photoId)).toEqual({ klein: first.klein, groot: first.groot });
    expect(await exists(t, first.klein!)).toBe(true);
    expect(await exists(t, first.groot!)).toBe(true);
  });
});

describe("draaien maakt geen nieuwe formaten (invariant 7)", () => {
  it("photos.rotate: formaten gelijk, storage gelijk, niets ingepland", async () => {
    const t = convexTest(schema, modules);
    const owen = await registerUser(t, "user_owen", "owen@x.com");
    const p = await seedPhoto(t, owen, { withFormats: true, exifOrientation: 6, width: 4032, height: 3024 });
    const before = await storageCount(t);

    await withUser(t, "user_owen").mutation(api.photos.rotate, { photoId: p.photoId, rotation: 90, flipY: false });

    expect(await formatsOf(t, p.photoId)).toEqual({ klein: p.klein, groot: p.groot });
    expect(await storageCount(t)).toBe(before);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(0);
    const photo = await t.run((ctx) => ctx.db.get(p.photoId));
    expect(photo?.exifOrientation, "draaien blijft een DB-waarde (WP8)").toBe(3);
  });
});
