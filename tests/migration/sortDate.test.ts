import { describe, expect, test } from "vitest";
import { transform } from "../../scripts/migrate/transform";
import { buildExtract, CHOSEN, day, DEV_SUBJECTS, PROD_SUBJECTS } from "./fixture";

// WP16 besluit 3: de gekozen datum van een groep of album (`sortDate` in v1)
// gaat mee. In v1 zette een admin hem via "Groep bewerken" of "Album
// bewerken", als kalenderdag `YYYY-MM-DD`. De oude backend sorteerde erop en
// toonde er het jaar van, met `createdAt` als terugval. Spec: WP16 §sortDate.
//
// Zelfde regel als `createdAt` (WP12 correctie 1): een kalenderdag wordt
// epoch-ms op UTC-middernacht van die dag. Geen bron, dan geen veld: de app
// valt zelf terug op `createdAt`, de transform vult niets in.

const NOW = day("2026-08-23");
const prodConfig = {
  target: "prod" as const,
  chosenUserIds: null,
  anonymize: false,
  subjectByUserId: PROD_SUBJECTS,
  defaultPhotoLimit: 1000,
  now: NOW,
};
const devConfig = {
  target: "dev" as const,
  chosenUserIds: CHOSEN,
  anonymize: true,
  subjectByUserId: DEV_SUBJECTS,
  defaultPhotoLimit: 1000,
  now: NOW,
};

type Item = Record<string, unknown>;
type Row = Record<string, any>;

// Het fixture-extract met `sortDate` op één bron-item.
function withSortDate(pk: string, sk: string, sortDate: unknown): Item[] {
  return buildExtract().map((i: Item) => (i.PK === pk && i.SK === sk ? { ...i, sortDate } : i));
}

const bySource = (rows: Row[], key: string): Row => {
  const found = rows.filter((r) => r.sourceKey === key);
  expect(found, `geen unieke rij met sourceKey ${key}`).toHaveLength(1);
  return found[0]!;
};

describe("groups.sortDate", () => {
  test("een kalenderdag wordt epoch-ms op UTC-middernacht van die dag", () => {
    const { records } = transform(withSortDate("GBbase", "G-1", "2015-06-01"), prodConfig);
    expect(bySource(records.groups, "G-1").sortDate).toBe(day("2015-06-01"));
  });

  test("createdAt blijft de eigen aanmaakdatum", () => {
    const { records } = transform(withSortDate("GBbase", "G-1", "2015-06-01"), prodConfig);
    expect(bySource(records.groups, "G-1").createdAt).toBe(day("2021-04-01"));
  });

  test("zonder sortDate in de bron: leeg (geen kopie van createdAt)", () => {
    const { records } = transform(buildExtract(), prodConfig);
    expect(bySource(records.groups, "G-1").sortDate).toBeUndefined();
  });

  test("ook in de dev-run", () => {
    const { records } = transform(withSortDate("GBbase", "G-1", "2015-06-01"), devConfig);
    expect(bySource(records.groups, "G-1").sortDate).toBe(day("2015-06-01"));
  });
});

describe("albums.sortDate", () => {
  test("een kalenderdag wordt epoch-ms op UTC-middernacht van die dag", () => {
    const { records } = transform(withSortDate("GAG-1", "A-1", "2012-12-31"), prodConfig);
    expect(bySource(records.albums, "A-1").sortDate).toBe(day("2012-12-31"));
    expect(bySource(records.albums, "A-1").createdAt).toBe(day("2021-04-05"));
  });

  test("zonder sortDate in de bron: geen veld", () => {
    const { records } = transform(buildExtract(), prodConfig);
    expect(bySource(records.albums, "A-1").sortDate).toBeUndefined();
  });

  test("lege string is 'leeg', geen datum (WP12 correctie 6)", () => {
    const { records } = transform(withSortDate("GAG-1", "A-1", ""), prodConfig);
    expect(bySource(records.albums, "A-1").sortDate).toBeUndefined();
  });
});

describe("een onbruikbare sortDate", () => {
  test.each([["onzin"], ["2015-13-45"], [12345], [{ S: "2015-06-01" }]])(
    "%s: geen veld, wel een waarschuwing met het bron-id, en de run gaat door",
    (bad) => {
      const { records, warnings } = transform(withSortDate("GAG-1", "A-1", bad), prodConfig);
      expect(bySource(records.albums, "A-1").sortDate).toBeUndefined();
      expect(warnings.some((w: string) => /A-1/.test(w) && /sortDate/.test(w))).toBe(true);
    },
  );

  test("ook voor een groep", () => {
    const { records, warnings } = transform(withSortDate("GBbase", "G-2", "onzin"), prodConfig);
    expect(bySource(records.groups, "G-2").sortDate).toBeUndefined();
    expect(warnings.some((w: string) => /G-2/.test(w) && /sortDate/.test(w))).toBe(true);
  });
});
