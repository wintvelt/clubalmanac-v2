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
  captureConsole,
  type ConsoleCapture,
  createFakeDeployment,
  createFakeFiles,
  DEPLOYMENT_TABLES,
  storageKeyOf,
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

/**
 * Alles wat verify in DEZE test naar de terminal schreef. De afbakening per
 * test is geen detail: zonder haar leest elke assertie hieronder ook de output
 * van de tests ervoor (zie `captureConsole` in het harnas).
 */
let console_: ConsoleCapture;
const logged = (): string => console_.log();

/** Zet de bestanden uit de storage-map ook echt in de nep-storage neer. */
function materializeStorage(map: StorageMapFile): void {
  for (const entry of Object.values(map.files)) deployment.putStorage(entry.storageId, entry.bytes);
}

beforeEach(() => {
  console_ = captureConsole();
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

// ─────────────────────────────────────────────────────────────────────────
// R4-1 — aflezing aan de resultaatkant
//
// De gate van `load-records` is niet de laatste kans om verlies te zien; hij is
// de eerste. Wie hem opent met `--accept-missing-files` heeft daarna alleen nog
// `verify`, en die moet het verlies aan het resultaat kunnen aflezen en niet
// alleen aan de gate die de operator net zelf heeft opengezet.
//
// Het scherpste geval is de profielfoto, want die zit in geen enkele telling.
// Eén ontbrekende sleutel in `storage-map.json`, en de user landt zonder foto
// terwijl elke tabel exact het verwachte aantal rijen heeft, geen record naar
// een niet-bestaand bestand wijst en geen bestand zonder record in storage
// staat. Alles wat "twee kanten vergelijkt" is groen; alleen de vergelijking
// met de records zelf laat zien dat er iets weg is.
// ─────────────────────────────────────────────────────────────────────────
describe("verify: een user die zijn profielfoto kwijt is, is een bevinding", () => {
  test("ontbrekende profielfoto — élke telling klopt en verify is toch niet groen", async () => {
    const missingKey = storageKeyOf(records, "users", "U-alice");
    const alice = records.records.users.find((u) => u.sourceKey === "U-alice")!;
    expect(alice.profilePhotoStorageKey, "de fixture-user draagt een profielfoto").toBe(missingKey);

    // `load-files` heeft precies dit ene bestand niet geüpload.
    storageMap = buildStorageMap(records, { omit: [missingKey] });
    put({ "convex-records.json": records, "storage-map.json": storageMap });
    materializeStorage(storageMap);
    await expect(loadRecords("dev", true), "de accept-vlag laat de load slagen").resolves.toBe(0);

    // Premisse 1 — het verlies is echt: de rij droeg een sleutel, het document
    // in de deployment heeft geen foto.
    const loadedAlice = deployment.insertCalls.find(
      (call) => call.table === "users" && call.sourceKey === "U-alice",
    )!;
    expect(loadedAlice.doc.profilePhotoStorageId, "de user heeft zijn foto nog").toBeUndefined();
    const loadedBob = deployment.insertCalls.find(
      (call) => call.table === "users" && call.sourceKey === "U-bob",
    )!;
    expect(loadedBob.doc.profilePhotoStorageId, "de fixture verliest álle foto's").toBeDefined();

    // Premisse 2 — niets anders kan `verify` rood maken. Elke tabel telt exact
    // wat de transform beloofde, en de storage reconcilieert twee kanten op.
    for (const table of DEPLOYMENT_TABLES) {
      expect(deployment.count(table), `${table} telt niet zoals verwacht`).toBe(
        records.meta.counts[table] ?? 0,
      );
    }
    const referenced = new Set(
      deployment.insertCalls
        .flatMap((call) => [call.doc.storageId, call.doc.profilePhotoStorageId])
        .filter((id): id is string => typeof id === "string"),
    );
    for (const id of referenced) {
      expect(deployment.hasStorage(id), `record wijst naar een niet-bestaand bestand: ${id}`).toBe(
        true,
      );
    }
    for (const id of deployment.storageIds()) {
      expect(referenced.has(id), `storage-object zonder record: ${id}`).toBe(true);
    }

    // Vanaf hier alleen nog het rapport van verify zelf.
    console_ = captureConsole();

    await expect(verify("dev")).resolves.not.toBe(0);
    expect(logged(), "verify noemt het bestand niet dat niet geladen is").toContain(missingKey);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// R2-3 — verify telt élke tabel uit de bewaakte set, niet alleen de tabellen
//        die de import vult
// ─────────────────────────────────────────────────────────────────────────
describe("verify: de telling dekt de hele bewaakte set", () => {
  test("achtergebleven uploadIdempotency-rijen zijn een bevinding, geen blinde vlek", async () => {
    // Vóór de load telt deze tabel wel mee (de leeg-preconditie kijkt ernaar),
    // erna niet. Dat is precies de plek waar hij ertoe doet: zijn ownerId's
    // wijzen dan naar users die niet meer bestaan, en dat is wat WP10 de
    // ochtend erna meldt. "Verwacht 0" is ook een verwachting.
    await loadRecords("dev", false);
    materializeStorage(storageMap);
    deployment.seed({ uploadIdempotency: 2 });

    await expect(verify("dev")).resolves.not.toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// R2-5 — een bevinding waar de operator naar kan handelen
// ─────────────────────────────────────────────────────────────────────────
describe("verify: de orphan-bevinding is volledig", () => {
  test("elk object dat weg zou gaan wordt genoemd, niet een greep van tien", async () => {
    // Een sample van tien is genoeg om te alarmeren en te weinig om op te
    // beslissen. Wie de opruiming gaat draaien moet vooraf kunnen zien wat er
    // precies weggaat — anders is "geen storage-orphans" een eis waar je
    // blind aan voldoet.
    await loadRecords("dev", false);
    materializeStorage(storageMap);
    const orphans = Array.from({ length: 12 }, (_, i) => `kg_wees${i}`);
    for (const id of orphans) deployment.putStorage(id);

    await expect(verify("dev")).resolves.not.toBe(0);

    const report = logged();
    for (const id of orphans) {
      expect(report, `${id} staat niet in het rapport`).toContain(id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Het harnas zelf — nagekomen defect uit fix-cyclus 3
//
// De test hierboven laat `verify` een volledig rapport afdrukken, inclusief het
// opruim-advies. Lekt die output door naar de volgende test, dan slaagt geen
// enkele `not.toContain` in dit bestand nog op eigen kracht en kan elke
// `toContain` slagen op de output van een test die iets heel anders deed. Deze
// test staat hier bewust ná de luidruchtigste: hij valt om zodra de afbakening
// per test verdwijnt.
// ─────────────────────────────────────────────────────────────────────────
describe("harnas: een test leest alleen zijn eigen terminal-output", () => {
  test("de vorige test heeft hier niets achtergelaten", () => {
    expect(logged(), "terminal-output van een eerdere test lekt door").toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// R3-4 — een advies volgt alleen uit een controle die klopt
//
// `verify` toonde de opruim-instructie zodra er storage-objecten zonder record
// waren, ongeacht de rest van zijn eigen rapport. Tussen T-2 en T-0 is dat de
// normale toestand: de bestanden staan er, de records nog niet, dus élk object
// is een "wees". Wie die instructie dan opvolgt, gooit de complete upload weg.
//
// Een handelingsadvies uit `verify` gaat over de toestand die `verify` heeft
// vastgesteld. Volgt het uit één deel-bevinding terwijl een ander deel rood is,
// dan is het een instructie om de fout te vergroten.
// ─────────────────────────────────────────────────────────────────────────
describe("verify: het advies past bij de toestand", () => {
  test("tussen T-2 en T-0 adviseert verify geen opruiming", async () => {
    // De bestanden staan er, de deployment is leeg. Elk object hangt aan geen
    // record en elk bestand is nog nodig.
    materializeStorage(storageMap);
    expect(records.meta.counts.photos, "de fixture heeft foto's").toBeGreaterThan(0);

    await expect(verify("dev")).resolves.not.toBe(0);

    const report = logged();
    expect(report, "verify stuurt de operator naar het commando dat de upload wist").not.toContain(
      "prune-storage",
    );
    expect(report, "verify zegt niet wat er dan wél moet gebeuren").toContain("load-records");
  });

  test("kloppen de rij-aantallen, dan is de wees wél op te ruimen", async () => {
    // De andere tak van dezelfde regel: op T-0, met alles geladen, is een
    // object zonder record een echte wees en hoort de operator te weten met
    // welk commando hij hem weghaalt.
    await loadRecords("dev", false);
    materializeStorage(storageMap);
    deployment.putStorage("kg_wees");

    await expect(verify("dev")).resolves.not.toBe(0);

    expect(logged()).toContain("prune-storage");
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
