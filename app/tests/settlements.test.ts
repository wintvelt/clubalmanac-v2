import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  balanceCell,
  balanceLabel,
  formatCell,
  formatEuro,
  groupHasSettlements,
  groupTabs,
  participantOutcome,
  participantStatus,
  settlementsByYear,
  stillToPay,
  timelineLabel,
  visibleColumns,
} from "../src/lib/settlements";
import { participantPath, settlementPath, settlementTablePath } from "../src/lib/groupRoutes";
import { PUBLIC_PATHS, routeAccess } from "../src/lib/routeAccess";
import { listFiles } from "./support/sourceScan";

// WP41 — de pure logica van Geld in de app.
// Spec: docs/work-packages/WP41-financieel.md §A10 (app), §A-keuzes 5–8,
// mockup WP41-mockup.html. Geen UI-tests (work-package-specs §App-WP's).
//   - Bedragen in het Nederlands uit centen (`€ 1.234,56`), nooit afgebroken.
//   - De tijdlijn per jaar; "x van y nog open" of "Afgerond".
//   - Status en uitkomst per deelnemer, in de derde persoon (besluit 3).
//   - Kolommen zonder inhoud verdwijnen, zoals in het clubboek.
//   - De tab Geld alleen bij minstens één afrekening (invariant 8).
// De bedragen komen uit tests/fixtures/wp41 (verzonnen).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

function fixture(name: "lustrum" | "weekend"): R {
  const url = new URL(`../../tests/fixtures/wp41/${name}.request.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as R;
}

const NBSP = " ";
const MINUS = "−";
const row = (s: R, name: string): R => (s.rows as R[]).find((r) => r.name === name)!;

describe("formatEuro", () => {
  it.each([
    [123456, `€${NBSP}1.234,56`],
    [0, `€${NBSP}0,00`],
    [5, `€${NBSP}0,05`],
    [91240, `€${NBSP}912,40`],
    [100000000, `€${NBSP}1.000.000,00`],
    [-140000, `${MINUS}€${NBSP}1.400,00`],
    [-5, `${MINUS}€${NBSP}0,05`],
  ])("%i centen → %s", (cents, text) => {
    expect(formatEuro(cents)).toBe(text);
  });

  it("nul is nooit negatief", () => {
    expect(formatEuro(-0)).toBe(`€${NBSP}0,00`);
  });

  it("geen gewone spatie of koppelteken: een bedrag breekt niet", () => {
    for (const c of [0, 7, 123456, -123456, 987654321]) {
      expect(formatEuro(c)).not.toMatch(/[ -]/);
    }
  });
});

describe("formatCell (de tabel, zoals euro_leeg in het clubboek)", () => {
  it.each([
    [null, ""],
    [0, ""],
    [91240, "912,40"],
    [3333, "33,33"],
    [123456789, "1.234.567,89"],
    [-5, `${MINUS}0,05`],
  ])("%s → '%s'", (cents, text) => {
    expect(formatCell(cents)).toBe(text);
  });
});

describe("afrekening: bijbetalen rood met −, terugkrijgen groen met +", () => {
  it("balanceLabel (lijst Deelnemers, met euroteken)", () => {
    expect(balanceLabel(30234)).toBe(`${MINUS}€${NBSP}302,34`);
    expect(balanceLabel(-13000)).toBe(`+€${NBSP}130,00`);
    expect(balanceLabel(0)).toBe("—");
  });

  it("balanceCell (tabel, zonder euroteken; 0 is leeg)", () => {
    expect(balanceCell(30234)).toBe(`${MINUS}302,34`);
    expect(balanceCell(-13000)).toBe("+130,00");
    expect(balanceCell(0)).toBe("");
  });
});

describe("tijdlijn", () => {
  const item = (_id: string, startDate: string) => ({ _id, startDate });

  it("per jaar, in de volgorde van de backend", () => {
    const list = [item("a", "2027-03-01"), item("b", "2026-10-12"), item("c", "2026-06-12"), item("d", "2025-09-20")];
    expect(settlementsByYear(list)).toEqual([
      { year: 2027, settlements: [list[0]] },
      { year: 2026, settlements: [list[1], list[2]] },
      { year: 2025, settlements: [list[3]] },
    ]);
  });

  it("1 januari en 31 december vallen in hun eigen jaar (geen tijdzone)", () => {
    const list = [item("a", "2027-01-01"), item("b", "2026-12-31")];
    expect(settlementsByYear(list).map((y: { year: number }) => y.year)).toEqual([2027, 2026]);
  });

  it("leeg blijft leeg", () => {
    expect(settlementsByYear([])).toEqual([]);
  });

  it("label op de kaart", () => {
    expect(timelineLabel({ participantCount: 8, openCount: 3 })).toBe("3 van 8 nog open");
    expect(timelineLabel({ participantCount: 5, openCount: 1 })).toBe("1 van 5 nog open");
    expect(timelineLabel({ participantCount: 5, openCount: 0 })).toBe("Afgerond");
  });
});

describe("status per deelnemer (lijst Deelnemers)", () => {
  const lustrum = fixture("lustrum");
  const weekend = fixture("weekend");

  it("afgerond: grijs", () => {
    expect(participantStatus(row(lustrum, "Bram"))).toEqual({ kind: "done", label: "Afgerond" });
    expect(participantStatus(row(lustrum, "Joris"))).toEqual({ kind: "done", label: "Afgerond" });
  });

  it("betaalt nog: rood, met wat nog open staat (niet de hele afrekening)", () => {
    expect(participantStatus(row(lustrum, "Maarten"))).toEqual({ kind: "pays", label: `Nog €${NBSP}348,33` });
    expect(participantStatus(row(lustrum, "Thijs"))).toEqual({ kind: "pays", label: `Nog €${NBSP}1.422,33` });
  });

  it("krijgt nog: groen", () => {
    expect(participantStatus(row(weekend, "Daan"))).toEqual({ kind: "receives", label: `Krijgt nog €${NBSP}130,00` });
  });
});

describe("uitkomst op het scherm van één deelnemer (derde persoon)", () => {
  const lustrum = fixture("lustrum");
  const weekend = fixture("weekend");

  it.each([
    ["lustrum", "Maarten", `Betaalt nog €${NBSP}348,33`],
    ["lustrum", "Daan", `Betaalt nog €${NBSP}302,34`],
    ["lustrum", "Joris", "Zijn deel komt helemaal uit zijn spaarpot"],
    ["lustrum", "Bram", "Afgerond"],
    ["weekend", "Daan", `Krijgt nog €${NBSP}130,00 terug`],
    ["weekend", "Bram", "Afgerond"],
    ["weekend", "Gijs", `Betaalt nog €${NBSP}355,83`],
  ] as const)("%s, %s → %s", (which, name, text) => {
    const s = which === "lustrum" ? lustrum : weekend;
    expect(participantOutcome(row(s, name), s.lustrum as boolean)).toBe(text);
  });

  it("geen lustrum en niets af te rekenen: Afgerond (geen spaarpot-tekst)", () => {
    expect(participantOutcome({ balance: 0, open: 0, fromPot: 0 }, false)).toBe("Afgerond");
  });

  it("lustrum zonder kosten uit de pot en niets af te rekenen: Afgerond", () => {
    expect(participantOutcome({ balance: 0, open: 0, fromPot: 0 }, true)).toBe("Afgerond");
  });

  it("nooit in de tweede persoon", () => {
    for (const s of [lustrum, weekend]) {
      for (const r of s.rows as R[]) {
        expect(participantOutcome(r, s.lustrum as boolean)).not.toMatch(/\b(je|jij|jouw|u)\b/i);
      }
    }
  });
});

describe("kolommen van de hele tabel (zoals het clubboek)", () => {
  it("lustrum: kosten, uit spaarpot, spaarpot na, afrekening, status (geen clubkas, geen voorgeschoten)", () => {
    expect(visibleColumns(fixture("lustrum"))).toEqual(["costs", "fromPot", "potAfter", "balance", "status"]);
  });

  it("weekend: kosten, clubkas, voorgeschoten, afrekening, status", () => {
    expect(visibleColumns(fixture("weekend"))).toEqual(["costs", "club", "advanced", "balance", "status"]);
  });

  it("zonder clubkas en zonder voorgeschoten: alleen kosten, afrekening, status", () => {
    const s = fixture("weekend");
    s.totals = { ...s.totals, club: 0, advanced: 0 };
    expect(visibleColumns(s)).toEqual(["costs", "balance", "status"]);
  });

  it("het totaal telt, niet een enkele rij: clubkas netto nul verdwijnt", () => {
    const s = fixture("weekend");
    s.totals = { ...s.totals, club: 0 };
    expect(visibleColumns(s)).not.toContain("club");
  });
});

describe("tegel Nog te betalen (A-keuze 5)", () => {
  it("lustrum: drie deelnemers betalen nog", () => {
    expect(stillToPay(fixture("lustrum").rows as R[])).toEqual({ cents: 30234 + 34833 + 142233, count: 3 });
  });

  it("weekend: alleen wie bijbetaalt; Daan krijgt terug en telt niet mee", () => {
    expect(stillToPay(fixture("weekend").rows as R[])).toEqual({ cents: 35583 + 21583, count: 2 });
  });
});

describe("de tab Geld (invariant 8)", () => {
  it("alleen bij minstens één afrekening; zolang de lijst laadt: nee", () => {
    expect(groupHasSettlements(undefined)).toBe(false);
    expect(groupHasSettlements([])).toBe(false);
    expect(groupHasSettlements([{ _id: "s1" }])).toBe(true);
  });

  it("Geld is de vierde tab, na Leden; Films blijft tussen Albums en Leden", () => {
    const titles = (o: { hasFilms: boolean; hasSettlements: boolean }) => groupTabs(o).map((x: { title: string }) => x.title);
    expect(titles({ hasFilms: true, hasSettlements: true })).toEqual(["Albums", "Films", "Leden", "Geld"]);
    expect(titles({ hasFilms: false, hasSettlements: true })).toEqual(["Albums", "Leden", "Geld"]);
    expect(titles({ hasFilms: true, hasSettlements: false })).toEqual(["Albums", "Films", "Leden"]);
    expect(titles({ hasFilms: false, hasSettlements: false })).toEqual(["Albums", "Leden"]);
    expect(groupTabs({ hasFilms: true, hasSettlements: true }).map((x: { key: string }) => x.key)).toEqual([
      "albums",
      "films",
      "leden",
      "geld",
    ]);
  });
});

describe("routes onder de groep", () => {
  it("overzicht, tabel en deelnemer, elk deel gecodeerd", () => {
    expect(settlementPath("g1", "s1")).toBe("/groep/g1/geld/s1");
    expect(settlementTablePath("g1", "s1")).toBe("/groep/g1/geld/s1/tabel");
    expect(participantPath("g1", "s1", "Maarten")).toBe("/groep/g1/geld/s1/deelnemer/Maarten");
    expect(participantPath("g 1", "s/1", "Jan Willem")).toBe("/groep/g%201/geld/s%2F1/deelnemer/Jan%20Willem");
  });

  it("de routebestanden staan in de Home-stack", () => {
    const appDir = fileURLToPath(new URL("../src/app", import.meta.url));
    const files = existsSync(appDir) ? listFiles(appDir, new Set()) : [];
    const base = String.raw`^\(tabs\)\/\(home\)\/groep\/\[groupId\]\/geld\/\[settlementId\]`;
    expect(files.some((f) => new RegExp(`${base}(\\/index)?\\.tsx$`).test(f))).toBe(true);
    expect(files.some((f) => new RegExp(`${base}\\/tabel\\.tsx$`).test(f))).toBe(true);
    expect(files.some((f) => new RegExp(`${base}\\/deelnemer\\/\\[[A-Za-z]+\\]\\.tsx$`).test(f))).toBe(true);
  });

  it("niet publiek: ingelogd tonen, uitgelogd naar inloggen", () => {
    for (const path of [
      settlementPath("g1", "s1"),
      settlementTablePath("g1", "s1"),
      participantPath("g1", "s1", "Maarten"),
    ]) {
      expect(PUBLIC_PATHS.has(path)).toBe(false);
      expect(routeAccess(path, "ready")).toBe("show");
      expect(routeAccess(path, "signedOut")).toBe("login");
    }
  });
});
