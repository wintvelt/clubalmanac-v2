import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";

// WP17d besluit 4, A-invariant 3 (aangescherpt in fix-cyclus 1): een late
// plaatsnaam van de upload (`extractMetadata`) wordt alleen bewaard als de
// foto die plek nog heeft. Audit S1, red-team L1 (RT4, RT4b).
//
// Het venster: `extractMetadata` leest de rij, vraagt Photon (tot 2 s) en
// schrijft daarna. Haalt de eigenaar in dat venster de plek weg, of verplaatst
// hij hem, dan mag het adres van de oude plek niet terugkomen of de nieuwe
// plaatsnaam overschrijven. Ook de plek zelf komt niet terug.
//
// De tests doen de wijziging ín de Photon-vraag van `extractMetadata` (de
// fetch-stub), zoals de red-team. De EXIF-lezer is nep: het bestand heeft
// geen EXIF, de plek staat al op de rij (zoals bij een upload uit de app).

vi.mock("exif-parser", () => ({
  default: { create: () => ({ parse: () => ({ tags: {}, imageSize: {} }) }) },
}));

type T = ReturnType<typeof convexTest>;

const HOME = { latitude: 52.1234, longitude: 5.9876 };
const PARIS = { latitude: 48.8566, longitude: 2.3522 };
const HOME_LABEL = "8 Dorpsstraat, Thuis, Nederland";
const PARIS_LABEL = "Rue de Rivoli, Paris, France";

function photon(props: { street: string; city: string; country: string }) {
  return new Response(JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: props }] }), {
    status: 200,
  });
}

/** Photon-antwoord per plek: dicht bij HOME het huisadres, dicht bij PARIS Parijs. */
function answerFor(url: string, parisFails = false): Response {
  const lat = Number(new URL(url).searchParams.get("lat"));
  if (Math.abs(lat - PARIS.latitude) < 0.01) {
    return parisFails ? new Response("nee", { status: 503 }) : photon({ street: "Rue de Rivoli", city: "Paris", country: "France" });
  }
  return photon({ street: "8 Dorpsstraat", city: "Thuis", country: "Nederland" });
}

async function setup(t: T) {
  const owen = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  const photoId = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }));
    return await ctx.db.insert("photos", { ownerId: owen, storageId, ...HOME, createdAt: Date.now() });
  });
  return { owen, photoId };
}

const row = (t: T, photoId: Id<"photos">) => t.run((ctx) => ctx.db.get(photoId));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("A-invariant 3: zonder ingreep bewaart de upload de plaatsnaam (controle)", () => {
  it("geen wijziging tijdens de Photon-vraag: plek en huisadres blijven", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await setup(t);
    vi.stubGlobal("fetch", async (url: string) => answerFor(String(url)));
    await t.action(internal.photoMetadata.extractMetadata, { photoId });
    const r = await row(t, photoId);
    expect({ lat: r?.latitude, lon: r?.longitude, label: r?.locationLabel }).toEqual({
      lat: HOME.latitude,
      lon: HOME.longitude,
      label: HOME_LABEL,
    });
  });
});

describe("A-invariant 3: een late plaatsnaam alleen als de foto die plek nog heeft (audit S1, RT4)", () => {
  it("weghalen tijdens de Photon-vraag: geen plek en geen plaatsnaam", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await setup(t);
    vi.stubGlobal("fetch", async (url: string) => {
      await withUser(t, "user_owen").mutation(api.photos.setLocation, { photoId, location: null });
      return answerFor(String(url));
    });
    await t.action(internal.photoMetadata.extractMetadata, { photoId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const r = await row(t, photoId);
    expect(r?.latitude).toBeUndefined();
    expect(r?.longitude).toBeUndefined();
    expect(r?.locationLabel).toBeUndefined();
  });

  it("verplaatsen tijdens de Photon-vraag, Photon voor de nieuwe plek faalt: de nieuwe plek, niet het oude adres (RT4b)", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await setup(t);
    let moved = false;
    vi.stubGlobal("fetch", async (url: string) => {
      if (!moved) {
        moved = true;
        await withUser(t, "user_owen").mutation(api.photos.setLocation, { photoId, location: PARIS });
      }
      return answerFor(String(url), true);
    });
    await t.action(internal.photoMetadata.extractMetadata, { photoId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const r = await row(t, photoId);
    expect({ lat: r?.latitude, lon: r?.longitude }).toEqual({ lat: PARIS.latitude, lon: PARIS.longitude });
    expect(r?.locationLabel).not.toBe(HOME_LABEL);
    expect(r?.locationLabel ?? "").not.toMatch(/Dorpsstraat|Thuis/);
  });

  it("verplaatsen tijdens de Photon-vraag, de nieuwe plaatsnaam is er al: die blijft", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await setup(t);
    let moved = false;
    vi.stubGlobal("fetch", async (url: string) => {
      if (!moved) {
        moved = true;
        await withUser(t, "user_owen").mutation(api.photos.setLocation, { photoId, location: PARIS });
        // De Photon-vraag van "Locatie wijzigen" is klaar vóór die van de upload.
        await t.finishAllScheduledFunctions(vi.runAllTimers);
        expect((await row(t, photoId))?.locationLabel, "de nieuwe plaatsnaam is er").toBe(PARIS_LABEL);
      }
      return answerFor(String(url));
    });
    await t.action(internal.photoMetadata.extractMetadata, { photoId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const r = await row(t, photoId);
    expect({ lat: r?.latitude, lon: r?.longitude, label: r?.locationLabel }).toEqual({
      lat: PARIS.latitude,
      lon: PARIS.longitude,
      label: PARIS_LABEL,
    });
  });

  it("weghalen en terugzetten op dezelfde plek tijdens de Photon-vraag: de plaatsnaam mag dan (dezelfde plek)", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await setup(t);
    let once = false;
    vi.stubGlobal("fetch", async (url: string) => {
      if (!once) {
        once = true;
        await withUser(t, "user_owen").mutation(api.photos.setLocation, { photoId, location: null });
        await withUser(t, "user_owen").mutation(api.photos.setLocation, { photoId, location: HOME });
      }
      return answerFor(String(url));
    });
    await t.action(internal.photoMetadata.extractMetadata, { photoId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const r = await row(t, photoId);
    expect({ lat: r?.latitude, lon: r?.longitude, label: r?.locationLabel }).toEqual({
      lat: HOME.latitude,
      lon: HOME.longitude,
      label: HOME_LABEL,
    });
  });
});
