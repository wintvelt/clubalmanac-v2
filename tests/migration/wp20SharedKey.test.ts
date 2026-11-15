// WP20 besluit 10, R2 (fix-cyclus 2) — RED tests: de migratie stopt bij een
// gedeeld beeld.
//
// Hebben twee foto-records in de bron dezelfde S3-sleutel (`PO.url`), dan
// krijgen ze in v2 één storage-object: `load-files` uploadt per sleutel en
// `load-records` zet per sleutel hetzelfde `_storage`-id. Een melding (het
// beeld is weg voor leden) of een wis (cron FL1, `removeFlagged`) raakt dan ook
// het beeld van de andere foto. Daarom stopt de migratie, met een melding die
// de foto's noemt, vóór er iets geladen is. Geen ontsnappingsvlag.
//
// A-keuze 10: de stap is `transform`. Die draait vóór `load-files` en
// `load-records` (verify pas erna), is puur en heeft al zo'n stop (WP12b G1).
// Het gaat om de foto's die geladen worden: valt één van de twee weg (dev: de
// eigenaar is niet chosen), dan deelt er in v2 niets.
//
// Buiten deze stop: een profielfoto met de sleutel van een foto. Dat is in v1
// zo bedoeld (updateUser zet `photoUrl` op de url van de foto) en v2 ruimt het
// op bij het wissen van de foto (`photos.ts`, profilePhotoStorageId).
//
// Orakel: de foto-id's met de hand uit de fixture (tests/migration/fixture.ts).
// Op de prod-extract van 2026-11-07: 0 van 1544, dus de stop raakt T0 niet.
// Spec: docs/work-packages/WP20-melden.md §Besluiten na de red-team, §Fix-cyclus 2 (A).

import { describe, expect, test, vi } from "vitest";
import { transform, type TransformConfig } from "../../scripts/migrate/transform";
import { buildExtractFile, createFakeFiles } from "./_harness";
import {
  ALICE,
  BOB,
  buildExtractWithCovers,
  CAROL,
  CHOSEN,
  DAVE,
  DEV_SUBJECTS,
  PROD_SUBJECTS,
  type SourceItem,
} from "./fixture";

const h = vi.hoisted(() => ({ files: null as any }));

vi.mock("../../scripts/migrate/paths.ts", () => ({
  DATA_DIR: "/fake/.data",
  EXTRACT_FILE: "dynamo-extract.json",
  RECORDS_FILE: "convex-records.json",
  STORAGE_MAP_FILE: "storage-map.json",
  MISSING_FILES_FILE: "missing-files.json",
  dataPath: (name: string) => `/fake/.data/${name}`,
  ensureDataDir: () => {},
  dataFileExists: (name: string) => h.files.exists(name),
  readData: (name: string) => h.files.read(name),
  writeData: (name: string, value: unknown) => h.files.write(name, value),
  invalidateData: (name: string) => h.files.invalidate(name),
}));

const { runTransform } = await import("../../scripts/migrate/runTransform.ts");

const NOW = Date.parse("2026-08-23T00:00:00.000Z");
const RECORDS = "convex-records.json";

const PROD: TransformConfig = {
  target: "prod",
  chosenUserIds: null,
  anonymize: false,
  subjectByUserId: PROD_SUBJECTS,
  defaultPhotoLimit: 1000,
  now: NOW,
};

const DEV: TransformConfig = {
  target: "dev",
  chosenUserIds: CHOSEN,
  anonymize: true,
  subjectByUserId: DEV_SUBJECTS,
  defaultPhotoLimit: 1000,
  now: NOW,
};

// Fixture: P-alice-1 vroeg.jpg, P-alice-2 laat.jpg, P-bob-1 bob1.jpg,
// P-bob-2 bob2.jpg (bob), P-dave-1 dave1.jpg (dave, niet chosen op dev).
const BOB1 = "protected/U-bob-sub/bob1.jpg";
const VROEG = "protected/U-alice-sub/vroeg.jpg";

/** De fixture met andere S3-sleutels voor de genoemde foto's. */
function withUrls(urls: Record<string, string>): SourceItem[] {
  return buildExtractWithCovers().map((item) => {
    const pk = typeof item.PK === "string" ? item.PK : "";
    const photoId = pk.startsWith("PO") ? pk.slice(2) : undefined;
    return photoId !== undefined && urls[photoId] !== undefined ? { ...item, url: urls[photoId] } : item;
  });
}

/** De melding van de stop; faalt als er geen stop is. */
function stopMessage(items: SourceItem[], config: TransformConfig): string {
  try {
    transform(items, config);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("transform stopte niet");
}

describe("WP20 R2: premisse", () => {
  test("de fixture zelf: elke foto een eigen sleutel, geen stop (prod en dev)", () => {
    expect(() => transform(buildExtractWithCovers(), PROD)).not.toThrow();
    expect(() => transform(buildExtractWithCovers(), DEV)).not.toThrow();
  });
});

describe("WP20 R2: twee foto's met dezelfde S3-sleutel stoppen de transform", () => {
  test("twee foto's van verschillende eigenaren: stop, beide foto's genoemd", () => {
    const message = stopMessage(withUrls({ "P-dave-1": BOB1 }), PROD);
    expect(message).toContain("P-bob-1");
    expect(message).toContain("P-dave-1");
  });

  test("twee foto's van dezelfde eigenaar: ook een stop", () => {
    const message = stopMessage(withUrls({ "P-bob-2": BOB1 }), PROD);
    expect(message).toContain("P-bob-1");
    expect(message).toContain("P-bob-2");
  });

  test("drie foto's met één sleutel: alle drie genoemd", () => {
    const message = stopMessage(withUrls({ "P-bob-2": BOB1, "P-dave-1": BOB1 }), PROD);
    for (const id of ["P-bob-1", "P-bob-2", "P-dave-1"]) expect(message).toContain(id);
  });

  test("twee aparte paren: één stop die alle vier noemt, niet alleen het eerste paar", () => {
    const message = stopMessage(withUrls({ "P-bob-2": BOB1, "P-alice-2": VROEG }), PROD);
    for (const id of ["P-alice-1", "P-alice-2", "P-bob-1", "P-bob-2"]) expect(message).toContain(id);
  });

  test("een foto met een eigen sleutel staat niet in de melding", () => {
    const message = stopMessage(withUrls({ "P-dave-1": BOB1 }), PROD);
    expect(message).not.toContain("P-alice-1");
    expect(message).not.toContain("P-bob-2");
  });

  test("dezelfde sleutel met spaties eromheen telt als dezelfde (de transform trimt de url)", () => {
    const message = stopMessage(withUrls({ "P-dave-1": `  ${BOB1} ` }), PROD);
    expect(message).toContain("P-bob-1");
    expect(message).toContain("P-dave-1");
  });

  test("--accept-flagged-deletion zet deze stop niet uit", () => {
    const message = stopMessage(withUrls({ "P-dave-1": BOB1 }), { ...PROD, acceptFlaggedDeletion: true });
    expect(message).toContain("P-dave-1");
  });

  test("dev: ook een stop als beide foto's geladen worden", () => {
    const message = stopMessage(withUrls({ "P-bob-2": BOB1 }), DEV);
    expect(message).toContain("P-bob-1");
    expect(message).toContain("P-bob-2");
  });
});

describe("WP20 R2: alleen foto's die geladen worden (A-keuze 10)", () => {
  test("dev: de tweede foto valt weg (dave niet chosen), dus geen gedeeld beeld en geen stop", () => {
    const items = withUrls({ "P-dave-1": BOB1 });
    expect(() => transform(items, DEV)).not.toThrow();
    // Dezelfde bron op prod laadt beide: daar wel.
    expect(() => transform(items, PROD)).toThrow(/P-dave-1/);
  });
});

describe("WP20 R2: de stop komt vóór er iets geladen is", () => {
  function putWorkdir(items: SourceItem[]): void {
    const email = (user: { email: string }) => user.email.toLowerCase();
    h.files = createFakeFiles({
      "dynamo-extract.json": buildExtractFile(items),
      "prod-config.json": {
        clerkIdByEmail: {
          [email(ALICE)]: PROD_SUBJECTS["U-alice"],
          [email(BOB)]: PROD_SUBJECTS["U-bob"],
          [email(CAROL)]: PROD_SUBJECTS["U-carol"],
          [email(DAVE)]: PROD_SUBJECTS["U-dave"],
        },
      },
    });
  }

  test("premisse: zonder gedeelde sleutel schrijft runTransform zijn records", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    putWorkdir(buildExtractWithCovers());
    runTransform("prod", NOW);
    expect(h.files.exists(RECORDS)).toBe(true);
  });

  test("met een gedeelde sleutel: stop, en geen convex-records.json (load-files en load-records hebben niets)", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    putWorkdir(withUrls({ "P-dave-1": BOB1 }));
    expect(() => runTransform("prod", NOW)).toThrow(/P-dave-1/);
    expect(h.files.exists(RECORDS), "records geschreven ondanks de stop").toBe(false);
  });
});
