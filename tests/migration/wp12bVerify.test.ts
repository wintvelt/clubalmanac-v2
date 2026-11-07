// WP12b invariant 6 — RED tests: `verify` vangt een ontbrekende cover.
//
// Het albumcover-gat bleef onzichtbaar omdat `verify` rijen telt, storage
// reconcilieert en de WP10-scan draait — en geen van drie kijkt of een veld
// gevuld is. Een album zonder cover telt als album.
//
// De verwachting komt uit de BRON (`dynamo-extract.json`), niet uit
// `convex-records.json`. Dat is het hele punt: het gat zat in de transform zelf.
// Een verify die "records zeggen geen cover, deployment heeft geen cover"
// vergelijkt, was ook toen groen geweest (ab-audit-workflow: een controle leidt
// zijn verwachting niet af uit de gecontroleerde stap).
//
// "Resolvet" betekent hier: de cover-foto staat in de bron én wordt geladen (hij
// staat in de foto's van convex-records.json). Een cover naar een foto die niet
// bestaat of buiten de dev-seed valt, wordt door de transform gewist en gemeld,
// en is voor verify geen bevinding — anders is dev nooit groen.
//
// De deployment kent geen bron-sleutels; verify vraagt hem alleen hoeveel
// groepen en albums een cover hebben (`internal.migration.coverCounts`).

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FakeDeployment } from "./_harness";
import {
  buildExtractFile,
  buildRecordsFile,
  buildStorageMap,
  captureConsole,
  type ConsoleCapture,
  createFakeDeployment,
  createFakeFiles,
} from "./_harness";
import { buildExtractWithCovers } from "./fixture";
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
const { loadRecords } = await import("../../scripts/migrate/loadRecords.ts");

let deployment: FakeDeployment;
let records: RecordsFile;
let storageMap: StorageMapFile;
let console_: ConsoleCapture;

const EXTRACT = "dynamo-extract.json";
const said = (): string => `${console_.log()}\n${console_.error()}`;

function put(files: Record<string, unknown>): void {
  h.files = createFakeFiles(files);
}

function materializeStorage(map: StorageMapFile): void {
  for (const entry of Object.values(map.files)) deployment.putStorage(entry.storageId, entry.bytes);
}

/** De deployment-rij die bij een bron-sleutel hoort, via wat load-records insertte. */
function loadedDoc(table: "groups" | "albums", sourceKey: string) {
  const index = deployment.insertCalls
    .filter((call) => call.table === table)
    .findIndex((call) => call.sourceKey === sourceKey);
  const doc = deployment.docs(table)[index];
  if (index < 0 || doc === undefined) throw new Error(`niet geladen: ${table}/${sourceKey}`);
  return doc;
}

beforeEach(() => {
  console_ = captureConsole();
  deployment = createFakeDeployment();
  h.deployment = deployment;
  records = buildRecordsFile("dev", buildExtractWithCovers());
  storageMap = buildStorageMap(records);
  put({
    [EXTRACT]: buildExtractFile(buildExtractWithCovers()),
    "convex-records.json": records,
    "storage-map.json": storageMap,
  });
  materializeStorage(storageMap);
});

describe("WP12b invariant 6: verify vangt een ontbrekende cover", () => {
  test("alles geladen zoals de bron het heeft: groen", async () => {
    // Premisse: de bron heeft covers die resolven én covers die dat niet doen
    // (A-3 naar een niet-bestaande foto, A-4 en G-3 naar een foto buiten de
    // dev-seed). Alleen de eerste soort hoort er te zijn.
    await loadRecords("dev", false);
    await expect(verify("dev")).resolves.toBe(0);
  });

  test("een albumcover die in de deployment ontbreekt is een bevinding", async () => {
    await loadRecords("dev", false);
    const album = loadedDoc("albums", "A-1");
    // Premisse: de transform leverde hem wél (anders test dit de transform).
    expect(album.coverPhotoId, "A-1 is zonder cover geladen").toBeDefined();
    album.coverPhotoId = undefined;

    console_ = captureConsole();
    await expect(verify("dev")).resolves.not.toBe(0);
    expect(said()).toMatch(/cover/i);
    expect(said()).toMatch(/album/i);
  });

  test("een groepscover die in de deployment ontbreekt is een bevinding", async () => {
    await loadRecords("dev", false);
    const group = loadedDoc("groups", "G-1");
    expect(group.coverPhotoId, "G-1 is zonder cover geladen").toBeDefined();
    group.coverPhotoId = undefined;

    console_ = captureConsole();
    await expect(verify("dev")).resolves.not.toBe(0);
    expect(said()).toMatch(/cover/i);
  });

  test("het oorspronkelijke gat: de transform liet de albumcovers vallen", async () => {
    // Precies wat er op 2026-11-07 gebeurde. De records zeggen "geen cover", de
    // deployment heeft er geen, en elke telling klopt. Alleen de bron weet beter.
    const zonderCovers: RecordsFile = {
      ...records,
      records: {
        ...records.records,
        albums: records.records.albums.map((album) => ({ ...album, coverPhotoId: undefined })),
      },
    };
    put({
      [EXTRACT]: buildExtractFile(buildExtractWithCovers()),
      "convex-records.json": zonderCovers,
      "storage-map.json": storageMap,
    });
    await loadRecords("dev", false);

    console_ = captureConsole();
    await expect(verify("dev")).resolves.not.toBe(0);
    expect(said()).toMatch(/cover/i);
  });

  test("zonder extract kan verify de covers niet controleren, en is hij niet groen", async () => {
    await loadRecords("dev", false);
    put({ "convex-records.json": records, "storage-map.json": storageMap });

    console_ = captureConsole();
    await expect(verify("dev")).resolves.not.toBe(0);
    expect(said()).toContain(EXTRACT);
  });
});
