// WP12 fix-cyclus 1 — RED tests op `load-records`.
//
// Wat hier gepind wordt is de bevinding van de audit in één zin: de tool kon
// een complete dataset laden mét nul foto's, mét lege cover- en
// profielfoto-verwijzingen, mét alle photoCount op 0, en dat afsluiten met een
// groene verify. Niemand zou het gezien hebben. Dat is precies de klasse fout
// die dit werkpakket niet mag hebben — data die er correct uitziet en het niet
// is.
//
// De tests raken `scripts/.data/` niet (daar staat productie-PII) en praten
// niet met een echte deployment: de bestandslaag en de Convex-verbinding worden
// vervangen door het harnas in `_harness.ts`. Wat overblijft is de
// tooling-logica zelf.

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FakeDeployment } from "./_harness";
import {
  buildRecordsFile,
  buildStorageMap,
  createFakeDeployment,
  createFakeFiles,
  DEPLOYMENT_TABLES,
  storageKeyOf,
} from "./_harness";
import type { RecordsFile } from "../../scripts/migrate/runTransform";
import type { StorageMapFile } from "../../scripts/migrate/loadFiles";

// De mock-factories worden boven de imports gehesen; ze mogen daarom niets uit
// de module-scope aanroepen. Vandaar deze houder.
const h = vi.hoisted(() => ({
  deployment: null as any,
  files: null as any,
}));

vi.mock("../../scripts/migrate/convexAdmin.ts", () => ({
  makeAdminClient: (target: string) => ({
    target,
    url: "https://fake-dev-deployment.convex.cloud",
    client: {},
  }),
  runQuery: (admin: unknown, ref: unknown, args: unknown) => h.deployment.query(admin, ref, args),
  runMutation: (admin: unknown, ref: unknown, args: unknown) =>
    h.deployment.mutation(admin, ref, args),
}));

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

const { loadRecords } = await import("../../scripts/migrate/loadRecords.ts");

let deployment: FakeDeployment;
let records: RecordsFile;
let storageMap: StorageMapFile;

/** De vier bestanden die een echte run zou aantreffen, minus wat je weglaat. */
function put(files: Record<string, unknown>): void {
  h.files = createFakeFiles(files);
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deployment = createFakeDeployment();
  h.deployment = deployment;
  records = buildRecordsFile("dev");
  storageMap = buildStorageMap(records);
  put({ "convex-records.json": records, "storage-map.json": storageMap });
});

// ────────────────────────────────────────────────────────────────────────
// B-1 — een ontbrekend bestand is nooit een stille aftrekpost
// ────────────────────────────────────────────────────────────────────────
describe("load-records: de storage-map is een preconditie, geen suggestie", () => {
  test("zonder storage-map.json wordt er geen enkele rij geschreven", () => {
    // Een ontbrekende map betekent: `load-files` is niet (af)gedraaid. "Nul
    // bestanden bekend, dus nul foto's te laden" is nooit een geldige
    // conclusie — dat is het verschil tussen een lege dataset en een
    // overgeslagen stap.
    put({ "convex-records.json": records });
    return expect(loadRecords("dev", false))
      .rejects.toThrow()
      .then(() => {
        expect(deployment.insertCalls).toHaveLength(0);
      });
  });

  test("een lege storage-map laadt niet stilletjes een dataset zonder foto's", async () => {
    put({
      "convex-records.json": records,
      "storage-map.json": { ...storageMap, files: {} },
    });
    await expect(loadRecords("dev", false)).rejects.toThrow();
    expect(deployment.insertCalls).toHaveLength(0);
  });

  test("een map die één verwezen bestand mist, stopt vóór de eerste schrijf", async () => {
    const missing = storageKeyOf(records, "photos", "P-bob-1");
    put({
      "convex-records.json": records,
      "storage-map.json": buildStorageMap(records, { omit: [missing] }),
    });
    await expect(loadRecords("dev", false)).rejects.toThrow(new RegExp(missing));
    expect(deployment.insertCalls, "er mag niets half geladen zijn").toHaveLength(0);
  });

  test("de gate hangt niet aan missing-files.json — dat bestand valt pas aan het eind", async () => {
    // Precies het scenario waarin de gate moet werken: `load-files` brak
    // halverwege af, dus de lijst met ontbrekende bestanden is er nooit
    // gekomen. De map is dan onvolledig zonder dat iets dat meldt.
    const missing = storageKeyOf(records, "photos", "P-bob-1");
    put({
      "convex-records.json": records,
      "storage-map.json": buildStorageMap(records, { omit: [missing] }),
    });
    await expect(loadRecords("dev", false)).rejects.toThrow();
  });

  test("--accept-missing-files laat de run door en verliest precies die ene foto", async () => {
    // De vlag is een bevestiging van geaccepteerd verlies, geen voorwaarde om
    // te kunnen draaien. Wat erna in de deployment staat moet kloppen: alles
    // wat naar de foto verwees is mee weggevallen en de aggregates zijn
    // herteld, anders meldt WP10 vanaf dag één drift.
    const missing = storageKeyOf(records, "photos", "P-bob-1");
    put({
      "convex-records.json": records,
      "storage-map.json": buildStorageMap(records, { omit: [missing] }),
    });

    const before = {
      photos: records.meta.counts.photos!,
      albumPhotos: records.meta.counts.albumPhotos!,
      ratings: records.meta.counts.ratings!,
    };
    await expect(loadRecords("dev", true)).resolves.toBe(0);

    expect(deployment.count("photos")).toBe(before.photos - 1);
    expect(deployment.count("albumPhotos")).toBe(before.albumPhotos - 1);
    expect(deployment.count("ratings")).toBe(before.ratings - 1);

    const totalPhotoCount = deployment
      .docs("users")
      .reduce((sum, u) => sum + Number(u.photoCount ?? 0), 0);
    expect(totalPhotoCount, "photoCount moet de werkelijk geladen foto's tellen").toBe(
      before.photos - 1,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// B-2 — de leeg-preconditie dekt elke tabel die WP10 bewaakt
// ────────────────────────────────────────────────────────────────────────
describe("load-records: preconditie 'alles leeg'", () => {
  test("een niet-lege doeltabel stopt de run vóór de eerste schrijf", async () => {
    deployment.seed({ photos: 1 });
    await expect(loadRecords("dev", false)).rejects.toThrow();
    expect(deployment.insertCalls).toHaveLength(0);
  });

  test("achtergebleven uploadIdempotency-rijen tellen mee als 'niet leeg'", async () => {
    // WP10 controleert twee FK's op deze tabel. Blijven de rijen staan terwijl
    // hun ownerId's naar verwijderde users wijzen, dan is "verify groen en geen
    // drift" niet haalbaar zonder handwerk buiten de tool om. De deployment
    // beantwoordt de vraag hier wél; of convex/migration.ts dat ook doet staat
    // in migrationFunctions.test.ts.
    deployment.seed({ uploadIdempotency: 2 });
    await expect(loadRecords("dev", false)).rejects.toThrow(/uploadIdempotency/);
    expect(deployment.insertCalls).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// B-3 — de ID-map: dekking op wat er daadwerkelijk de deployment in gaat
// ────────────────────────────────────────────────────────────────────────
describe("load-records: de ID-map", () => {
  test("elke foreign key gaat als Convex-_id de deployment in, nooit als bron-sleutel", async () => {
    await expect(loadRecords("dev", false)).resolves.toBe(0);

    const idsPerTable = new Map<string, Set<string>>();
    for (const table of DEPLOYMENT_TABLES) {
      idsPerTable.set(table, new Set(deployment.docs(table).map((d) => d._id)));
    }
    const { FKS } = await import("../../scripts/migrate/types.ts");
    for (const table of DEPLOYMENT_TABLES) {
      for (const doc of deployment.docs(table)) {
        for (const fk of FKS[table as keyof typeof FKS] ?? []) {
          const value = doc[fk.field];
          if (value === undefined) {
            expect(fk.required, `${table}.${fk.field} ontbreekt terwijl hij verplicht is`).toBe(
              false,
            );
            continue;
          }
          expect(
            idsPerTable.get(fk.target)!.has(String(value)),
            `${table}.${fk.field}=${String(value)} is geen bestaand ${fk.target}-_id`,
          ).toBe(true);
        }
      }
    }
  });

  test("storage-sleutels worden vervangen door het _storage-id uit de map", async () => {
    await expect(loadRecords("dev", false)).resolves.toBe(0);
    const ids = new Set(Object.values(storageMap.files).map((f) => f.storageId));
    for (const photo of deployment.docs("photos")) {
      expect(ids.has(String(photo.storageId)), "photos.storageId komt niet uit de map").toBe(true);
    }
    for (const user of deployment.docs("users")) {
      if (user.profilePhotoStorageId === undefined) continue;
      expect(ids.has(String(user.profilePhotoStorageId))).toBe(true);
    }
  });

  test("elke user met een profielfoto in de records heeft er één in de deployment", async () => {
    // De aflezing aan de resultaatkant van R2-1. Profielfoto's zitten in geen
    // enkele rij-telling: gaan ze verloren, dan verandert er niets aan de
    // aantallen en meldt `verify` niets. De storage-map van het harnas komt uit
    // de handmatige oracle, dus deze test is blind voor een blinde vlek in de
    // functie die de upload-set bepaalt — en dat is precies de bedoeling.
    const expected = records.records.users.filter(
      (u) => typeof u.profilePhotoStorageKey === "string" && u.profilePhotoStorageKey.length > 0,
    );
    expect(expected.length, "de fixture heeft users met een profielfoto").toBeGreaterThan(0);

    await expect(loadRecords("dev", false)).resolves.toBe(0);

    const landed = deployment.docs("users").filter((u) => u.profilePhotoStorageId !== undefined);
    expect(landed).toHaveLength(expected.length);
  });

  test("een user zonder profielfoto krijgt er geen aangemeten", async () => {
    // Carol heeft haar foto gewist (lege-string-sentinel). Een lege string mag
    // nooit als storage-id landen: Convex verwacht daar een v.id("_storage").
    await expect(loadRecords("dev", false)).resolves.toBe(0);
    const zonder = deployment.docs("users").filter((u) => u.profilePhotoStorageId === undefined);
    expect(zonder.length).toBeGreaterThan(0);
    for (const user of deployment.docs("users")) {
      expect(user.profilePhotoStorageId).not.toBe("");
    }
  });

  test("een cover-foto wordt na de foto's ingevuld met een echt _id", async () => {
    await expect(loadRecords("dev", false)).resolves.toBe(0);
    const photoIds = new Set(deployment.docs("photos").map((p) => p._id));
    const covered = deployment.docs("groups").filter((g) => g.coverPhotoId !== undefined);
    expect(covered.length, "de fixture heeft een groep met cover-foto").toBeGreaterThan(0);
    for (const group of covered) {
      expect(photoIds.has(String(group.coverPhotoId))).toBe(true);
    }
  });

  test("een verwijzing naar een weggefilterd record is een harde fout, geen stille undefined", async () => {
    const broken = structuredClone(records) as RecordsFile;
    broken.records.memberships[0]!.userId = "U-bestaat-niet";
    put({ "convex-records.json": broken, "storage-map.json": storageMap });
    await expect(loadRecords("dev", false)).rejects.toThrow(/U-bestaat-niet/);
  });

  test("tooling-interne velden halen de deployment niet", async () => {
    await expect(loadRecords("dev", false)).resolves.toBe(0);
    for (const table of DEPLOYMENT_TABLES) {
      for (const doc of deployment.docs(table)) {
        expect(doc.sourceKey, `${table} draagt sourceKey de deployment in`).toBeUndefined();
        expect(doc.storageKey).toBeUndefined();
        expect(doc.profilePhotoStorageKey).toBeUndefined();
      }
    }
  });
});
