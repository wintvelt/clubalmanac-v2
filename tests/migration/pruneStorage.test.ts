// WP12 fix-cyclus 2 (R2-5) — RED tests op de orphan-route tussen T-2 en T-0.
//
// Het gefaseerde ontwerp zet de bestanden twee weken vóór de cutover in
// Convex-storage. Wordt in die twee weken een foto in de oude app verwijderd,
// dan staat het bestand op T-0 in de storage zonder record. `verify` meldt dat
// terecht, het runbook eist "geen storage-orphans" — en er was geen knop die
// alleen die objecten weghaalt. `reset --all` gooit de hele upload weg, en dat
// is precies de tijd die het gefaseerde ontwerp moest sparen.
//
// De gevaarlijkste kant van deze opruiming zit in de andere richting. Tussen
// T-2 en T-0 staat de deployment leeg terwijl élk bestand nog nodig is; een
// opruiming die alleen "hangt er een record aan?" vraagt, wist daar in één keer
// alles. Vandaar twee voorwaarden: geen geladen record én geen verwijzing uit
// de huidige `convex-records.json`.

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FakeDeployment } from "./_harness";
import {
  buildRecordsFile,
  buildStorageMap,
  createFakeDeployment,
  createFakeFiles,
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

const { pruneStorage } = await import("../../scripts/migrate/pruneStorage.ts");
const { loadRecords } = await import("../../scripts/migrate/loadRecords.ts");
const { verify } = await import("../../scripts/migrate/verify.ts");

/** De foto die tussen T-2 en T-0 in de oude app verwijderd werd. */
const DELETED_SINCE_T2 = "protected/U-alice-sub/verwijderd.jpg";

let deployment: FakeDeployment;
let records: RecordsFile;
let storageMap: StorageMapFile;

function put(files: Record<string, unknown>): void {
  h.files = createFakeFiles(files);
}

function materializeStorage(map: StorageMapFile): void {
  for (const entry of Object.values(map.files)) deployment.putStorage(entry.storageId, entry.bytes);
}

const idOf = (key: string): string => storageMap.files[key]!.storageId;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deployment = createFakeDeployment();
  h.deployment = deployment;
  records = buildRecordsFile("dev");
  // De map van T-2: alles wat de records nodig hebben, plus één bestand
  // waarvan het record inmiddels verdwenen is.
  storageMap = buildStorageMap(records, { extra: [DELETED_SINCE_T2] });
  put({ "convex-records.json": records, "storage-map.json": storageMap });
});

describe("prune-storage: alleen wat niemand meer nodig heeft", () => {
  test("tussen T-2 en T-0 — een lege deployment betekent niet dat alles weg mag", async () => {
    // De situatie waarin dit commando het meeste schade kan aanrichten: de
    // bestanden staan er al, de records nog niet. Elk object is dan "orphan"
    // in de deployment, en toch is er niets weg te gooien.
    materializeStorage(storageMap);
    const before = deployment.storageCount();
    expect(before).toBeGreaterThan(0);

    await expect(pruneStorage("dev", true)).resolves.toBe(0);

    expect(deployment.storageCount(), "de upload van T-2 is weggegooid").toBe(before);
  });

  test("op T-0 gaat exact het object weg waarvan het record verdween", async () => {
    materializeStorage(storageMap);
    await loadRecords("dev", false);
    const doomed = idOf(DELETED_SINCE_T2);
    const before = deployment.storageCount();

    await expect(pruneStorage("dev", true)).resolves.toBe(0);

    expect(deployment.hasStorage(doomed), "het weesobject staat er nog").toBe(false);
    expect(deployment.storageCount(), "er is meer weg dan de wees").toBe(before - 1);
  });

  test("geen enkel object waar een record naar wijst gaat weg", async () => {
    materializeStorage(storageMap);
    await loadRecords("dev", false);

    await expect(pruneStorage("dev", true)).resolves.toBe(0);

    for (const photo of deployment.docs("photos")) {
      expect(deployment.hasStorage(String(photo.storageId)), "foto-bestand weg").toBe(true);
    }
    for (const user of deployment.docs("users")) {
      if (user.profilePhotoStorageId === undefined) continue;
      expect(
        deployment.hasStorage(String(user.profilePhotoStorageId)),
        "profielfoto-bestand weg",
      ).toBe(true);
    }
  });

  test("een object dat in geen enkele lijst voorkomt gaat ook weg", async () => {
    // Een upload die halverwege een afgebroken run is blijven hangen: niet in
    // de map, niet in de records, aan geen record gekoppeld.
    materializeStorage(storageMap);
    await loadRecords("dev", false);
    deployment.putStorage("kg_rommel");

    await expect(pruneStorage("dev", true)).resolves.toBe(0);
    expect(deployment.hasStorage("kg_rommel")).toBe(false);
  });

  test("na afloop wijst geen enkele entry in de storage-map naar een gewist object", async () => {
    // Anders is dit dezelfde stille corruptie-route die `reset --all` met een
    // blijvende map zou zijn: een volgende load verwijst naar een bestand dat
    // niet meer bestaat.
    materializeStorage(storageMap);
    await loadRecords("dev", false);
    await expect(pruneStorage("dev", true)).resolves.toBe(0);

    const map = h.files.read("storage-map.json") as StorageMapFile;
    for (const [key, entry] of Object.entries(map.files)) {
      expect(deployment.hasStorage(entry.storageId), `map wijst naar een weg object: ${key}`).toBe(
        true,
      );
    }
    expect(Object.keys(map.files)).not.toContain(DELETED_SINCE_T2);
  });

  test("verify is erna groen — de bevinding is opgelost, niet weggekeken", async () => {
    materializeStorage(storageMap);
    await loadRecords("dev", false);
    await expect(verify("dev"), "de wees hoort vóór het opruimen een bevinding te zijn").resolves.not.toBe(0);

    await pruneStorage("dev", true);

    await expect(verify("dev")).resolves.toBe(0);
  });
});

describe("prune-storage: even destructief als reset, dus dezelfde discipline", () => {
  test("weigert zonder expliciete bevestiging, en wist niets", async () => {
    materializeStorage(storageMap);
    await loadRecords("dev", false);
    const before = deployment.storageCount();

    await expect(pruneStorage("dev", false)).rejects.toThrow();
    expect(deployment.storageCount()).toBe(before);
  });

  test("weigert zonder convex-records.json — zonder die lijst is elke opruiming een gok", async () => {
    materializeStorage(storageMap);
    put({ "storage-map.json": storageMap });

    await expect(pruneStorage("dev", true)).rejects.toThrow();
    expect(deployment.storageCount()).toBeGreaterThan(0);
  });

  test("weigert zonder storage-map.json", async () => {
    // Zonder de map is niet uit te maken welk object bij welke bron-sleutel
    // hoort, en dus ook niet wat beschermd moet blijven.
    materializeStorage(storageMap);
    put({ "convex-records.json": records });

    await expect(pruneStorage("dev", true)).rejects.toThrow();
    expect(deployment.storageCount()).toBeGreaterThan(0);
  });
});
