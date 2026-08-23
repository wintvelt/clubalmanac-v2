// WP12 fix-cyclus 2 — RED tests rond `load-files`.
//
// Twee bevindingen komen hier samen, en allebei gaan ze over het net en niet
// over de vangst:
//
//   R2-1. De gate van `load-records`, de verwachting van `verify` én de
//   storage-map van de fixture kwamen alle drie uit `referencedStorageKeys`.
//   Een blinde vlek in die functie is daarmee voor de hele suite onzichtbaar:
//   de auditor haalde het profielfoto-blok eruit en zag 103/103 groen, terwijl
//   twee profielfoto's spoorloos verdwenen. Het harnas bouwt zijn map nu uit de
//   handmatige oracle in `fixture.ts`; hier wordt de functie zelf tegen diezelfde
//   oracle gepind.
//
//   R2-2. `readStorageMap` heeft twee takken die tegengesteld horen te werken —
//   `load-files` mag een ontbrekende map verzinnen, `load-records` moet er op
//   afketsen. Alleen de tweede lag vast. Zonder de eerste breekt de allereerste
//   prod-run op T-2 met "storage-map.json bestaat niet" zonder dat één test
//   daarvan wakker wordt.
//
// Geen enkele test raakt `scripts/.data/` of S3: de bestandslaag is vervangen.

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  EXPECTED_PHOTO_KEYS,
  EXPECTED_PROFILE_PHOTO_KEYS,
  EXPECTED_STORAGE_KEYS,
} from "./fixture";
import { buildRecordsFile, createFakeFiles, FAKE_DEV_URL } from "./_harness";

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

const { readStorageMap, referencedStorageKeys } = await import(
  "../../scripts/migrate/loadFiles.ts"
);

beforeEach(() => {
  h.files = createFakeFiles({});
});

// ────────────────────────────────────────────────────────────────────────
// R2-1 — de te uploaden set tegen een met de hand opgeschreven verwachting
// ────────────────────────────────────────────────────────────────────────
describe("de te uploaden bestandsset", () => {
  test("is exact de handmatig opgesomde set — prod", () => {
    // De oracle staat in fixture.ts en is uit de bron-items overgeschreven,
    // niet uit deze functie afgeleid. Vergeet de functie een categorie, dan
    // valt deze test om in plaats van dat er stilletjes minder geüpload wordt.
    expect(referencedStorageKeys(buildRecordsFile("prod"))).toEqual([
      ...EXPECTED_STORAGE_KEYS.prod,
    ]);
  });

  test("is exact de handmatig opgesomde set — dev", () => {
    expect(referencedStorageKeys(buildRecordsFile("dev"))).toEqual([
      ...EXPECTED_STORAGE_KEYS.dev,
    ]);
  });

  test("bevat élke foto", () => {
    const keys = referencedStorageKeys(buildRecordsFile("prod"));
    for (const key of EXPECTED_PHOTO_KEYS.prod) expect(keys).toContain(key);
  });

  test("bevat élke profielfoto — de categorie die in geen enkele telling zit", () => {
    // Dit is de categorie die in de wegwerp-kopie van de auditor wegviel: een
    // profielfoto heeft geen eigen tabel, verandert geen rij-aantal, en zou dus
    // ook door `verify` niet opgemerkt worden.
    const keys = referencedStorageKeys(buildRecordsFile("prod"));
    for (const key of EXPECTED_PROFILE_PHOTO_KEYS.prod) expect(keys).toContain(key);
  });

  test("noemt een gedeeld bestand één keer — twee users, één storage-object", () => {
    const keys = referencedStorageKeys(buildRecordsFile("prod"));
    expect(new Set(keys).size, "dubbele sleutels in de upload-lijst").toBe(keys.length);
  });

  test("laat de lege-string-sentinel buiten de lijst", () => {
    // Carol heeft haar profielfoto gewist; `updateUser.js` schrijft daarvoor een
    // lege string. Die mag nooit als S3-sleutel opgehaald worden.
    const keys = referencedStorageKeys(buildRecordsFile("prod"));
    expect(keys.every((key) => key.length > 0)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// R2-2 — de andere helft van de B-1-invariant
// ────────────────────────────────────────────────────────────────────────
describe("readStorageMap: één regel, twee takken", () => {
  test("load-files begint op een lege werkmap gewoon met nul bekende bestanden", () => {
    // De allereerste prod-run op T-2 draait op een lege `.data`-map. Ketst
    // `load-files` daarop af, dan komt de gefaseerde run niet eens van de grond.
    const map = readStorageMap("prod", FAKE_DEV_URL, { allowMissing: true });
    expect(map.files).toEqual({});
    expect(map.meta.target).toBe("prod");
    expect(map.meta.convexUrl).toBe(FAKE_DEV_URL);
  });

  test("load-records ketst op diezelfde lege werkmap wél af", () => {
    expect(() => readStorageMap("prod", FAKE_DEV_URL, { allowMissing: false })).toThrow();
  });

  test("een map van een andere deployment wordt geweigerd, ook met allowMissing", () => {
    // Storage-ID's zijn per deployment. Hergebruik zou naar niet-bestaande
    // bestanden wijzen — en dat is precies de stille corruptie-route.
    const records = buildRecordsFile("dev");
    h.files = createFakeFiles({
      "storage-map.json": {
        meta: { target: "prod", convexUrl: FAKE_DEV_URL, updatedAt: "" },
        files: {},
      },
    });
    expect(() => readStorageMap("dev", FAKE_DEV_URL, { allowMissing: true })).toThrow();
    expect(records.meta.target).toBe("dev");
  });

  test("een map van een andere Convex-URL wordt geweigerd", () => {
    h.files = createFakeFiles({
      "storage-map.json": {
        meta: { target: "dev", convexUrl: "https://andere.convex.cloud", updatedAt: "" },
        files: {},
      },
    });
    expect(() => readStorageMap("dev", FAKE_DEV_URL, { allowMissing: true })).toThrow();
  });
});
