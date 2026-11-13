import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import {
  afterFirstImage,
  bytesOf,
  containsBytes,
  GPS_JPEG,
  GPS_PROGRESSIEF,
  gpsAnywhere,
  HEIC_GPS,
  imageData,
  isJpeg,
  MPF,
  ODD_FILL,
  ODD_GAP,
  ODD_LENGTH,
  PNG_GPS,
  sameBytes,
  SCHOON,
  TRAILER,
  TRUNCATED,
  TWIN,
} from "../_helpers/jpeg";
import { seedMember } from "../_helpers/membership";
import { modules } from "../_helpers/modules";

// WP17d besluit 4 (fix-cyclus 1). Spec: §Spec-criticus aanvullingen, A-invariant
// 9 en 10.
//
// A-invariant 9: het origineel gaat altijd zonder GPS naar buiten, voor elk
// lid en ook voor de eigenaar, met en zonder formaat; ook na "Locatie
// weghalen" en na wijzigen (red-team H1, RT1). Het foto-pad zonder formaat
// mag *groot* geven of het origineel zonder metadata; dat kiest B.
//
// A-invariant 10: de schoonmaker is fail-closed.
//   - Na het eerste beeld gaat niets mee: geen tweede beeld, geen MPF-beeld,
//     geen trailer (audit S2, RT2). Het eerste beeld blijft zichtbaar (200).
//   - Een JPEG met een afwijkende structuur, en een niet-JPEG zonder
//     formaten, gaan niet ongewijzigd mee (RT3, audit N4). Een 404 mag; het
//     ongewijzigde bestand niet.
//   - Een gewone JPEG blijft zichtbaar: 200, nog steeds een JPEG, de
//     beelddata ongewijzigd. Een JPEG zonder metadata gaat ongewijzigd mee.
//
// De GPS-controle (tests/_helpers/jpeg.ts) zoekt in het hele bestand, niet
// alleen tot de beelddata.

type T = ReturnType<typeof convexTest>;

async function base(t: T) {
  const owen = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  const mia = await registerUser(t, "user_mia", "mia@x.com", "Mia");
  const G = await withUser(t, "user_owen").mutation(api.groups.create, { name: "G" });
  await seedMember(t, { groupId: G, userId: mia });
  const A = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: G, name: "A" });
  return { owen, mia, A };
}

/** Een foto van Owen in album A met dit origineel, met of zonder (tekst-)formaten, en met een plek. */
async function photoWith(
  t: T,
  s: { owen: Id<"users">; A: Id<"albums"> },
  original: Uint8Array<ArrayBuffer>,
  withFormats: boolean,
  type = "image/jpeg",
) {
  const ids = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([original], { type }));
    const formats = withFormats
      ? {
          klein: await ctx.storage.store(new Blob(["klein"], { type: "image/jpeg" })),
          groot: await ctx.storage.store(new Blob(["groot"], { type: "image/jpeg" })),
        }
      : undefined;
    const photoId = await ctx.db.insert("photos", {
      ownerId: s.owen,
      storageId,
      ...(formats ? { formats } : {}),
      latitude: 52.1234,
      longitude: 5.9876,
      locationLabel: "8 Dorpsstraat, Ergens, Nederland",
      createdAt: Date.now(),
    });
    return { photoId, storageId };
  });
  await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: s.A, photoId: ids.photoId });
  return ids;
}

const photoUrl = (id: string, formaat?: string) => `/beeld/foto/${id}${formaat ? `?formaat=${formaat}` : ""}`;
const profileUrl = (id: string, formaat?: string) => `/beeld/profiel/${id}${formaat ? `?formaat=${formaat}` : ""}`;

const FORMATS = [undefined, "klein", "groot"] as const;
const label = (f: string | undefined) => (f ? `?formaat=${f}` : "zonder formaat");

// setLocation plant een Photon-vraag in; die mag niet naar het netwerk.
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", async () => new Response("nee", { status: 503 }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// --- A-invariant 9: het foto-pad ----------------------------------------------------------

const STATES = ["zoals geüpload", "na Locatie weghalen", "na Locatie wijzigen"] as const;
const CLIENTS = [
  ["de eigenaar", "user_owen"],
  ["een lid", "user_mia"],
] as const;

describe("A-invariant 9: het foto-pad geeft nooit een bestand met GPS", () => {
  for (const withFormats of [true, false]) {
    for (const formaat of FORMATS) {
      for (const [who, subject] of CLIENTS) {
        it(`${withFormats ? "met" : "zonder"} formaten, ${label(formaat)}, ${who}: 200, geen GPS, ook na weghalen en wijzigen`, async () => {
          const t = convexTest(schema, modules);
          const s = await base(t);
          const { photoId } = await photoWith(t, s, GPS_JPEG, withFormats);
          for (const state of STATES) {
            if (state === "na Locatie weghalen") {
              await withUser(t, "user_owen").mutation(api.photos.setLocation, { photoId, location: null });
            }
            if (state === "na Locatie wijzigen") {
              await withUser(t, "user_owen").mutation(api.photos.setLocation, {
                photoId,
                location: { latitude: 48.8566, longitude: 2.3522 },
              });
            }
            await t.finishAllScheduledFunctions(vi.runAllTimers);
            const res = await withUser(t, subject).fetch(photoUrl(photoId, formaat), { method: "GET" });
            expect(res.status, state).toBe(200);
            const bytes = await bytesOf(res);
            expect(bytes.length, state).toBeGreaterThan(0);
            expect(gpsAnywhere(bytes), state).toBe(0);
          }
        });
      }
    }
  }

  it("het origineel zonder formaten blijft een JPEG met dezelfde beelddata (het beeld blijft heel)", async () => {
    const t = convexTest(schema, modules);
    const s = await base(t);
    const { photoId } = await photoWith(t, s, GPS_JPEG, false);
    const scan = imageData(GPS_JPEG);
    for (const formaat of FORMATS) {
      const bytes = await bytesOf(await withUser(t, "user_mia").fetch(photoUrl(photoId, formaat), { method: "GET" }));
      expect(isJpeg(bytes), label(formaat)).toBe(true);
      expect(containsBytes(bytes, scan), label(formaat)).toBe(true);
    }
  });
});

// --- A-invariant 10: fail-closed ------------------------------------------------------------
//
// Elk bestand staat zowel als origineel van een foto zonder formaten (foto-pad,
// lid) als als los profielbeeld (openbaar profielpad, uitgelogd). Beide paden,
// met en zonder formaat.

async function servedEverywhere(t: T, file: Uint8Array<ArrayBuffer>, type = "image/jpeg") {
  const s = await base(t);
  const { photoId } = await photoWith(t, s, file, false, type);
  const loose = await t.run((ctx) => ctx.storage.store(new Blob([file], { type })));
  await t.run((ctx) => ctx.db.patch(s.mia, { profilePhotoStorageId: loose }));
  const out: { where: string; res: Response }[] = [];
  for (const formaat of FORMATS) {
    out.push({
      where: `foto-pad, ${label(formaat)}`,
      res: await withUser(t, "user_mia").fetch(photoUrl(photoId, formaat), { method: "GET" }),
    });
    out.push({ where: `profielpad, ${label(formaat)}`, res: await t.fetch(profileUrl(s.mia, formaat), { method: "GET" }) });
  }
  return out;
}

describe("A-invariant 10: na het eerste beeld gaat niets mee (audit S2, RT2)", () => {
  it.each([
    ["een tweede beeld met eigen EXIF en GPS", TWIN],
    ["een MPF-blok met het tweede beeld erachter", MPF],
    ["een trailer met een EXIF-blok (motion photo)", TRAILER],
  ] as const)("%s: 200, het eerste beeld, zonder GPS en zonder iets erna", async (_name, file) => {
    const t = convexTest(schema, modules);
    for (const { where, res } of await servedEverywhere(t, file)) {
      expect(res.status, where).toBe(200);
      const bytes = await bytesOf(res);
      expect(isJpeg(bytes), where).toBe(true);
      expect(gpsAnywhere(bytes), where).toBe(0);
      expect(afterFirstImage(bytes), `${where}: bytes na het eerste beeld`).toBe(0);
    }
  });
});

describe("A-invariant 10: een bestand dat de schoonmaker niet begrijpt, gaat niet ongewijzigd mee", () => {
  it.each([
    ["JPEG met een opvulbyte na SOI (RT3)", ODD_FILL, "image/jpeg"],
    ["JPEG met rommel tussen twee segmenten", ODD_GAP, "image/jpeg"],
    ["JPEG met een segment-lengte buiten het bestand", ODD_LENGTH, "image/jpeg"],
    ["JPEG zonder einde (afgebroken)", TRUNCATED, "image/jpeg"],
    ["PNG met een eXIf-chunk met GPS (N4)", PNG_GPS, "image/png"],
    ["PNG met GPS, opgeslagen als octet-stream", PNG_GPS, "application/octet-stream"],
    ["HEIC met een EXIF-blok met GPS", HEIC_GPS, "image/heic"],
  ] as const)("%s: niet ongewijzigd, en geen GPS", async (_name, file, type) => {
    const t = convexTest(schema, modules);
    for (const { where, res } of await servedEverywhere(t, file, type)) {
      const bytes = await bytesOf(res);
      expect(sameBytes(bytes, file), `${where}: het ongewijzigde bestand`).toBe(false);
      expect(gpsAnywhere(bytes), where).toBe(0);
      expect(res.status, `${where}: geen 500`).toBeLessThan(500);
    }
  });
});

describe("A-invariant 10: een gewone JPEG blijft zichtbaar", () => {
  it.each([
    ["baseline met EXIF en GPS", GPS_JPEG],
    ["progressief (10 scans) met EXIF en GPS", GPS_PROGRESSIEF],
  ] as const)("%s: 200, een JPEG, zonder GPS, de beelddata heel en niets erna", async (_name, file) => {
    const t = convexTest(schema, modules);
    for (const { where, res } of await servedEverywhere(t, file)) {
      expect(res.status, where).toBe(200);
      const bytes = await bytesOf(res);
      expect(isJpeg(bytes), where).toBe(true);
      expect(gpsAnywhere(bytes), where).toBe(0);
      expect(containsBytes(bytes, imageData(file)), `${where}: beelddata`).toBe(true);
      expect(afterFirstImage(bytes), where).toBe(0);
    }
  });

  it("een JPEG zonder metadata: ongewijzigd", async () => {
    const t = convexTest(schema, modules);
    for (const { where, res } of await servedEverywhere(t, SCHOON)) {
      expect(res.status, where).toBe(200);
      expect(sameBytes(await bytesOf(res), SCHOON), where).toBe(true);
    }
  });
});
