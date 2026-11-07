// WP12b — RED tests op de transform: albumcovers en het bezoek.
//
// Aanleiding: op de TestFlight-gate van WP17a/WP25 had geen enkel album een
// cover. De bron heeft hem als `photoId` op het album-item (`GA`), precies zoals
// bij een groep, maar de transform zette hem hard op leeg. Daarnaast landde het
// bezoek uit v1 (`UVvisit.visitDateLast`) in `users.lastVisitAt`, dat sinds
// WP15b niemand leest; v2 bewaart het bezoek in `userVisits`.
//
// De gedeelde fixture blijft ongemoeid: andere suites tellen op zijn rijen en
// waarschuwingen. Dit bestand bouwt er een variant op met precies de gevallen
// die WP12b raakt (`buildExtractWithCovers` in fixture.ts).
//
// Besluit 4 (Wouter, 2026-11-07): een cover komt mee zodra de foto gemigreerd
// wordt, ook als hij niet in het eigen album of in geen album van de groep
// staat. Dan een waarschuwing, geen drop. In v1 kon je een groepscover
// uploaden zonder publicatie (`createPhoto.js`, actie `groupcover`).

import { describe, expect, test } from "vitest";
import { transform, type TransformConfig } from "../../scripts/migrate/transform";
import type { Records, Row } from "../../scripts/migrate/types";
import { buildExtractWithCovers, CHOSEN, day, DEV_SUBJECTS, PROD_SUBJECTS } from "./fixture";

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

const run = (config: TransformConfig) => transform(buildExtractWithCovers(), config);

/** `userVisits` staat nog niet in `Records`; tot B hem toevoegt via een omweg. */
const visitsOf = (records: Records): Row[] =>
  (records as unknown as Record<string, Row[] | undefined>).userVisits ?? [];

const row = (rows: Row[] | undefined, sourceKey: string): Row => {
  const found = (rows ?? []).find((r) => r.sourceKey === sourceKey);
  if (found === undefined) throw new Error(`geen rij ${sourceKey}`);
  return found;
};

// ── invariant 1: albumcovers ──────────────────────────────────────────

describe("WP12b invariant 1: een album krijgt de cover uit de bron", () => {
  test("prod: een cover die in het album staat komt mee", () => {
    const { records } = run(PROD);
    expect(row(records.albums, "A-1").coverPhotoId).toBe("P-bob-1");
    expect(row(records.albums, "A-4").coverPhotoId).toBe("P-dave-1");
  });

  test("dev: een cover van een chosen eigenaar komt mee", () => {
    const { records } = run(DEV);
    expect(row(records.albums, "A-1").coverPhotoId).toBe("P-bob-1");
  });

  test("een album zonder cover in de bron krijgt er geen", () => {
    const { records } = run(PROD);
    expect(row(records.albums, "A-2").coverPhotoId).toBeUndefined();
  });

  test("een cover naar een foto die niet bestaat wordt gewist en gemeld", () => {
    const { records, warnings } = run(PROD);
    expect(row(records.albums, "A-3").coverPhotoId).toBeUndefined();
    const melding = warnings.filter((w) => w.includes("A-3") && w.includes("P-ghost"));
    expect(melding, "geen melding over de gewiste albumcover").toHaveLength(1);
  });

  test("dev: een cover naar een foto die buiten de seed valt wordt gewist en gemeld", () => {
    const { records, warnings } = run(DEV);
    expect(row(records.albums, "A-4").coverPhotoId).toBeUndefined();
    expect(
      warnings.some((w) => w.includes("A-4") && w.includes("P-dave-1")),
      "geen melding over de gewiste albumcover",
    ).toBe(true);
  });

  test("elke albumcover resolvet in de foto's die geladen worden", () => {
    for (const config of [PROD, DEV]) {
      const { records } = run(config);
      const photoKeys = new Set(records.photos.map((p) => p.sourceKey));
      for (const album of records.albums) {
        if (album.coverPhotoId === undefined) continue;
        expect(photoKeys.has(album.coverPhotoId as string), `${config.target}: ${album.sourceKey}`).toBe(
          true,
        );
      }
    }
  });

  test("regressie: de groepscover van G-1 blijft staan", () => {
    expect(row(run(PROD).records.groups, "G-1").coverPhotoId).toBe("P-alice-1");
    expect(row(run(DEV).records.groups, "G-1").coverPhotoId).toBe("P-alice-1");
  });
});

// ── besluit 4: covers buiten het eigen album ──────────────────────────

/** Een waarschuwing die beide noemt: de rij en de foto. */
const warnsAbout = (warnings: string[], key: string, photoId: string): boolean =>
  warnings.some((w) => w.includes(key) && w.includes(photoId));

describe("WP12b besluit 4: een cover zonder publicatie komt mee, met een waarschuwing", () => {
  for (const config of [PROD, DEV]) {
    test(`${config.target}: albumcover uit een ander album van de groep`, () => {
      const { records, warnings } = run(config);
      expect(row(records.albums, "A-5").coverPhotoId).toBe("P-bob-2");
      expect(warnsAbout(warnings, "A-5", "P-bob-2"), "geen waarschuwing voor A-5").toBe(true);
    });

    test(`${config.target}: albumcover die in geen enkel album staat`, () => {
      const { records, warnings } = run(config);
      expect(row(records.albums, "A-6").coverPhotoId).toBe("P-alice-2");
      expect(warnsAbout(warnings, "A-6", "P-alice-2"), "geen waarschuwing voor A-6").toBe(true);
    });

    test(`${config.target}: groepscover die in geen album van de groep staat`, () => {
      const { records, warnings } = run(config);
      expect(row(records.groups, "G-4").coverPhotoId).toBe("P-alice-2");
      expect(warnsAbout(warnings, "G-4", "P-alice-2"), "geen waarschuwing voor G-4").toBe(true);
    });

    test(`${config.target}: een cover in het eigen album of in de groep geeft geen waarschuwing`, () => {
      const { warnings } = run(config);
      expect(warnsAbout(warnings, "A-1", "P-bob-1"), "A-1: cover staat in A-1").toBe(false);
      expect(warnsAbout(warnings, "G-1", "P-alice-1"), "G-1: cover staat in A-1 van G-1").toBe(false);
    });
  }

  test("prod: groepscover van een foto die alleen in een andere groep staat (G-3)", () => {
    const { records, warnings } = run(PROD);
    expect(row(records.groups, "G-3").coverPhotoId).toBe("P-dave-1");
    expect(warnsAbout(warnings, "G-3", "P-dave-1"), "geen waarschuwing voor G-3").toBe(true);
  });

  test("dev: een cover naar een foto buiten de seed blijft gewoon leeg, zonder publicatie-waarschuwing", () => {
    // Twee verschillende meldingen: "gewist" (foto niet gemigreerd) en
    // "zonder publicatie" (foto wel gemigreerd). G-3 hoort bij de eerste.
    const { records } = run(DEV);
    expect(row(records.groups, "G-3").coverPhotoId).toBeUndefined();
  });
});

// ── invariant 3: het bezoek naar userVisits ───────────────────────────

describe("WP12b invariant 3: het bezoek wordt een userVisits-rij", () => {
  test("prod: één rij per user met een bezoek, op de kalenderdag om UTC-middernacht", () => {
    const { records } = run(PROD);
    const visits = visitsOf(records).map((r) => ({
      userId: r.userId,
      lastVisitAt: r.lastVisitAt,
    }));
    expect(visits.sort((a, b) => String(a.userId).localeCompare(String(b.userId)))).toEqual([
      { userId: "U-alice", lastVisitAt: day("2026-08-01") },
      { userId: "U-dave", lastVisitAt: day("2026-07-15") },
    ]);
  });

  test("dev: alleen chosen users krijgen een bezoek", () => {
    const { records } = run(DEV);
    expect(visitsOf(records).map((r) => r.userId)).toEqual(["U-alice"]);
  });

  test("een gewist bezoek (lege string) en een user zonder UVvisit krijgen geen rij", () => {
    const { records } = run(PROD);
    const users = new Set(visitsOf(records).map((r) => r.userId));
    expect(users.has("U-carol"), "lege string is afwezig, geen bezoek").toBe(false);
    expect(users.has("U-bob"), "Bob heeft geen UVvisit").toBe(false);
  });

  test("users.lastVisitAt wordt niet meer gevuld", () => {
    for (const config of [PROD, DEV]) {
      for (const user of run(config).records.users) {
        expect(user.lastVisitAt, `${config.target}: ${user.sourceKey}`).toBeUndefined();
      }
    }
  });

  test("elke userVisits-rij heeft een eigen bron-sleutel en wijst naar een geladen user", () => {
    for (const config of [PROD, DEV]) {
      const { records } = run(config);
      const userKeys = new Set(records.users.map((u) => u.sourceKey));
      const visits = visitsOf(records);
      expect(visits.length, `${config.target}: geen enkele userVisits-rij`).toBeGreaterThan(0);
      const sourceKeys = visits.map((r) => r.sourceKey);
      expect(new Set(sourceKeys).size, `${config.target}: dubbele bron-sleutel`).toBe(sourceKeys.length);
      for (const visit of visits) {
        expect(typeof visit.sourceKey).toBe("string");
        expect(userKeys.has(visit.userId as string), `${config.target}: ${String(visit.userId)}`).toBe(true);
      }
    }
  });
});
