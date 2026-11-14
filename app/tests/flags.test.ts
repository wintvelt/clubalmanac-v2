import { describe, expect, it } from "vitest";
import { flagQueueOrder, ownFlagView } from "../src/lib/flags";

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
