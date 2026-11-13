import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { seedMember } from "../_helpers/membership";
import { modules } from "../_helpers/modules";
import { exifGps, GPS_JPEG } from "./_gps";

// WP17d besluit 2 (A-invariant 8): een openbare profielfoto draagt geen
// locatie. Het openbare profielpad (`/beeld/profiel/<userId>`, met en zonder
// formaat, ook uitgelogd) geeft nooit een bestand met GPS, en nooit
// coördinaten of een plaatsnaam.
//
// Kernvondst 2 en 3: v1 zette de bytes ongewijzigd in S3, dus een gemigreerd
// origineel draagt EXIF met GPS. Het profielpad gaf het origineel zonder
// formaat, en als terugval bij een beeld zonder formaten. Op prod zijn er 17
// profielbeelden; 7 daarvan zijn een los beeld zonder foto-rij en hebben dus
// nooit formaten. Een profielfoto blijft zichtbaar (200): weglaten is geen
// oplossing.
//
// Het foto-pad (achter login, met foto-toegang) mag het origineel wel geven
// (besluit 1): tests/photoFormats/httpFormats.test.ts.

type T = ReturnType<typeof convexTest>;

async function storeJpeg(t: T, bytes: Uint8Array<ArrayBuffer>): Promise<Id<"_storage">> {
  return await t.run((ctx) => ctx.storage.store(new Blob([bytes], { type: "image/jpeg" })));
}

async function setup(t: T) {
  const owen = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  const mia = await registerUser(t, "user_mia", "mia@x.com", "Mia");
  const G = await withUser(t, "user_owen").mutation(api.groups.create, { name: "G" });
  await seedMember(t, { groupId: G, userId: mia });
  const A = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: G, name: "A" });

  // Een foto met formaten, een foto zonder, beide met een origineel met GPS.
  const withF = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([GPS_JPEG], { type: "image/jpeg" }));
    const formats = {
      klein: await ctx.storage.store(new Blob(["klein"], { type: "image/jpeg" })),
      groot: await ctx.storage.store(new Blob(["groot"], { type: "image/jpeg" })),
    };
    const photoId = await ctx.db.insert("photos", {
      ownerId: owen,
      storageId,
      formats,
      latitude: 52.123,
      longitude: 5.987,
      locationLabel: "8 Dorpsstraat - Ergens - Nederland",
      createdAt: Date.now(),
    });
    return { photoId, storageId };
  });
  const without = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([GPS_JPEG], { type: "image/jpeg" }));
    const photoId = await ctx.db.insert("photos", {
      ownerId: owen,
      storageId,
      latitude: 52.123,
      longitude: 5.987,
      locationLabel: "8 Dorpsstraat - Ergens - Nederland",
      createdAt: Date.now(),
    });
    return { photoId, storageId };
  });
  for (const p of [withF, without]) {
    await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: A, photoId: p.photoId });
  }
  const loose = await storeJpeg(t, GPS_JPEG);
  return { owen, mia, withF, without, loose };
}

const profileUrl = (id: string, formaat?: string) =>
  `/beeld/profiel/${id}${formaat ? `?formaat=${formaat}` : ""}`;

const SOURCES = ["foto met formaten", "foto zonder formaten", "los gemigreerd beeld"] as const;
const FORMATS = [undefined, "klein", "groot"] as const;
const CLIENTS = [
  ["uitgelogd", null],
  ["een medelid", "user_mia"],
  ["zichzelf", "user_owen"],
] as const;

async function useAsProfile(t: T, s: Awaited<ReturnType<typeof setup>>, source: (typeof SOURCES)[number]) {
  const storageId =
    source === "foto met formaten" ? s.withF.storageId : source === "foto zonder formaten" ? s.without.storageId : s.loose;
  await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: storageId }));
}

describe("het testbestand zelf (sanity)", () => {
  it("gps.jpg is een JPEG met een GPS-wijzer in de EXIF", () => {
    expect(exifGps(GPS_JPEG)).toEqual({ isJpeg: true, hasGps: true });
  });
});

describe("besluit 2: het openbare profielpad geeft nooit een bestand met GPS", () => {
  for (const source of SOURCES) {
    for (const formaat of FORMATS) {
      for (const [who, subject] of CLIENTS) {
        it(`${source}, ${formaat ? `?formaat=${formaat}` : "zonder formaat"}, ${who}: 200, geen GPS`, async () => {
          const t = convexTest(schema, modules);
          const s = await setup(t);
          await useAsProfile(t, s, source);
          const client = subject === null ? t : withUser(t, subject);
          const res = await client.fetch(profileUrl(s.owen, formaat), { method: "GET" });
          expect(res.status).toBe(200);
          const bytes = new Uint8Array(await res.arrayBuffer());
          expect(bytes.length).toBeGreaterThan(0);
          expect(exifGps(bytes).hasGps).toBe(false);
        });
      }
    }
  }

  it("een gestript origineel blijft een JPEG (het beeld zelf blijft heel)", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await useAsProfile(t, s, "los gemigreerd beeld");
    const res = await t.fetch(profileUrl(s.owen), { method: "GET" });
    expect(exifGps(new Uint8Array(await res.arrayBuffer())).isJpeg).toBe(true);
  });
});

describe("besluit 2: het openbare profielpad geeft nooit coördinaten of een plaatsnaam", () => {
  it.each(SOURCES)("%s: geen kop met een plek, plaatsnaam of coördinaat", async (source) => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await useAsProfile(t, s, source);
    for (const formaat of FORMATS) {
      const res = await t.fetch(profileUrl(s.owen, formaat), { method: "GET" });
      for (const [name, value] of res.headers.entries()) {
        expect(name).not.toMatch(/lat|lon|locat|gps|plaats|geo/i);
        expect(value).not.toMatch(/52\.123|5\.987|Dorpsstraat|Ergens/);
      }
    }
  });
});
