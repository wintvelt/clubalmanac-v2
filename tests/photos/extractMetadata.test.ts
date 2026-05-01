import { convexTest } from "convex-test";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUserWithInvite, withUser } from "../_helpers/auth";

// ---------------------------------------------------------------------------
// File upload werkpakket — Sessie A test-spec, KERN.
// Cyclus 2: EXIF/geocoding hardening (audit-10) + MapQuest → Photon switch.
//
// Wat verandert t.o.v. cyclus 1:
//   1. Geocoding-provider: MapQuest → Photon (Komoot, EU, OSM-data, no API key,
//      fair-use). Plan-doc env-vars sectie + cascade matrix gewijzigd.
//   2. takenAt-mapping: DateTimeOriginal ?? CreateDate fallback (audit-10:
//      iOS gebruikt "DateTimeOriginal" prominent, Android meer "CreateDate";
//      voorheen alleen DateTimeOriginal → veel iPhone-foto's zonder takenAt).
//   3. locationLabel format: multi-deel `${street}, ${city}, ${country}`,
//      lege fields gefilterd (audit-10: oude single-field label gaf "Damrak"
//      ipv "Damrak, Amsterdam, Nederland" voor map-tooltips).
//   4. Granulaire try/catch + console.error logging in extractMetadata
//      (audit-10: één lege catch slikte alle fouten zonder spoor; nu
//      onderscheidbaar exif-import-fail, exif-parse-fail, geocode-fail).
//   5. HEIC: graceful no-op + log "unsupported format" (iPhone uploads
//      arriveren als HEIC, exif-parser kan ze niet parsen — voorheen werd
//      dit gewoon stil als "non-image bytes" weggetrapt).
//
// Photon API contract (geverifieerd tegen live endpoint, mei 2026):
//   GET https://photon.komoot.io/reverse?lat=<lat>&lon=<lon>
//   Headers: User-Agent: Clubalmanac/2.0 (Photon vraagt fair-use UA)
//   Response: GeoJSON FeatureCollection
//     {
//       "type": "FeatureCollection",
//       "features": [
//         {
//           "type": "Feature",
//           "properties": {
//             "name": "Damrak",        // streetname / POI-name
//             "street": "Damrak",      // soms aanwezig (afhankelijk van OSM-tag)
//             "city": "Amsterdam",
//             "country": "Nederland",
//             "state": "Noord-Holland",
//             "postcode": "1012",
//             "type": "street"
//           },
//           "geometry": { "type": "Point", "coordinates": [4.9041, 52.3676] }
//         }
//       ]
//     }
//   Lege uitkomst: { "type": "FeatureCollection", "features": [] }
//   Downtime: 5xx of network error — graceful null-pad zoals MapQuest.
//
// API-signaturen (ongewijzigd t.o.v. cyclus 1, alleen interne implementatie):
//   internal.photos.reverseGeocode({lat, lon}): Promise<string | null>
//   internal.photos.extractMetadata({photoId}): Promise<void>
//   internal.photos.patchMetadata({photoId, ...metadataFields}): mutation
//
// Test-storage-aanpak — keuze gedocumenteerd:
//   Convex-test draait actions in edge-runtime VM. Echt JPEG-bytes met
//   geldige EXIF cross-runtime werkend krijgen is fragiel. Cyclus 2 kiest
//   bewust voor **mock van exif-parser via vi.mock**:
//     - Deterministisch, geen platform-afhankelijkheid
//     - Test alleen action-logica (mapping van tags naar patch-args), niet
//       exif-parser zelf — die lib heeft eigen testsuite
//     - Voor Orientation/DateTimeOriginal/GPS/dimensions roundtrip is dit
//       voldoende: ieder veld krijgt expliciete assertion
//   Reële JPEG-fixtures kunnen later in een aparte integration-test layer
//   (cyclus 2+ scope, tegen echte Convex deployment).
// ---------------------------------------------------------------------------

// Mutable holder die elk test kan zetten vóór `t.action()` aanroep. De
// vi.mock-factory leest via een getter zodat update tussen tests doorwerkt
// (vi.mock zelf wordt gehoist en draait één keer per file).
type ExifMock =
  | { kind: "ok"; tags: Record<string, unknown>; imageSize?: { width?: number; height?: number } }
  | { kind: "throwOnParse"; message?: string }
  | { kind: "throwOnCreate"; message?: string };

let exifMock: ExifMock = { kind: "ok", tags: {} };

vi.mock("exif-parser", () => ({
  default: {
    create: (_buf: unknown) => {
      const m = exifMock;
      if (m.kind === "throwOnCreate") {
        throw new Error(m.message ?? "exif-parser create failed");
      }
      return {
        parse: () => {
          const cur = exifMock;
          if (cur.kind === "throwOnParse") {
            throw new Error(cur.message ?? "exif-parser parse failed");
          }
          if (cur.kind === "throwOnCreate") {
            // Mode flipped tussen create() en parse() — defensive.
            throw new Error(cur.message ?? "exif-parser create failed");
          }
          return {
            tags: cur.tags,
            imageSize: cur.imageSize ?? {},
          };
        },
      };
    },
  },
}));

// Fixture-helper: directe DB-insert van een photo record. Bypass auth en
// photoCount-logic — extractMetadata-tests testen alleen het extractMetadata-
// pad; record-creatie is fixture, niet de unit under test.
async function insertPhotoFixture(
  t: ReturnType<typeof convexTest>,
  ownerId: Id<"users">,
  storageId: Id<"_storage">,
  extras: { filename?: string; mimeType?: string } = {},
): Promise<Id<"photos">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("photos", {
      ownerId,
      storageId,
      ...extras,
      ratingCount: 0,
      createdAt: Date.now(),
    }),
  );
}

// Photon GeoJSON FeatureCollection helper. Lege fields filtert de action
// uit het multi-deel label.
function fakePhotonResponse(props: {
  street?: string;
  city?: string;
  country?: string;
  state?: string;
  name?: string;
  postcode?: string;
}) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          osm_type: "W",
          osm_id: 1,
          osm_key: "highway",
          osm_value: "primary",
          type: "street",
          ...props,
        },
        geometry: { type: "Point", coordinates: [4.9041, 52.3676] },
      },
    ],
  };
}

const PHOTON_HOST = "photon.komoot.io";

beforeEach(() => {
  // Default: parse returnt lege tags — match het non-image graceful pad.
  exifMock = { kind: "ok", tags: {} };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Guard paths — record/storage missing
// ---------------------------------------------------------------------------

describe("photos.extractMetadata — guard paths", () => {
  it("photoId verwijst naar verwijderde photo → no-op, geen error", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    await withUser(t, "user_alice").mutation(api.photos.remove, { photoId });

    await expect(
      t.action(internal.photos.extractMetadata, { photoId }),
    ).resolves.not.toThrow();
  });

  it("storage object weg (cleanup-race) → no-op, geen error", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    await t.run(async (ctx) => ctx.storage.delete(storageId));

    await expect(
      t.action(internal.photos.extractMetadata, { photoId }),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// No-EXIF graceful pad
// ---------------------------------------------------------------------------

describe("photos.extractMetadata — no-EXIF graceful", () => {
  it("non-image blob (geen EXIF tags) → record blijft op defaults, geen error", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["niet een echte JPEG"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);

    exifMock = { kind: "ok", tags: {} };

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.takenAt).toBeUndefined();
    expect(photo?.latitude).toBeUndefined();
    expect(photo?.longitude).toBeUndefined();
    expect(photo?.locationLabel).toBeUndefined();
    expect(photo?.width).toBeUndefined();
    expect(photo?.height).toBeUndefined();
    expect(photo?.exifOrientation).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// EXIF parsing — mocked exif-parser tags
// ---------------------------------------------------------------------------

describe("photos.extractMetadata — EXIF parsing (mocked)", () => {
  // Audit-10 §1: DateTimeOriginal heeft prioriteit, val terug op CreateDate.
  // exif-parser geeft beide in Unix-seconds; v2 slaat ms op.
  it("DateTimeOriginal aanwezig → takenAt = DateTimeOriginal * 1000", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);

    exifMock = {
      kind: "ok",
      tags: { DateTimeOriginal: 1700000000 }, // 2023-11-14
    };

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.takenAt).toBe(1700000000 * 1000);
  });

  it("alleen CreateDate (geen DateTimeOriginal) → takenAt = CreateDate * 1000", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);

    exifMock = {
      kind: "ok",
      tags: { CreateDate: 1600000000 },
    };

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.takenAt).toBe(1600000000 * 1000);
  });

  it("beide DateTimeOriginal én CreateDate → DateTimeOriginal wint", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);

    exifMock = {
      kind: "ok",
      tags: {
        DateTimeOriginal: 1700000000,
        CreateDate: 1600000000,
      },
    };

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.takenAt).toBe(1700000000 * 1000);
  });

  it("noch DateTimeOriginal noch CreateDate → takenAt blijft undefined (geen createdAt fallback)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);

    exifMock = { kind: "ok", tags: {} };

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.takenAt).toBeUndefined();
  });

  it("GPSLatitude + GPSLongitude → latitude+longitude gezet", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);

    exifMock = {
      kind: "ok",
      tags: { GPSLatitude: 52.37, GPSLongitude: 4.89 },
    };

    // Mock geocoding: geen GPS-resolve nodig om GPS-extractie te testen.
    // Photon mock returnt empty zodat locationLabel undefined blijft.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ type: "FeatureCollection", features: [] }),
          { status: 200 },
        ),
      ),
    );

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.latitude).toBe(52.37);
    expect(photo?.longitude).toBe(4.89);
  });

  // [GAP] NIEUW gedrag — audit-9 §EXIF Orientation. exif-parser geeft
  // tags.Orientation (1..8). v2 schema: exifOrientation. Test rondetript
  // alle 8 valide waarden + invalid (0, 9) → undefined.
  it("Orientation tag 1..8 → exifOrientation gezet", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");

    for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob(["x"])),
      );
      const photoId = await insertPhotoFixture(t, aliceId, storageId);
      exifMock = { kind: "ok", tags: { Orientation: o } };
      await t.action(internal.photos.extractMetadata, { photoId });
      const photo = await t.run((ctx) => ctx.db.get(photoId));
      expect(photo?.exifOrientation).toBe(o);
    }
  });

  it("Orientation = 0 of >8 (invalid) → exifOrientation blijft undefined", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");

    for (const o of [0, 9, 42, -1]) {
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob(["x"])),
      );
      const photoId = await insertPhotoFixture(t, aliceId, storageId);
      exifMock = { kind: "ok", tags: { Orientation: o } };
      await t.action(internal.photos.extractMetadata, { photoId });
      const photo = await t.run((ctx) => ctx.db.get(photoId));
      expect(photo?.exifOrientation).toBeUndefined();
    }
  });

  it("imageSize.width/height → width + height velden gepatched", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);

    exifMock = {
      kind: "ok",
      tags: {},
      imageSize: { width: 4032, height: 3024 },
    };

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.width).toBe(4032);
    expect(photo?.height).toBe(3024);
  });
});

// ---------------------------------------------------------------------------
// Granulaire try/catch — audit-10 §3
// ---------------------------------------------------------------------------

describe("photos.extractMetadata — granulaire foutpaden + logging", () => {
  it("exif-parser create() throwt → log + photo blijft op defaults, geen rethrow", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["corrupt"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);

    exifMock = { kind: "throwOnCreate", message: "Invalid JPEG marker" };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      t.action(internal.photos.extractMetadata, { photoId }),
    ).resolves.not.toThrow();

    // Log-sample assertion: enige aanroep met EXIF-context. Niet pinnen op
    // exact format — alleen dat de fout niet stilletjes verdwijnt zoals in
    // de cyclus 1 lege catch.
    expect(errSpy).toHaveBeenCalled();

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.takenAt).toBeUndefined();
    expect(photo?.width).toBeUndefined();
    expect(photo?.exifOrientation).toBeUndefined();
  });

  it("exif-parser parse() throwt → log + photo blijft op defaults, geen rethrow", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["corrupt"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);

    exifMock = { kind: "throwOnParse", message: "Bad EXIF segment" };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      t.action(internal.photos.extractMetadata, { photoId }),
    ).resolves.not.toThrow();

    expect(errSpy).toHaveBeenCalled();

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.takenAt).toBeUndefined();
    expect(photo?.exifOrientation).toBeUndefined();
  });

  it("Photon down (fetch throws) → log + photo behoudt lat/lon, locationLabel undefined", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);

    exifMock = {
      kind: "ok",
      tags: { GPSLatitude: 52.37, GPSLongitude: 4.89 },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNRESET")),
    );
    // Geocoding-faal moet zichtbaar in logs zijn (audit-10 §3: niet meer
    // stilletjes wegslikken).
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      t.action(internal.photos.extractMetadata, { photoId }),
    ).resolves.not.toThrow();

    expect(errSpy).toHaveBeenCalled();

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.latitude).toBe(52.37);
    expect(photo?.longitude).toBe(4.89);
    expect(photo?.locationLabel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// HEIC/HEIF graceful no-op — audit-10 §5 + audit-13 §2 brand-parametrization
// ---------------------------------------------------------------------------

describe("photos.extractMetadata — HEIC/HEIF unsupported brands", () => {
  // isHeicLike claimt support voor 8 ISO-BMFF brand-codes. Audit-13 §2:
  // cyclus 1 testte alleen "heic" → 1/8 coverage, sterke bias tussen claim
  // en verifieerbaar gedrag. Parametrized test pint alle 8 brands.
  const HEIF_BRANDS = [
    "heic",
    "heix",
    "heim",
    "heis",
    "hevc",
    "hevx",
    "mif1",
    "msf1",
  ];

  it.each(HEIF_BRANDS)(
    "brand=%s → graceful no-op + log unsupported, geen EXIF-parse",
    async (brand) => {
      const t = convexTest(schema);
      const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
      const header = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x18,
        0x66, // 'f'
        0x74, // 't'
        0x79, // 'y'
        0x70, // 'p'
        brand.charCodeAt(0),
        brand.charCodeAt(1),
        brand.charCodeAt(2),
        brand.charCodeAt(3),
      ]);
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([header])),
      );
      const photoId = await insertPhotoFixture(t, aliceId, storageId, {
        mimeType: "image/heic",
      });

      // Sentinel: als implementatie toch exif-parser zou aanroepen, throwt
      // de mock — test detecteert dat als regression.
      exifMock = {
        kind: "throwOnCreate",
        message: `should not be called for brand=${brand}`,
      };
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await expect(
        t.action(internal.photos.extractMetadata, { photoId }),
      ).resolves.not.toThrow();

      // Log-hint dat skip bewust gebeurde (niet stilletjes als generieke
      // parse-fail).
      const loggedHint = logSpy.mock.calls.some((call) => {
        const joined = call.map((c) => String(c)).join(" ").toLowerCase();
        return joined.includes("unsupported") || joined.includes("heic");
      });
      expect(loggedHint).toBe(true);

      const photo = await t.run((ctx) => ctx.db.get(photoId));
      expect(photo?.takenAt).toBeUndefined();
      expect(photo?.latitude).toBeUndefined();
      expect(photo?.longitude).toBeUndefined();
      expect(photo?.locationLabel).toBeUndefined();
      expect(photo?.width).toBeUndefined();
      expect(photo?.height).toBeUndefined();
      expect(photo?.exifOrientation).toBeUndefined();
    },
  );
});

// ---------------------------------------------------------------------------
// Geocoding via Photon — graceful degradation
// ---------------------------------------------------------------------------

describe("photos.extractMetadata — Photon geocoding (graceful)", () => {
  it("geen GPS coords → action skipt geocoding (geen Photon-call)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);

    exifMock = { kind: "ok", tags: {} };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await t.action(internal.photos.extractMetadata, { photoId });

    const calledPhoton = fetchSpy.mock.calls.some((c) =>
      String(c[0]).includes(PHOTON_HOST),
    );
    expect(calledPhoton).toBe(false);

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.locationLabel).toBeUndefined();
  });

  it("Photon 200 OK → locationLabel multi-deel `${street}, ${city}, ${country}`", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    await t.run(async (ctx) =>
      ctx.db.patch(photoId, { latitude: 52.37, longitude: 4.89 }),
    );

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          fakePhotonResponse({
            street: "Damrak",
            city: "Amsterdam",
            country: "Nederland",
          }),
        ),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await t.action(internal.photos.extractMetadata, { photoId });

    // URL gaat naar photon.komoot.io (niet mapquest).
    const calledPhoton = fetchSpy.mock.calls.some((c) =>
      String(c[0]).includes(PHOTON_HOST),
    );
    expect(calledPhoton).toBe(true);

    // User-Agent header gezet (Photon fair-use).
    const photonCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes(PHOTON_HOST),
    );
    const init = photonCall?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("User-Agent") ?? headers.get("user-agent")).toMatch(
      /Clubalmanac/i,
    );

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.locationLabel).toBe("Damrak, Amsterdam, Nederland");
  });

  it("Photon partial (geen street, wel name) → label valt terug op `${name}, ${city}, ${country}`", async () => {
    // OSM-data heeft soms `name` (POI: museum, kerk, gebouw) waar `street`
    // ontbreekt. Voor Clubalmanac context (foto's bij bezienswaardigheden)
    // is name een waardevolle fallback.
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    await t.run(async (ctx) =>
      ctx.db.patch(photoId, { latitude: 52.37, longitude: 4.89 }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            fakePhotonResponse({
              name: "Rijksmuseum",
              city: "Amsterdam",
              country: "Nederland",
            }),
          ),
          { status: 200 },
        ),
      ),
    );

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.locationLabel).toBe("Rijksmuseum, Amsterdam, Nederland");
  });

  // Audit-13 §1: nullish-coalescing `street ?? name` faalt op street: ""
  // (lege string is geen null/undefined → ?? geeft "" terug ipv name).
  // Comment in reverseGeocode claimt POI-fallback maar dekt 't niet voor
  // lege strings. Photon levert in praktijk soms `street: ""` (OSM-tag
  // zonder waarde) — Rijksmuseum-pad faalt dan stilletjes naar "Amsterdam,
  // Nederland". RED tot B fixt het bias-gat.
  it("Photon partial (street: '' lege string, wel name) → label valt terug op name (POI-fallback ook bij empty)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    await t.run(async (ctx) =>
      ctx.db.patch(photoId, { latitude: 52.37, longitude: 4.89 }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            fakePhotonResponse({
              street: "",
              name: "Rijksmuseum",
              city: "Amsterdam",
              country: "Netherlands",
            }),
          ),
          { status: 200 },
        ),
      ),
    );

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.locationLabel).toBe("Rijksmuseum, Amsterdam, Netherlands");
  });

  it("Photon partial (geen street, geen name) → label valt terug op `${city}, ${country}`", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    await t.run(async (ctx) =>
      ctx.db.patch(photoId, { latitude: 52.37, longitude: 4.89 }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            fakePhotonResponse({
              city: "Amsterdam",
              country: "Nederland",
            }),
          ),
          { status: 200 },
        ),
      ),
    );

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.locationLabel).toBe("Amsterdam, Nederland");
  });

  it("Photon partial (alleen country) → label = country", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    await t.run(async (ctx) =>
      ctx.db.patch(photoId, { latitude: 52.37, longitude: 4.89 }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(fakePhotonResponse({ country: "Nederland" })),
          { status: 200 },
        ),
      ),
    );

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.locationLabel).toBe("Nederland");
  });

  it("Photon empty features array → locationLabel undefined", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    await t.run(async (ctx) =>
      ctx.db.patch(photoId, { latitude: 52.37, longitude: 4.89 }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ type: "FeatureCollection", features: [] }),
          { status: 200 },
        ),
      ),
    );

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.locationLabel).toBeUndefined();
  });

  it("Photon timeout (AbortController) → graceful, lat/lon blijven, locationLabel undefined", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    await t.run(async (ctx) =>
      ctx.db.patch(photoId, { latitude: 52.37, longitude: 4.89 }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.reject(
          Object.assign(new Error("aborted"), { name: "AbortError" }),
        ),
      ),
    );

    await expect(
      t.action(internal.photos.extractMetadata, { photoId }),
    ).resolves.not.toThrow();

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.locationLabel).toBeUndefined();
    expect(photo?.latitude).toBe(52.37);
    expect(photo?.longitude).toBe(4.89);
  });

  it("Photon 5xx → graceful, locationLabel undefined", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    await t.run(async (ctx) =>
      ctx.db.patch(photoId, { latitude: 52.37, longitude: 4.89 }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("server fubar", { status: 503 }),
      ),
    );

    await expect(
      t.action(internal.photos.extractMetadata, { photoId }),
    ).resolves.not.toThrow();

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.locationLabel).toBeUndefined();
    expect(photo?.latitude).toBe(52.37);
    expect(photo?.longitude).toBe(4.89);
  });
});

// ---------------------------------------------------------------------------
// reverseGeocode helper — geïsoleerd
// ---------------------------------------------------------------------------

describe("photos.reverseGeocode (action helper)", () => {
  // Signature: ({lat, lon}) => Promise<string | null>. Ongewijzigd t.o.v.
  // cyclus 1 — alleen interne URL/parsing wijzigt.

  it("happy path → multi-deel string label", async () => {
    const t = convexTest(schema);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            fakePhotonResponse({
              street: "Centrum",
              city: "Amsterdam",
              country: "Nederland",
            }),
          ),
          { status: 200 },
        ),
      ),
    );

    const result = await t.action(internal.photos.reverseGeocode, {
      latitude: 52.37,
      longitude: 4.89,
    });
    expect(result).toBe("Centrum, Amsterdam, Nederland");
  });

  it("URL host = photon.komoot.io + lang=en + User-Agent gezet", async () => {
    // lang=en voor internationale leesbaarheid: voor reizen naar Georgië
    // (Georgisch schrift), Nepal (Devanagari), etc. krijgen we Latijns schrift
    // ipv onleesbare native script. NL-photos: minor cosmetisch verschil
    // ("Netherlands" ipv "Nederland", street/city-namen blijven gelijk).
    const t = convexTest(schema);
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(fakePhotonResponse({ city: "Amsterdam" })),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await t.action(internal.photos.reverseGeocode, {
      latitude: 52.37,
      longitude: 4.89,
    });

    expect(fetchSpy).toHaveBeenCalled();
    const firstCall = fetchSpy.mock.calls[0] ?? [];
    const url = firstCall[0];
    const init = firstCall[1];
    expect(String(url)).toContain(PHOTON_HOST);
    expect(String(url)).toContain("lat=52.37");
    expect(String(url)).toContain("lon=4.89");
    expect(String(url)).toContain("lang=en");
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get("User-Agent") ?? headers.get("user-agent")).toMatch(
      /Clubalmanac/i,
    );
  });

  it("empty features → null", async () => {
    const t = convexTest(schema);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ type: "FeatureCollection", features: [] }),
          { status: 200 },
        ),
      ),
    );

    const result = await t.action(internal.photos.reverseGeocode, {
      latitude: 52.37,
      longitude: 4.89,
    });
    expect(result).toBeNull();
  });

  it("timeout → null (geen throw)", async () => {
    const t = convexTest(schema);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.reject(
          Object.assign(new Error("aborted"), { name: "AbortError" }),
        ),
      ),
    );

    const result = await t.action(internal.photos.reverseGeocode, {
      latitude: 52.37,
      longitude: 4.89,
    });
    expect(result).toBeNull();
  });

  it("4xx → null (geen throw)", async () => {
    const t = convexTest(schema);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 400 })),
    );

    const result = await t.action(internal.photos.reverseGeocode, {
      latitude: 52.37,
      longitude: 4.89,
    });
    expect(result).toBeNull();
  });

  it("5xx → null (geen throw)", async () => {
    const t = convexTest(schema);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("down", { status: 503 })),
    );

    const result = await t.action(internal.photos.reverseGeocode, {
      latitude: 52.37,
      longitude: 4.89,
    });
    expect(result).toBeNull();
  });
});
