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

// Fixture-helper: directe DB-insert van een photo record. Bypass auth en
// photoCount-logic — extractMetadata-tests testen alleen het extractMetadata-
// pad; record-creatie is fixture, niet de unit under test. De vorige spec
// gebruikte hiervoor `api.photos.createFromUpload`, maar die mutation is
// vervallen in de cyclus 1 upload-rewrite (1-step backend-mediated POST
// /upload via convex/http.ts; zie docs/migratie-plan-convex.md File Storage
// sectie). Direct insert is sneller en omzeilt de hele HTTP-flow die niet
// relevant is voor metadata-extractie tests.
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

// File upload werkpakket — Sessie A test-spec, KERN.
//
// Bron: oude AWS handlers
//   /Users/wintvelt/Documents/DEV/DEV/blob-images-api-photos/handlersPhoto/createPhoto.js
//     regel 86-104 (EXIF-extractie pad) + 86-95 (S3-metadata pad voor migrations,
//     niet relevant voor v2).
//   /Users/wintvelt/Documents/DEV/DEV/blob-images-api-photos/libs/lib-geodata.js
//     regel 29-70 (fetchGeoCode = MapQuest reverse geocoding, AbortController
//     + 2s timeout, Intl.DisplayNames voor country, transliteration).
//     regel 72-82 (getExif = exif-parser create + parse, error → return {error:true}).
//     regel 85-113 (getExifData = parse CreateDate → exifDate, GPSLat/Lon → geocode).
//
// Convex equivalent:
//   internal.photos.extractMetadata({ photoId }): Promise<void>
//     - Action (kan ctx.storage.get + extern fetch).
//     - Leest photo record → krijgt storageId.
//     - Leest blob uit storage.
//     - Parst EXIF via exif-parser (Node lib, alleen in actions beschikbaar).
//     - Patcht photo record met width, height, takenAt, latitude, longitude,
//       exifOrientation (NEW veld — audit-9 §photo rotation).
//     - Bij GPS aanwezig: belt internal.photos.reverseGeocode → patcht
//       locationLabel.
//     - Patches gaan via ctx.runMutation (action kan niet direct ctx.db.patch).
//
//   internal.photos.reverseGeocode({ latitude, longitude }): Promise<string | null>
//     - Action helper. MapQuest API call met 2s timeout (matcht AWS).
//     - Returnt location-label string of null (timeout/4xx/5xx/missing-key →
//       graceful null, geen throw).
//
// Veld-mapping AWS → v2:
//   exifDate (YYYY-MM-DD string)  → takenAt (number = ms timestamp)
//   exifLat                       → latitude
//   exifLon                       → longitude
//   exifAddress (string)          → locationLabel
//   (nieuw)                       → exifOrientation (number 1..8, audit-9 §photo rotation)
//   (nieuw)                       → width, height (uit EXIF ImageWidth/ImageHeight)
//
// Test-storage-aanpak — keuze gedocumenteerd:
//   Convex-test draait actions in edge-runtime VM. Echt JPEG-bytes met
//   geldige EXIF in fixtures hebben we niet, en exif-parser laden in
//   edge-runtime is mogelijk fragiel. Gekozen aanpak:
//     1. Tests die NIET op echte EXIF-parsing leunen (no-photo, no-storage,
//        non-image bytes → graceful no-EXIF) draaien als gewone unit tests.
//     2. Tests die EXIF-parsing zelf valideren (Orientation 1..8 mapping,
//        DateTimeOriginal → takenAt) zijn `it.todo(...)` met expliciete
//        boundary documentatie. B vult deze in tijdens implementatie via
//        eigen voorkeur (real fixture, mocked exif-parser, of integration
//        test tegen echte deployment). Reden: spec-author kan niet zinvol
//        beweren of edge-runtime exif-parser laadt.
//     3. Geocoding-tests gebruiken vi.stubGlobal('fetch', ...) om MapQuest
//        respons te mocken — pinnen graceful-degradation contract zonder
//        echte HTTP-calls.

const MAPQUEST_KEY_ENV = "MAPQUEST_KEY";

// MapQuest-reverse response shape, zie lib-geodata.js regel 57-67.
const fakeMapQuestResponse = (label: string) => ({
  results: [
    {
      locations: [
        {
          street: label,
          adminArea1: "NL",
          adminArea1Type: "Country",
          adminArea3: "Noord-Holland",
          adminArea3Type: "State",
          adminArea5: "Amsterdam",
          adminArea5Type: "City",
        },
      ],
    },
  ],
});

beforeEach(() => {
  // Default: geen MapQuest key → reverseGeocode skipt (matched 'env-var
  // missing'-test).
  delete process.env[MAPQUEST_KEY_ENV];
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env[MAPQUEST_KEY_ENV];
});

describe("photos.extractMetadata — guard paths", () => {
  it("photoId verwijst naar verwijderde photo → no-op, geen error", async () => {
    // Bron: oude AWS S3-trigger had geen "photo bestaat niet"-pad omdat
    // de trigger het record zelf maakte. v2 splitst create van metadata,
    // dus de race "photo verwijderd vóór action draait" is reëel
    // (storage cleanup queue, etc.).
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    // Verwijder photo direct.
    await withUser(t, "user_alice").mutation(api.photos.remove, { photoId });

    await expect(
      t.action(internal.photos.extractMetadata, { photoId }),
    ).resolves.not.toThrow();
  });

  it("storage object weg (cleanup-race) → no-op, geen error", async () => {
    // Bron: storage cleanup en metadata-extract draaien beide async; als
    // cleanup-action eerder klaar is verdwijnt de blob. Action moet graceful.
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    // Verwijder storage maar laat photo record staan.
    await t.run(async (ctx) => ctx.storage.delete(storageId));

    await expect(
      t.action(internal.photos.extractMetadata, { photoId }),
    ).resolves.not.toThrow();
  });
});

describe("photos.extractMetadata — no-EXIF graceful", () => {
  it("non-image blob (geen EXIF) → record blijft op defaults, geen error", async () => {
    // Bron: lib-geodata.js regel 78-81 — getExif catched parse-error,
    // returnt { error: true }. getExifData regel 89: if (exifItem.error)
    // return {} → updateObj blijft leeg, geen patches.
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["niet een echte JPEG"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.takenAt).toBeUndefined();
    expect(photo?.latitude).toBeUndefined();
    expect(photo?.longitude).toBeUndefined();
    expect(photo?.locationLabel).toBeUndefined();
    expect(photo?.width).toBeUndefined();
    expect(photo?.height).toBeUndefined();
  });
});

describe("photos.extractMetadata — EXIF parsing", () => {
  // Tests die echte JPEG-fixtures vereisen. Markered als it.todo zodat ze
  // expliciet in de test-output verschijnen als "B moet implementeren of
  // beargumenteren waarom integration-only".
  //
  // Bron-mapping per todo:

  it.todo(
    // lib-geodata.js regel 92-97: createDate (Unix sec) → Date(*1000) →
    // makeDateStr → exifDate string. v2: takenAt = createDate * 1000 (ms).
    "EXIF DateTimeOriginal → takenAt (ms timestamp, niet datestring)",
  );

  it.todo(
    // lib-geodata.js regel 98-110: GPSLatitudeRef triggert lat/lon extractie.
    // GPS aanwezig zonder DateTimeOriginal → lat/lon gevuld, takenAt undefined.
    "EXIF GPS aanwezig zonder DateTimeOriginal → latitude+longitude gezet, takenAt undefined",
  );

  it.todo(
    // [GAP] NIEUW gedrag — geen AWS-equivalent. Audit-9 §EXIF Orientation:
    // exif-parser geeft tags.Orientation (1..8). v2 schema: exifOrientation
    // (B voegt veld toe). Test moet alle 8 waarden ronde-trippen.
    "EXIF Orientation tag 1..8 → exifOrientation veld (alle 8 waarden)",
  );

  it.todo(
    // [GAP] NIEUW veld. exif-parser geeft imageSize.width/height. v2
    // schema heeft photos.width / photos.height al gedefinieerd, maar
    // oude AWS createPhoto.js sloeg deze NIET op (alleen exifDate/Lat/Lon/
    // Address). Hier expliciet pinnen dat width+height geëxtraheerd worden.
    "JPEG dimensions → width + height velden",
  );

  it.todo(
    // lib-geodata.js regel 92-95: alleen als CreateDate aanwezig is.
    // exifDate niet zetten als ontbreekt. v2: takenAt blijft undefined,
    // GEEN fallback naar createdAt (audit-decision: createdAt ≠ takenAt;
    // upload-tijd is geen photo-tijd).
    "geen DateTimeOriginal → takenAt blijft undefined (geen createdAt fallback)",
  );
});

describe("photos.extractMetadata — geocoding (graceful degradation)", () => {
  // Boundary: tests met handmatig gepatchte lat/lon in photo record om
  // EXIF-parsing buiten beschouwing te laten en alleen het MapQuest-pad
  // te isoleren. B mag besluiten een aparte signature te kiezen waarbij
  // extractMetadata een sub-action belt; alternatief is dat we
  // internal.photos.reverseGeocode ({lat, long}) direct aanroepen — zie
  // sectie hieronder.

  it("MapQuest key ontbreekt → action skipt geocoding, lat/lon blijven, locationLabel undefined", async () => {
    // Bron: lib-geodata.js regel 31 — process.env.MAPQUEST_KEY in URL.
    // Geen key → URL ongeldig → fetch faalt. Wij forceren expliciete skip
    // (geen onnodige fetch met "undefined" key in URL).
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["niet-jpeg"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    // Patch record met fake GPS — alsof EXIF al geparsed is. Action moet
    // 'lat/lon staat al, geen key, skip geocoding'-pad nemen.
    await t.run(async (ctx) =>
      ctx.db.patch(photoId, { latitude: 52.37, longitude: 4.89 }),
    );

    delete process.env[MAPQUEST_KEY_ENV];
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await t.action(internal.photos.extractMetadata, { photoId });

    // Geen MapQuest call gedaan.
    expect(
      fetchSpy.mock.calls.some((call) =>
        String(call[0]).includes("mapquest"),
      ),
    ).toBe(false);

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.latitude).toBe(52.37);
    expect(photo?.longitude).toBe(4.89);
    expect(photo?.locationLabel).toBeUndefined();
  });

  it("MapQuest 200 OK → locationLabel gepatched", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["niet-jpeg"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    await t.run(async (ctx) =>
      ctx.db.patch(photoId, { latitude: 52.37, longitude: 4.89 }),
    );

    process.env[MAPQUEST_KEY_ENV] = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fakeMapQuestResponse("Damrak 1")), {
          status: 200,
        }),
      ),
    );

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(typeof photo?.locationLabel).toBe("string");
    expect(photo?.locationLabel?.length ?? 0).toBeGreaterThan(0);
  });

  it("MapQuest timeout (AbortController 2s) → graceful, geen throw, locationLabel undefined", async () => {
    // Bron: lib-geodata.js regel 37-55: AbortController + 2s timeout +
    // catch AbortError → return {} (graceful). Hier simuleren we abort.
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["niet-jpeg"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    await t.run(async (ctx) =>
      ctx.db.patch(photoId, { latitude: 52.37, longitude: 4.89 }),
    );

    process.env[MAPQUEST_KEY_ENV] = "test-key";
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
    // GPS blijft staan — alleen label faalde.
    expect(photo?.latitude).toBe(52.37);
    expect(photo?.longitude).toBe(4.89);
  });

  it("MapQuest 5xx error → graceful, geen throw, locationLabel undefined", async () => {
    // Bron: lib-geodata.js regel 57-59: response zonder results[0] →
    // location undefined → return ''. Wij interpreteren empty string als
    // 'geen label gevonden' → locationLabel blijft undefined (in plaats
    // van empty string opslaan).
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["niet-jpeg"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    await t.run(async (ctx) =>
      ctx.db.patch(photoId, { latitude: 52.37, longitude: 4.89 }),
    );

    process.env[MAPQUEST_KEY_ENV] = "test-key";
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

  it("MapQuest 200 maar empty results → locationLabel undefined", async () => {
    // Bron: lib-geodata.js regel 57-59 — found && location guard.
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["niet-jpeg"])),
    );
    const photoId = await insertPhotoFixture(t, aliceId, storageId);
    await t.run(async (ctx) =>
      ctx.db.patch(photoId, { latitude: 52.37, longitude: 4.89 }),
    );

    process.env[MAPQUEST_KEY_ENV] = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ results: [{ locations: [] }] }), {
          status: 200,
        }),
      ),
    );

    await t.action(internal.photos.extractMetadata, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.locationLabel).toBeUndefined();
  });
});

describe("photos.reverseGeocode (action helper)", () => {
  // Aparte action zodat de geocoding-stap geïsoleerd test-baar is en
  // hergebruikt kan worden door eventuele backfill-jobs (oude AWS had
  // geen equivalent helper, B mag besluiten dit als private utility te
  // houden — dan kan deze test verhuizen naar interne dekking).
  //
  // [GAP] open: returnt action `string | null` (nullable) of `string`
  // (lege string voor missing)? Defaultkeuze: null voor "niets gevonden",
  // string voor success. Lege string nooit als label gebruiken (consistent
  // met MapQuest-tests hierboven die undefined / niet-gepatched verwachten).

  it("missing key → null", async () => {
    const t = convexTest(schema);
    delete process.env[MAPQUEST_KEY_ENV];
    const result = await t.action(internal.photos.reverseGeocode, {
      latitude: 52.37,
      longitude: 4.89,
    });
    expect(result).toBeNull();
  });

  it("happy path → string label", async () => {
    const t = convexTest(schema);
    process.env[MAPQUEST_KEY_ENV] = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fakeMapQuestResponse("Centrum")), {
          status: 200,
        }),
      ),
    );

    const result = await t.action(internal.photos.reverseGeocode, {
      latitude: 52.37,
      longitude: 4.89,
    });
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeGreaterThan(0);
  });

  it("timeout → null (geen throw)", async () => {
    const t = convexTest(schema);
    process.env[MAPQUEST_KEY_ENV] = "test-key";
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
    process.env[MAPQUEST_KEY_ENV] = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 401 })),
    );

    const result = await t.action(internal.photos.reverseGeocode, {
      latitude: 52.37,
      longitude: 4.89,
    });
    expect(result).toBeNull();
  });
});
