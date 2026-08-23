// WP12 fix-cyclus 2 (R2-5) + fix-cyclus 3 (R3-1, R3-2, R3-5) — tests op de
// orphan-route tussen T-2 en T-0.
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
// alles.
//
// Fix-cyclus 3 (R3-1/R3-2) heeft de bescherming uit elkaar getrokken, omdat de
// tekst één ding beloofde en de code via een ander mechanisme beschermde. Het
// zijn er drie, en ze staan hieronder alle drie apart gepind:
//   1. de toestandscontrole — beschrijft `convex-records.json` de deployment
//      die er nu staat?
//   2. de vloer — `prune-storage` wist nooit alles, ongeacht wat die
//      vergelijking zegt; in de nul-toestand is ze namelijk triviaal waar;
//   3. de per-object-bescherming — wat de huidige `convex-records.json` nog
//      nodig heeft blijft staan, zodat dat bestand laadbaar blijft.

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
import { TABLE_ORDER, type Records, type Row } from "../../scripts/migrate/types";

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
const { reset } = await import("../../scripts/migrate/reset.ts");

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

/** De sleutels in de storage-map, om te kunnen zien dat er niets uit verdween. */
const mapKeys = (): string[] =>
  Object.keys((h.files.read("storage-map.json") as StorageMapFile).files).sort();

/**
 * Een `convex-records.json` zonder één rij, met alle tellingen op nul — precies
 * wat een `extract` tegen de verkeerde DynamoDB-tabel oplevert. `transform`,
 * `load-records` en `verify` slagen daar allemaal op: nul verwacht, nul
 * gevonden. Dat is de toestand waarin elke vergelijking triviaal waar is.
 */
function emptyRecordsFile(): RecordsFile {
  const leeg = {} as Records;
  const counts: Record<string, number> = {};
  for (const table of TABLE_ORDER) {
    leeg[table] = [];
    counts[table] = 0;
  }
  return { ...records, meta: { ...records.meta, counts }, records: leeg };
}

/**
 * Dezelfde records, maar zonder één verwijzing naar een bestand. De rijen — en
 * dus de tellingen — blijven exact gelijk.
 */
function recordsWithoutStorageRefs(): RecordsFile {
  const strip = (rows: Row[], field: string): Row[] =>
    rows.map((row) => {
      const copy = { ...row };
      delete copy[field];
      return copy;
    });
  return {
    ...records,
    records: {
      ...records.records,
      photos: strip(records.records.photos, "storageKey"),
      users: strip(records.records.users, "profilePhotoStorageKey"),
    },
  };
}

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
    //
    // De exitcode is sinds fix-cyclus 3 (R3-5) niet-nul: dit is een weigering,
    // geen geslaagde opruiming. Op cutover-dag lopen deze commando's in een
    // keten en leest de operator de uitkomst uit de exitcode.
    materializeStorage(storageMap);
    const before = deployment.storageCount();
    expect(before).toBeGreaterThan(0);

    await expect(pruneStorage("dev", true)).resolves.not.toBe(0);

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

// ─────────────────────────────────────────────────────────────────────────
// R3-1 — een vloer die niet van de tellingen afhangt
//
// De veiligheidsklep uit fix-cyclus 2 deed het werk niet: de bescherming zat in
// de vergelijking tussen `meta.counts` en de deployment, en die is triviaal waar
// zodra beide kanten nul zijn. De route ernaartoe loopt door de tool zelf — de
// brontabel is een env-var, er bestaat een tweede AWS-omgeving die we bewust
// negeren, en een `extract` daartegen levert nul items. Op nul items slagen
// `transform`, `load-records` én `verify`.
//
// `prune-storage` wist daarom nooit alles. Alles wissen heet `reset --all`:
// een ander commando, een andere bedoeling, een andere bevestiging.
// ─────────────────────────────────────────────────────────────────────────
describe("prune-storage: de vloer", () => {
  test("een lege convex-records.json wist niets — ook niet als de deployment net zo leeg is", async () => {
    // De reproductie uit de audit: zes objecten geüpload, nul rijen, nul
    // tellingen, deployment leeg. Alles klopt met alles, en er staat 5,6 GB op
    // het spel.
    materializeStorage(storageMap);
    const before = deployment.storageCount();
    const keysBefore = mapKeys();
    put({ "convex-records.json": emptyRecordsFile(), "storage-map.json": storageMap });

    await expect(pruneStorage("dev", true)).resolves.not.toBe(0);

    expect(deployment.storageCount(), "de upload is weg").toBe(before);
    expect(mapKeys(), "de storage-map is leeggehaald — de hervatbaarheid ook").toEqual(keysBefore);
  });

  test("geen enkel record dat naar storage verwijst, terwijl de map vol is", async () => {
    // Tellingen die kloppen zijn hier geen bewijs: de rijen staan er, ze
    // verwijzen alleen nergens naar. Een storage-map vol bestanden en een
    // records-bestand dat er geen enkel nodig heeft is geen opruimopdracht maar
    // een tegenspraak, en die los je niet op door 5,6 GB weg te gooien.
    materializeStorage(storageMap);
    const before = deployment.storageCount();
    deployment.seed(records.meta.counts);
    put({ "convex-records.json": recordsWithoutStorageRefs(), "storage-map.json": storageMap });

    await expect(pruneStorage("dev", true)).resolves.not.toBe(0);

    expect(deployment.storageCount()).toBe(before);
    expect(mapKeys()).toHaveLength(Object.keys(storageMap.files).length);
  });

  test("wist nooit élk object dat er staat", async () => {
    // De storage bevat uitsluitend objecten die niemand nodig heeft, en alles
    // wat de records wél nodig hebben ontbreekt. Wat er ook misging — dit is
    // geen opruiming meer maar een leegmaak-actie, en daar is een ander
    // commando voor.
    deployment.seed(records.meta.counts);
    deployment.putStorage(idOf(DELETED_SINCE_T2));

    await expect(pruneStorage("dev", true)).resolves.not.toBe(0);

    expect(deployment.storageCount(), "de enige inhoud van de storage is weg").toBe(1);
  });

  test("nul objecten om op te ruimen blijft gewoon groen", async () => {
    // De vloer mag de normale uitkomst niet omdraaien: niets te doen is een
    // geslaagde run, geen weigering.
    storageMap = buildStorageMap(records);
    put({ "convex-records.json": records, "storage-map.json": storageMap });
    materializeStorage(storageMap);
    await loadRecords("dev", false);

    await expect(pruneStorage("dev", true)).resolves.toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// R3-2 — de tweede voorwaarde doet eigen, aflezend werk
//
// Ná de toestandscontrole hing elk beschermd object per definitie aan een
// geladen record: de bescherming was onbereikbaar en daarmee niet van een
// niet-bestaande bescherming te onderscheiden. Haar eigen betekenis: de huidige
// `convex-records.json` blijft laadbaar. Dat bestand is de terugvaloptie van de
// operator — `reset` plus `load-records` moet erna nog kunnen slagen.
//
// De toestand tussen laden en opruimen is niet bevroren. Zodra de app draait
// kan een foto van bestand wisselen (de rotatie uit WP8 schrijft een nieuw
// object en laat het oude achter): het oude object hangt dan aan geen record
// meer, terwijl de rij-aantallen ongewijzigd blijven.
// ─────────────────────────────────────────────────────────────────────────
describe("prune-storage: wat convex-records.json nog nodig heeft blijft staan", () => {
  /** Simuleert een rotatie ná de load: de foto wijst naar een nieuw bestand. */
  async function rotateFirstPhoto(): Promise<{ oud: string; nieuw: string }> {
    const photo = deployment.docs("photos")[0]!;
    const oud = String(photo.storageId);
    const nieuw = "kg_geroteerd";
    deployment.putStorage(nieuw);
    photo.storageId = nieuw;
    return { oud, nieuw };
  }

  test("een object waar de records nog naar wijzen blijft, ook zonder geladen record", async () => {
    materializeStorage(storageMap);
    await loadRecords("dev", false);
    const { oud } = await rotateFirstPhoto();
    // Vóór de opruiming aflezen: het commando haalt de entry uit de map.
    const wees = idOf(DELETED_SINCE_T2);

    await expect(pruneStorage("dev", true)).resolves.toBe(0);

    expect(deployment.hasStorage(oud), "het bestand dat de records nog nodig hebben is weg").toBe(
      true,
    );
    expect(deployment.hasStorage(wees), "de echte wees is blijven staan").toBe(false);
  });

  test("na de opruiming is convex-records.json nog steeds laadbaar", async () => {
    // De aflezing die ertoe doet: de terugvalroute van de operator werkt nog.
    // Reset laat de bestanden staan, en load-records moet daarna slagen zonder
    // dat er ook maar één bestand geaccepteerd verlies is.
    materializeStorage(storageMap);
    await loadRecords("dev", false);
    await rotateFirstPhoto();
    await pruneStorage("dev", true);

    await expect(reset("dev", false, true)).resolves.toBe(0);
    await expect(loadRecords("dev", false)).resolves.toBe(0);
    for (const photo of deployment.docs("photos")) {
      expect(
        deployment.hasStorage(String(photo.storageId)),
        `foto ${photo.sourceKey} verwijst naar een bestand dat niet meer bestaat`,
      ).toBe(true);
    }
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
