// WP12b fix-cyclus 1 — RED tests na de audit (spec §Fix-cyclus 1).
//
// F1  Een gemelde foto met een verlopen verwijderdatum stopt de transform,
//     tenzij de operator het verlies accepteert. v1 wiste zo'n foto nooit; de
//     FL1-cron van v2 wist hem de eerste nacht na T0. De oude T0-check hing aan
//     een script buiten de repo en kon dus stil wegvallen.
// F2  Een groepscover die alleen in een album van een andere groep staat krijgt
//     een eigen melding, die die groep noemt.
// F3  De twee albumcover-meldingen ("ander album van de groep", "geen album")
//     blijven verschillend.

import { describe, expect, test } from "vitest";
import { transform, type TransformConfig } from "../../scripts/migrate/transform";
import type { Row } from "../../scripts/migrate/types";
import { buildExtractWithCovers, CHOSEN, DEV_SUBJECTS, PROD_SUBJECTS, type SourceItem } from "./fixture";

// Referentie-"nu" van de transform: 2026-08-23, UTC-middernacht.
const NOW = Date.parse("2026-08-23T00:00:00.000Z");

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

/** Dezelfde config, met het verlies van verlopen meldingen geaccepteerd. */
const accepting = (config: TransformConfig): TransformConfig =>
  Object.assign({}, config, { acceptExpiredFlags: true });

const row = (rows: Row[], sourceKey: string): Row => {
  const found = rows.find((r) => r.sourceKey === sourceKey);
  if (found === undefined) throw new Error(`geen rij ${sourceKey}`);
  return found;
};

/** Zet een melding op een foto uit de fixture. */
function withFlag(photoKey: string, deleteDate: string): SourceItem[] {
  return buildExtractWithCovers().map((item) =>
    item.PK === `PO${photoKey}`
      ? { ...item, flaggedDate: "2026-07-01", flaggedBy: "U-carol", flagged: "flagged", flaggedDeleteDate: deleteDate }
      : item,
  );
}

// ── F1 ────────────────────────────────────────────────────────────────

describe("WP12b F1: een verlopen verwijderdatum stopt de transform", () => {
  test("verwijderdatum in het verleden: stop, met de foto en de vlag in de melding", () => {
    const items = withFlag("P-bob-1", "2026-07-15");
    expect(() => transform(items, PROD)).toThrow(/P-bob-1/);
    expect(() => transform(items, PROD)).toThrow(/--accept-expired-flags/);
  });

  test("verwijderdatum op de dag van de run telt als verlopen", () => {
    // De cron wist bij flaggedDeleteDate <= nu; de stop gebruikt dezelfde grens.
    expect(() => transform(withFlag("P-bob-1", "2026-08-23"), PROD)).toThrow(/P-bob-1/);
  });

  test("dev: een verlopen foto die in de seed zit stopt ook", () => {
    expect(() => transform(withFlag("P-bob-1", "2026-07-15"), DEV)).toThrow(/P-bob-1/);
  });

  test("met de vlag: door, de datum blijft staan, en een waarschuwing per foto", () => {
    const { records, warnings } = transform(withFlag("P-bob-1", "2026-07-15"), accepting(PROD));
    expect(row(records.photos, "P-bob-1").flaggedDeleteDate).toBe(Date.parse("2026-07-15T00:00:00.000Z"));
    expect(
      warnings.filter((w) => w.includes("P-bob-1") && /flaggedDeleteDate|verwijder/i.test(w)),
      "geen waarschuwing die het geaccepteerde verlies noemt",
    ).toHaveLength(1);
  });

  test("een verwijderdatum in de toekomst stopt niets", () => {
    expect(() => transform(withFlag("P-bob-1", "2026-09-01"), PROD)).not.toThrow();
  });

  test("een gewiste verwijderdatum (lege string, na bezwaar) stopt niets", () => {
    // P-alice-2 in de gedeelde fixture: gemeld, bezwaar aangetekend, datum ''.
    expect(() => transform(buildExtractWithCovers(), PROD)).not.toThrow();
  });

  test("dev: een verlopen foto buiten de seed stopt niets", () => {
    // P-dave-1 is van Dave, niet chosen: de foto wordt niet geladen.
    const items = withFlag("P-dave-1", "2026-07-15");
    expect(() => transform(items, DEV)).not.toThrow();
    expect(() => transform(items, PROD), "op prod wordt hij wél geladen").toThrow(/P-dave-1/);
  });
});

// ── F2 en F3: meldingen over covers buiten het eigen album ────────────

/** De ene melding die rij én foto noemt. */
function warningFor(warnings: string[], key: string, photoId: string): string {
  const hits = warnings.filter((w) => w.includes(key) && w.includes(photoId));
  expect(hits, `meldingen voor ${key}/${photoId}`).toHaveLength(1);
  return hits[0]!;
}

/** De tekst zonder de id's, om te zien of twee meldingen hetzelfde zeggen. */
const shape = (warning: string, ids: string[]): string =>
  ids.reduce((text, id) => text.split(id).join("<id>"), warning);

describe("WP12b F2: groepscover die alleen in een andere groep staat", () => {
  test("de melding noemt de andere groep", () => {
    // G-3 (prod): cover P-dave-1, die alleen in A-4 van G-1 staat.
    const { warnings } = transform(buildExtractWithCovers(), PROD);
    expect(warningFor(warnings, "G-3", "P-dave-1")).toContain("G-1");
  });

  test("de melding verschilt van 'staat in geen enkel album'", () => {
    const { warnings } = transform(buildExtractWithCovers(), PROD);
    const elders = warningFor(warnings, "G-3", "P-dave-1");
    const nergens = warningFor(warnings, "G-4", "P-alice-2");
    expect(shape(elders, ["G-3", "P-dave-1", "G-1"])).not.toBe(shape(nergens, ["G-4", "P-alice-2"]));
  });
});

describe("WP12b F3: de twee albumcover-meldingen verschillen", () => {
  for (const config of [PROD, DEV]) {
    test(`${config.target}: 'ander album van de groep' ≠ 'geen album van de groep'`, () => {
      const { warnings } = transform(buildExtractWithCovers(), config);
      const anderAlbum = warningFor(warnings, "A-5", "P-bob-2");
      const geenAlbum = warningFor(warnings, "A-6", "P-alice-2");
      expect(shape(anderAlbum, ["A-5", "P-bob-2", "G-1"])).not.toBe(
        shape(geenAlbum, ["A-6", "P-alice-2", "G-1"]),
      );
    });
  }
});
