import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { upload } from "./_upload";

// WP18 A-keuze 2 en A-invariant 17 (kernvondst 6): omzetten in de app wist de
// EXIF, dus de app stuurt `DateTimeOriginal` uit de kiezer letterlijk mee als
// header `X-Taken-At` (EXIF-vorm "JJJJ:MM:DD UU:MM:SS"). De backend leest hem
// zoals exif-parser een EXIF-datum leest: de klokwaarde als UTC. Zo geven een
// JPEG met EXIF en een header dezelfde `takenAt`. Draagt het bestand zelf een
// datum, dan wint die. Een header die geen echte datum is, telt niet en is
// geen fout.
//
// Vraag 2 volgens het advies (bewaren, als aparte headers): `X-Latitude` en
// `X-Longitude` in decimale graden. Alleen samen en binnen bereik. Kiest
// Wouter "weglaten", dan vervalt die describe.
//
// Spec: docs/work-packages/WP18-foto-upload.md §Spec-criticus aanvullingen.

type ExifTags = Record<string, unknown>;
let exifTags: ExifTags = {};

vi.mock("exif-parser", () => ({
  default: {
    create: () => ({ parse: () => ({ tags: exifTags, imageSize: {} }) }),
  },
}));

beforeEach(() => {
  exifTags = {};
  // Geen echte Photon-aanroep vanuit de geplande extractMetadata.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ type: "FeatureCollection", features: [] })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type T = ReturnType<typeof convexTest>;

async function owen(t: T) {
  return await registerUser(t, "user_owen", "owen@x.com", "Owen");
}

async function photoOf(t: T, res: Response) {
  expect(res.status).toBe(200);
  const { photoId } = (await res.json()) as { photoId: Id<"photos"> };
  return { photoId, photo: (await t.run(async (ctx) => ctx.db.get(photoId)))! };
}

describe("A-keuze 2: de opnamedatum als header", () => {
  it("EXIF-vorm: takenAt is de klokwaarde als UTC, zoals exif-parser", async () => {
    const t = convexTest(schema, modules);
    await owen(t);
    const res = await upload(t, "user_owen", {
      uploadId: "u-1",
      headers: { "X-Taken-At": "2024:06:15 14:30:00" },
    });
    const { photo } = await photoOf(t, res);
    expect(photo.takenAt).toBe(Date.UTC(2024, 5, 15, 14, 30, 0));
  });

  it("de datum blijft staan als het bestand er geen heeft (extractMetadata daarna)", async () => {
    const t = convexTest(schema, modules);
    await owen(t);
    const res = await upload(t, "user_owen", {
      uploadId: "u-1",
      headers: { "X-Taken-At": "2023:12:31 23:59:59" },
    });
    const { photoId } = await photoOf(t, res);
    exifTags = {};
    await t.action(internal.photoMetadata.extractMetadata, { photoId });
    const photo = await t.run(async (ctx) => ctx.db.get(photoId));
    expect(photo!.takenAt).toBe(Date.UTC(2023, 11, 31, 23, 59, 59));
  });

  it("draagt het bestand zelf een datum, dan wint die", async () => {
    const t = convexTest(schema, modules);
    await owen(t);
    const res = await upload(t, "user_owen", {
      uploadId: "u-1",
      headers: { "X-Taken-At": "2024:06:15 14:30:00" },
    });
    const { photoId } = await photoOf(t, res);
    const fileDate = Date.UTC(2020, 0, 2, 3, 4, 5);
    exifTags = { DateTimeOriginal: fileDate / 1000 };
    await t.action(internal.photoMetadata.extractMetadata, { photoId });
    const photo = await t.run(async (ctx) => ctx.db.get(photoId));
    expect(photo!.takenAt).toBe(fileDate);
  });

  it.each([
    ["tekst", "gisteren"],
    ["de nul-datum van EXIF", "0000:00:00 00:00:00"],
    ["30 februari", "2024:02:30 10:00:00"],
    ["maand 13", "2024:13:01 10:00:00"],
    ["uur 25", "2024:06:15 25:00:00"],
    ["leeg", ""],
    ["alleen de datum", "2024:06:15"],
  ])("geen echte datum (%s): de upload lukt, zonder takenAt", async (_label, value) => {
    const t = convexTest(schema, modules);
    await owen(t);
    const res = await upload(t, "user_owen", { uploadId: "u-1", headers: { "X-Taken-At": value } });
    const { photo } = await photoOf(t, res);
    expect(photo.takenAt).toBeUndefined();
  });

  it("de herhaling met dezelfde id verandert de datum niet", async () => {
    const t = convexTest(schema, modules);
    await owen(t);
    const first = await upload(t, "user_owen", {
      uploadId: "u-1",
      headers: { "X-Taken-At": "2024:06:15 14:30:00" },
    });
    const { photoId } = await photoOf(t, first);
    await upload(t, "user_owen", { uploadId: "u-1", headers: { "X-Taken-At": "2010:01:01 00:00:00" } });
    const photo = await t.run(async (ctx) => ctx.db.get(photoId));
    expect(photo!.takenAt).toBe(Date.UTC(2024, 5, 15, 14, 30, 0));
  });
});

describe("vraag 2 (advies: bewaren, als aparte headers)", () => {
  it("breedte en lengte samen: bewaard", async () => {
    const t = convexTest(schema, modules);
    await owen(t);
    const res = await upload(t, "user_owen", {
      uploadId: "u-1",
      headers: { "X-Latitude": "52.3676", "X-Longitude": "-4.9041" },
    });
    const { photo } = await photoOf(t, res);
    expect(photo.latitude).toBeCloseTo(52.3676, 6);
    expect(photo.longitude).toBeCloseTo(-4.9041, 6);
  });

  it.each([
    ["alleen breedte", { "X-Latitude": "52.3676" }],
    ["alleen lengte", { "X-Longitude": "4.9041" }],
    ["breedte buiten bereik", { "X-Latitude": "91", "X-Longitude": "4.9" }],
    ["lengte buiten bereik", { "X-Latitude": "52.3", "X-Longitude": "-180.5" }],
    ["geen getal", { "X-Latitude": "noord", "X-Longitude": "4.9" }],
    ["leeg", { "X-Latitude": "", "X-Longitude": "" }],
  ])("ongeldig (%s): de upload lukt, zonder locatie", async (_label, headers) => {
    const t = convexTest(schema, modules);
    await owen(t);
    const res = await upload(t, "user_owen", { uploadId: "u-1", headers });
    const { photo } = await photoOf(t, res);
    expect(photo.latitude).toBeUndefined();
    expect(photo.longitude).toBeUndefined();
  });
});
