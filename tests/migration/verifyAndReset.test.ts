// WP12 fix-cyclus 1 — RED tests op `verify` en `reset`.
//
// De kern van B-1c: `verify` en `load-records` leidden hun verwachting met
// dezelfde code af. Daardoor kon de controlestap de belangrijkste fout van de
// laadstap structureel niet zien — verwacht 0, gevonden 0, dus "ok". Een
// controle die meebeweegt met de fout die hij moet vinden is geen controle.
//
// De verwachting hoort uit de eerdere, onafhankelijke laag te komen: de
// tellingen die `transform` in convex-records.json heeft vastgelegd, vóórdat
// er ook maar één bestand of rij richting de deployment ging.
//
// Voor `reset` geldt de B-2-eis: na een reset is élke tabel leeg die de
// leeg-preconditie van `load-records` telt. Loopt dat uit elkaar, dan is
// "verify groen en geen drift" niet haalbaar zonder handwerk buiten de tool om.

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FakeDeployment } from "./_harness";
import {
  buildRecordsFile,
  buildStorageMap,
  createFakeDeployment,
  createFakeFiles,
  DEPLOYMENT_TABLES,
} from "./_harness";
import type { RecordsFile } from "../../scripts/migrate/runTransform";
import type { StorageMapFile } from "../../scripts/migrate/loadFiles";

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

const { verify } = await import("../../scripts/migrate/verify.ts");
const { reset } = await import("../../scripts/migrate/reset.ts");
const { loadRecords } = await import("../../scripts/migrate/loadRecords.ts");

let deployment: FakeDeployment;
let records: RecordsFile;
let storageMap: StorageMapFile;

function put(files: Record<string, unknown>): void {
  h.files = createFakeFiles(files);
}

/** Zet de bestanden uit de storage-map ook echt in de nep-storage neer. */
function materializeStorage(map: StorageMapFile): void {
  for (const entry of Object.values(map.files)) deployment.putStorage(entry.storageId, entry.bytes);
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
// B-1c — verify gaat af op de transform-tellingen, niet op een herhaling
//        van de laadstap
// ────────────────────────────────────────────────────────────────────────
describe("verify: de verwachting komt uit de transform, niet uit de laadstap", () => {
  test("een deployment zonder foto's is niet groen, ook niet met een lege storage-map", async () => {
    // Exact het rampscenario uit de audit: `load-files` was niet gedraaid, de
    // map was leeg, en alles wat aan een foto hing viel weg. De deployment
    // bevat dan users, groepen en albums — maar nul foto's, nul albumfoto's,
    // nul likes. Als `verify` zijn verwachting uit diezelfde lege map afleidt,
    // meldt hij "verwacht 0, gevonden 0, ok" en is het verlies onzichtbaar.
    deployment.seed({
      ...records.meta.counts,
      photos: 0,
      albumPhotos: 0,
      ratings: 0,
    });
    put({
      "convex-records.json": records,
      "storage-map.json": { ...storageMap, files: {} },
    });
    expect(records.meta.counts.photos, "de fixture heeft foto's").toBeGreaterThan(0);

    await expect(verify("dev")).resolves.not.toBe(0);
  });

  test("een tabel met te weinig rijen is een bevinding, ook zonder storage in het spel", async () => {
    deployment.seed({ ...records.meta.counts, memberships: 0 });
    materializeStorage(storageMap);
    await expect(verify("dev")).resolves.not.toBe(0);
  });

  test("verify is groen als de deployment overeenkomt met wat de transform opleverde", async () => {
    await loadRecords("dev", false);
    materializeStorage(storageMap);
    await expect(verify("dev")).resolves.toBe(0);
  });

  test("een storage-object zonder record is een bevinding — dat is wat WP10 dagelijks meldt", async () => {
    await loadRecords("dev", false);
    materializeStorage(storageMap);
    deployment.putStorage("kg_wees");
    await expect(verify("dev")).resolves.not.toBe(0);
  });

  test("drift uit de WP10-scan maakt verify niet groen", async () => {
    await loadRecords("dev", false);
    materializeStorage(storageMap);
    deployment.setDrift(["users/abc: photoCount 3 ≠ 2 werkelijke foto's"]);
    await expect(verify("dev")).resolves.not.toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// B-2 — reset dekt dezelfde tabellen als de leeg-preconditie
// ────────────────────────────────────────────────────────────────────────
describe("reset", () => {
  test("na reset is elke tabel leeg die de leeg-preconditie van load-records telt", async () => {
    // Twee lijsten die uit elkaar kunnen lopen zijn een ontwerpfout. Blijft er
    // één tabel achter, dan weigert de volgende load-records ("niet leeg") of
    // — erger — hij slaagt en WP10 meldt de ochtend erna dangling FK's naar
    // verwijderde users.
    const seeded: Record<string, number> = {};
    for (const table of DEPLOYMENT_TABLES) seeded[table] = 3;
    deployment.seed(seeded);

    await expect(reset("dev", false, true)).resolves.toBe(0);

    for (const table of DEPLOYMENT_TABLES) {
      expect(deployment.count(table), `${table} is na reset niet leeg`).toBe(0);
    }
  });

  test("reset zonder --all laat de bestanden staan en de storage-map geldig", async () => {
    deployment.seed({ photos: 2 });
    materializeStorage(storageMap);
    const before = deployment.storageCount();
    await expect(reset("dev", false, true)).resolves.toBe(0);
    expect(deployment.storageCount()).toBe(before);
    expect(h.files.exists("storage-map.json")).toBe(true);
  });

  test("reset --all wist de storage én maakt de storage-map ongeldig", async () => {
    // Anders wijst een volgende load-records naar storage-ID's die niet meer
    // bestaan: een stille corruptie-route.
    materializeStorage(storageMap);
    await expect(reset("dev", true, true)).resolves.toBe(0);
    expect(deployment.storageCount()).toBe(0);
    expect(h.files.exists("storage-map.json")).toBe(false);
  });

  test("reset weigert zonder expliciete bevestiging", async () => {
    deployment.seed({ photos: 2 });
    await expect(reset("dev", false, false)).rejects.toThrow();
    expect(deployment.count("photos")).toBe(2);
  });
});
