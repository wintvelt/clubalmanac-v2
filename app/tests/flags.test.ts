import { describe, expect, it } from "vitest";
import { flagQueueOrder, ownFlagView, removalDay } from "../src/lib/flags";

// WP20, pure logica achter "Gemelde foto's" (eigenaar) en de wachtrij
// (webmaster). Spec: docs/work-packages/WP20-melden.md §A-invarianten,
// A-keuze 7, §Pariteit-checklist. De schermen zelf toetst de gate.
//
// Orakel met de hand, uit de backend (photos.appeal, decideFlag, de cron FL1):
//   gemeld     geen bezwaar, niet afgewezen  → bezwaar kan; verdwijnt op flaggedDeleteDate
//   bezwaar    bezwaar, geen besluit         → bezwaar kan niet meer; geen datum (gepauzeerd)
//   afgewezen  besluit "afgewezen"           → bezwaar kan niet; verdwijnt op flaggedDeleteDate
// Gemigreerde meldingen (WP12): datums op dag-niveau, soms zonder verwijderdatum.

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 1, 0, 0, 0);

describe("ownFlagView: de fase van een eigen gemelde foto", () => {
  it("gemeld, zonder bezwaar: bezwaar kan, met de verwijderdatum", () => {
    expect(ownFlagView({ flaggedAt: T0, flaggedDeleteDate: T0 + 14 * DAY })).toEqual({
      stage: "flagged",
      canAppeal: true,
      deleteAt: T0 + 14 * DAY,
    });
  });

  it("bezwaar zonder besluit: geen bezwaar meer, geen datum", () => {
    expect(ownFlagView({ flaggedAt: T0, flaggedAppealDate: T0 + DAY })).toEqual({
      stage: "appealed",
      canAppeal: false,
      deleteAt: null,
    });
  });

  it("afgewezen: geen bezwaar, de nieuwe verwijderdatum", () => {
    expect(
      ownFlagView({
        flaggedAt: T0,
        flaggedAppealDate: T0 + DAY,
        flaggedAppealDenyDate: T0 + 2 * DAY,
        flaggedDeleteDate: T0 + 9 * DAY,
      }),
    ).toEqual({ stage: "denied", canAppeal: false, deleteAt: T0 + 9 * DAY });
  });

  it("gemigreerd zonder verwijderdatum: bezwaar kan, datum onbekend", () => {
    expect(ownFlagView({ flaggedAt: T0 })).toEqual({ stage: "flagged", canAppeal: true, deleteAt: null });
  });

  it("afgewezen zonder bezwaardatum (oude data): toch afgewezen", () => {
    expect(ownFlagView({ flaggedAt: T0, flaggedAppealDenyDate: T0 + DAY }).stage).toBe("denied");
    expect(ownFlagView({ flaggedAt: T0, flaggedAppealDenyDate: T0 + DAY }).canAppeal).toBe(false);
  });
});

describe("flagQueueOrder: de wachtrij van de webmaster (A-keuze 7)", () => {
  type Q = { id: string; flaggedAt: number; flaggedAppealDate?: number; flaggedAppealDenyDate?: number };
  const sortQueue = (items: Q[]) => [...items].sort(flagQueueOrder).map((p) => p.id);

  it("eerst een bezwaar zonder besluit, dan de rest; binnen elke groep oudste melding eerst", () => {
    const items: Q[] = [
      { id: "gemeld-nieuw", flaggedAt: T0 + 5 * DAY },
      { id: "bezwaar-nieuw", flaggedAt: T0 + 4 * DAY, flaggedAppealDate: T0 + 6 * DAY },
      { id: "afgewezen", flaggedAt: T0, flaggedAppealDate: T0 + DAY, flaggedAppealDenyDate: T0 + 2 * DAY },
      { id: "gemeld-oud", flaggedAt: T0 + DAY },
      { id: "bezwaar-oud", flaggedAt: T0 + 2 * DAY, flaggedAppealDate: T0 + 3 * DAY },
    ];
    expect(sortQueue(items)).toEqual(["bezwaar-oud", "bezwaar-nieuw", "afgewezen", "gemeld-oud", "gemeld-nieuw"]);
  });

  it("een afgewezen bezwaar telt niet als 'wacht op besluit'", () => {
    const items: Q[] = [
      { id: "afgewezen", flaggedAt: T0 + DAY, flaggedAppealDate: T0 + 2 * DAY, flaggedAppealDenyDate: T0 + 3 * DAY },
      { id: "bezwaar", flaggedAt: T0 + 5 * DAY, flaggedAppealDate: T0 + 6 * DAY },
    ];
    expect(sortQueue(items)[0]).toBe("bezwaar");
  });
});

// --- WP20 besluit 6, S1 (fix-cyclus 1): de dag in "Wordt verwijderd na <dag>" ----------
//
// Zelfde regel als de mail (A-keuze 9): de genoemde dag is de kalenderdag vóór
// de eerste opruimronde (cron FL1, dagelijks 03:00 UTC, `flaggedDeleteDate <=
// now`) op of na de verwijderdatum. Die dag bestaat de foto in NL-tijd de hele
// dag; de ronde daarna is om 04:00 (winter) of 05:00 (zomer) NL.
// Orakel: met de hand, per geval.

describe("removalDay: de laatste hele dag (S1)", () => {
  const nov = (day: number, h: number, m = 0, s = 0) => Date.UTC(2026, 10, day, h, m, s);
  const jul = (day: number, h: number, m = 0, s = 0) => Date.UTC(2026, 6, day, h, m, s);

  it.each([
    ["01:00 UTC (winter): de dag ervoor", nov(28, 1), "27 november 2026"],
    ["00:00 UTC, gemigreerd (dag-niveau): de dag ervoor", nov(28, 0), "27 november 2026"],
    ["02:59:59 UTC: de dag ervoor", nov(28, 2, 59, 59), "27 november 2026"],
    ["precies 03:00 UTC: die ronde wist hem (<=), dus de dag ervoor", nov(28, 3), "27 november 2026"],
    ["03:00:01 UTC: de ronde van morgen, dus die dag zelf", nov(28, 3, 0, 1), "28 november 2026"],
    ["12:00 UTC: die dag zelf", nov(28, 12), "28 november 2026"],
    ["23:30 UTC (00:30 NL de dag erna): de UTC-dag", nov(28, 23, 30), "28 november 2026"],
    ["01:00 UTC (zomer, 03:00 NL): de dag ervoor", jul(10, 1), "9 juli 2026"],
    ["22:30 UTC (zomer, 00:30 NL de dag erna): de UTC-dag", jul(10, 22, 30), "10 juli 2026"],
    ["jaarwissel: 1 januari 02:00 UTC", Date.UTC(2027, 0, 1, 2), "31 december 2026"],
  ])("%s", (_label, deleteAt, expected) => {
    expect(removalDay(deleteAt)).toBe(expected);
  });
});
