import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { A, OWEN_SPOT, refusal, schema, world, type T } from "./_world";

// WP17d A-invariant 3 en 4: `photos.setLocation({ photoId, location })`.
// `location` is { latitude, longitude } of null (weghalen). De plaatsnaam
// maakt de backend met Photon, na de mutation (scheduler). Een late plaatsnaam
// die hoort bij een plek die niet meer geldt, wordt niet bewaard.
//
// Photon is nagebootst: het label noemt de breedte uit de URL, zodat te zien
// is bij welke plek een label hoort. Het verwachte label komt uit de bestaande
// `internal.photos.reverseGeocode` met dezelfde nabootsing.

const NEW_SPOT = { latitude: 48.858411, longitude: 2.294533 };
const OTHER_SPOT = { latitude: 45.437191, longitude: 12.334590 };

let failFor: Set<string>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  failFor = new Set();
  fetchSpy = vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    const lat = url.searchParams.get("lat") ?? "?";
    if (failFor.has(lat)) return new Response("kapot", { status: 500 });
    return new Response(
      JSON.stringify({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: { city: `Plaats ${lat}`, country: "Land" } }],
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const run = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const doc = (t: T, id: Id<"photos">) => t.run((ctx) => ctx.db.get(id));
const scheduled = (t: T) => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
const labelFor = (t: T, spot: { latitude: number; longitude: number }) =>
  t.action(internal.photos.reverseGeocode, spot);

describe("photos.setLocation — de eigenaar zet een plek (A-invariant 3)", () => {
  it("de exacte coördinaten staan erin; de oude plaatsnaam is meteen weg", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await withUser(t, "user_owen").mutation(A.photos.setLocation, { photoId: w.owenSpot, location: NEW_SPOT });
    const p = await doc(t, w.owenSpot);
    expect(p?.latitude).toBe(NEW_SPOT.latitude);
    expect(p?.longitude).toBe(NEW_SPOT.longitude);
    expect(p?.locationLabel).toBeUndefined();
  });

  it("daarna komt de plaatsnaam van Photon, voor de nieuwe plek", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await withUser(t, "user_owen").mutation(A.photos.setLocation, { photoId: w.owenSpot, location: NEW_SPOT });
    await run(t);
    const expected = await labelFor(t, NEW_SPOT);
    expect(expected).toBeTruthy();
    expect((await doc(t, w.owenSpot))?.locationLabel).toBe(expected);
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes(`lat=${NEW_SPOT.latitude}`) && u.includes(`lon=${NEW_SPOT.longitude}`))).toBe(
      true,
    );
  });

  it("een foto zonder plek krijgt er een, met plaatsnaam", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await withUser(t, "user_owen").mutation(A.photos.setLocation, { photoId: w.owenNoSpot, location: NEW_SPOT });
    await run(t);
    const p = await doc(t, w.owenNoSpot);
    expect([p?.latitude, p?.longitude]).toEqual([NEW_SPOT.latitude, NEW_SPOT.longitude]);
    expect(p?.locationLabel).toBe(await labelFor(t, NEW_SPOT));
  });

  it("Photon faalt: de plek blijft, zonder plaatsnaam, zonder fout", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    failFor.add(String(NEW_SPOT.latitude));
    await withUser(t, "user_owen").mutation(A.photos.setLocation, { photoId: w.owenSpot, location: NEW_SPOT });
    await expect(run(t)).resolves.not.toThrow();
    const p = await doc(t, w.owenSpot);
    expect([p?.latitude, p?.longitude]).toEqual([NEW_SPOT.latitude, NEW_SPOT.longitude]);
    expect(p?.locationLabel).toBeUndefined();
  });

  it("de grenzen zelf mogen: (90, 180) en (-90, -180)", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const owen = withUser(t, "user_owen");
    await owen.mutation(A.photos.setLocation, { photoId: w.owenSpot, location: { latitude: 90, longitude: 180 } });
    await owen.mutation(A.photos.setLocation, { photoId: w.owenNoSpot, location: { latitude: -90, longitude: -180 } });
    expect((await doc(t, w.owenSpot))?.latitude).toBe(90);
    expect((await doc(t, w.owenNoSpot))?.longitude).toBe(-180);
    await run(t);
  });
});

describe("photos.setLocation — weghalen (A-invariant 3)", () => {
  it("location: null wist breedte, lengte en plaatsnaam", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await withUser(t, "user_owen").mutation(A.photos.setLocation, { photoId: w.owenSpot, location: null });
    await run(t);
    const p = await doc(t, w.owenSpot);
    expect(p?.latitude).toBeUndefined();
    expect(p?.longitude).toBeUndefined();
    expect(p?.locationLabel).toBeUndefined();
  });

  it("weghalen bij een foto zonder plek: geen fout, niets erbij", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await withUser(t, "user_owen").mutation(A.photos.setLocation, { photoId: w.owenNoSpot, location: null });
    await run(t);
    const p = await doc(t, w.owenNoSpot);
    expect([p?.latitude, p?.longitude, p?.locationLabel]).toEqual([undefined, undefined, undefined]);
  });
});

describe("photos.setLocation — een late plaatsnaam voor een oude plek (A-invariant 3)", () => {
  it("wijzigen en dan weghalen vóór Photon antwoordt: geen plaatsnaam, geen plek", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const owen = withUser(t, "user_owen");
    await owen.mutation(A.photos.setLocation, { photoId: w.owenSpot, location: NEW_SPOT });
    await owen.mutation(A.photos.setLocation, { photoId: w.owenSpot, location: null });
    await run(t);
    const p = await doc(t, w.owenSpot);
    expect([p?.latitude, p?.longitude, p?.locationLabel]).toEqual([undefined, undefined, undefined]);
  });

  it("twee keer wijzigen, de tweede Photon-vraag faalt: geen plaatsnaam van de eerste plek", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const owen = withUser(t, "user_owen");
    failFor.add(String(OTHER_SPOT.latitude));
    await owen.mutation(A.photos.setLocation, { photoId: w.owenSpot, location: NEW_SPOT });
    await owen.mutation(A.photos.setLocation, { photoId: w.owenSpot, location: OTHER_SPOT });
    await run(t);
    const p = await doc(t, w.owenSpot);
    expect([p?.latitude, p?.longitude]).toEqual([OTHER_SPOT.latitude, OTHER_SPOT.longitude]);
    expect(p?.locationLabel).toBeUndefined();
  });

  it("twee keer wijzigen: de plaatsnaam hoort bij de laatste plek", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const owen = withUser(t, "user_owen");
    await owen.mutation(A.photos.setLocation, { photoId: w.owenSpot, location: NEW_SPOT });
    await owen.mutation(A.photos.setLocation, { photoId: w.owenSpot, location: OTHER_SPOT });
    await run(t);
    expect((await doc(t, w.owenSpot))?.locationLabel).toBe(await labelFor(t, OTHER_SPOT));
  });

  it("de foto is gewist voordat Photon antwoordt: geen fout, geen rij terug", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const owen = withUser(t, "user_owen");
    await owen.mutation(A.photos.setLocation, { photoId: w.owenNoSpot, location: NEW_SPOT });
    await owen.mutation(A.photos.remove, { photoId: w.owenNoSpot });
    await expect(run(t)).resolves.not.toThrow();
    expect(await doc(t, w.owenNoSpot)).toBeNull();
  });
});

describe("photos.setLocation — alleen de eigenaar, geen orakel (A-invariant 3)", () => {
  it("een lid met toegang, een buitenstaander en een gewiste foto: dezelfde NOT_PHOTO_OWNER, niets veranderd, niets ingepland", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const before = await doc(t, w.owenSpot);
    const queued = (await scheduled(t)).length;
    const member = await refusal(
      withUser(t, "user_mia").mutation(A.photos.setLocation, { photoId: w.owenSpot, location: NEW_SPOT }),
    );
    const memberClear = await refusal(
      withUser(t, "user_mia").mutation(A.photos.setLocation, { photoId: w.owenSpot, location: null }),
    );
    const outsider = await refusal(
      withUser(t, "user_xena").mutation(A.photos.setLocation, { photoId: w.owenSpot, location: NEW_SPOT }),
    );
    const gone = await refusal(
      withUser(t, "user_owen").mutation(A.photos.setLocation, { photoId: w.gone, location: NEW_SPOT }),
    );
    expect(member).toEqual({ code: "NOT_PHOTO_OWNER" });
    for (const r of [memberClear, outsider, gone]) expect(r).toEqual(member);
    expect(await doc(t, w.owenSpot)).toEqual(before);
    expect((await scheduled(t)).length).toBe(queued);
  });

  it("de eigenaar-check komt vóór de waarden: een ander met een ongeldige plek krijgt ook NOT_PHOTO_OWNER", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    expect(
      await refusal(
        withUser(t, "user_mia").mutation(A.photos.setLocation, {
          photoId: w.owenSpot,
          location: { latitude: 999, longitude: 0 },
        }),
      ),
    ).toEqual({ code: "NOT_PHOTO_OWNER" });
  });

  it("de eigen foto van Mia mag zij wel wijzigen", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await withUser(t, "user_mia").mutation(A.photos.setLocation, { photoId: w.miaSpot, location: null });
    expect((await doc(t, w.miaSpot))?.latitude).toBeUndefined();
  });

  it("uitgelogd: weigering, niets veranderd", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await expect(t.mutation(A.photos.setLocation, { photoId: w.owenSpot, location: null })).rejects.toThrow();
    expect((await doc(t, w.owenSpot))?.latitude).toBe(OWEN_SPOT.latitude);
  });
});

describe("photos.setLocation — ongeldige waarden (A-invariant 3)", () => {
  it.each([
    ["breedte boven 90", { latitude: 90.0001, longitude: 0 }],
    ["breedte onder -90", { latitude: -91, longitude: 0 }],
    ["lengte boven 180", { latitude: 0, longitude: 180.5 }],
    ["lengte onder -180", { latitude: 0, longitude: -181 }],
    ["NaN", { latitude: Number.NaN, longitude: 5 }],
    ["oneindig", { latitude: 52, longitude: Number.POSITIVE_INFINITY }],
  ])("%s: LOCATION_INVALID en er verandert niets", async (_label, location) => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const before = await doc(t, w.owenSpot);
    expect(
      await refusal(withUser(t, "user_owen").mutation(A.photos.setLocation, { photoId: w.owenSpot, location })),
    ).toEqual({ code: "LOCATION_INVALID" });
    expect(await doc(t, w.owenSpot)).toEqual(before);
  });
});

describe("photos.update zet geen plek en geen plaatsnaam meer (A-invariant 4)", () => {
  it.each([
    ["latitude", { latitude: 1 }],
    ["longitude", { longitude: 1 }],
    ["locationLabel", { locationLabel: "Waar ik wil" }],
  ])("%s: geweigerd, er verandert niets", async (_label, extra) => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const before = await doc(t, w.owenSpot);
    await expect(
      withUser(t, "user_owen").mutation(A.photos.update, { photoId: w.owenSpot, ...extra }),
    ).rejects.toThrow();
    expect(await doc(t, w.owenSpot)).toEqual(before);
  });
});
