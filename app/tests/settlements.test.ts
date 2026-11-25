import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  balanceCell,
  balanceLabel,
  formatCell,
  formatDayMonth,
  formatEuro,
  groupHasSettlements,
  groupTabs,
  participantOutcome,
  participantStatus,
  paymentLines,
  potAfterNote,
  settlementsByYear,
  stillToPay,
  timelineLabel,
  visibleColumns,
  type Settlement,
  type SettlementRow,
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

// Fix-cyclus 1 (F5): de voorbeelden als de echte vormen; de lib neemt geen
// losse JSON. Het verzoek heeft ook `key`, dat `settlements.get` niet geeft.
function fixture(name: "lustrum" | "weekend"): Settlement {
  const url = new URL(`../../tests/fixtures/wp41/${name}.request.json`, import.meta.url);
  const { key: _key, ...rest } = JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as Settlement & { key: string };
  return rest;
}

const NBSP = " ";
const MINUS = "−";
const row = (s: Settlement, name: string): SettlementRow => s.rows.find((r) => r.name === name)!;

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
    ["lustrum", "Joris", "Deelname volledig uit spaarpot betaald"],
    ["lustrum", "Bram", "Afgerond"],
    ["weekend", "Daan", `Krijgt nog €${NBSP}130,00 terug`],
    ["weekend", "Bram", "Afgerond"],
    ["weekend", "Gijs", `Betaalt nog €${NBSP}355,83`],
  ] as const)("%s, %s → %s", (which, name, text) => {
    const s = which === "lustrum" ? lustrum : weekend;
    expect(participantOutcome(row(s, name), s.lustrum)).toBe(text);
  });

  it("geen lustrum en niets af te rekenen: Afgerond (geen spaarpot-tekst)", () => {
    expect(participantOutcome({ balance: 0, open: 0, fromPot: 0 }, false)).toBe("Afgerond");
  });

  it("lustrum zonder kosten uit de pot en niets af te rekenen: Afgerond", () => {
    expect(participantOutcome({ balance: 0, open: 0, fromPot: 0 }, true)).toBe("Afgerond");
  });

  it("nooit in de tweede persoon", () => {
    for (const s of [lustrum, weekend]) {
      for (const r of s.rows) {
        expect(participantOutcome(r, s.lustrum)).not.toMatch(/\b(je|jij|jouw|u)\b/i);
      }
    }
  });
});

// WP41b: de regel onder de uitkomst, zoals in het clubboek (evenement_lid.html):
// alleen bij een lustrum en als er na de afrekening iets in de spaarpot zit.
describe("regel onder de uitkomst: wat er na de afrekening in de spaarpot zit", () => {
  const lustrum = fixture("lustrum");
  const weekend = fixture("weekend");

  it("lustrum met iets over: het bedrag uit potAfter", () => {
    expect(potAfterNote(row(lustrum, "Joris"), true)).toBe(`Na de afrekening zit er €${NBSP}208,00 in de spaarpot`);
  });

  it("lustrum en de spaarpot is leeg: geen regel", () => {
    expect(potAfterNote(row(lustrum, "Maarten"), true)).toBeNull();
  });

  it("geen lustrum (potAfter null): geen regel", () => {
    expect(potAfterNote(row(weekend, "Daan"), false)).toBeNull();
    expect(potAfterNote({ potAfter: 5000 }, false)).toBeNull();
  });

  it("nooit in de tweede persoon", () => {
    for (const r of lustrum.rows) {
      expect(potAfterNote(r, true) ?? "").not.toMatch(/\b(je|jij|jouw|u)\b/i);
    }
  });
});

describe("datum in het spaarpot-overzicht: zonder jaartal", () => {
  it.each([
    ["2026-06-18", "18-6"],
    ["2022-01-01", "1-1"],
    ["2025-12-31", "31-12"],
  ])("%s → %s", (iso, text) => {
    expect(formatDayMonth(iso)).toBe(text);
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
    expect(stillToPay(fixture("lustrum").rows)).toEqual({ cents: 30234 + 34833 + 142233, count: 3 });
  });

  it("weekend: alleen wie bijbetaalt; Daan krijgt terug en telt niet mee", () => {
    expect(stillToPay(fixture("weekend").rows)).toEqual({ cents: 35583 + 21583, count: 2 });
  });
});

describe("F3: blok 3, Afrekening (paymentLines)", () => {
  const lustrum = fixture("lustrum");
  const weekend = fixture("weekend");

  it("bijbetalen, deels betaald: naheffing, de betaling eraf, wat nog open staat", () => {
    expect(paymentLines(row(lustrum, "Maarten"))).toEqual([
      { label: "Bijbetalen", cents: 84833 },
      { label: "Betaald op 20-11-2026", cents: -50000 },
      { label: "Nog te betalen", cents: 34833 },
    ]);
  });

  it("bijbetalen in twee keer, helemaal betaald: Afgerond", () => {
    expect(paymentLines(row(lustrum, "Sander"))).toEqual([
      { label: "Bijbetalen", cents: 30233 },
      { label: "Betaald op 16-11-2026", cents: -15000 },
      { label: "Betaald op 19-11-2026", cents: -15233 },
      { label: "Afgerond", cents: 0 },
    ]);
  });

  it("de datum zoals het clubboek (j-n-Y): geen voorloopnul (A-keuze 13)", () => {
    expect(paymentLines(row(weekend, "Thijs"))).toEqual([
      { label: "Bijbetalen", cents: 31583 },
      { label: "Betaald op 19-6-2026", cents: -10000 },
      { label: "Nog te betalen", cents: 21583 },
    ]);
  });

  it("terugkrijgen, al deels uitbetaald (Ruud): het verschil als één regel, nooit als betaling", () => {
    expect(paymentLines(row(weekend, "Ruud"))).toEqual([
      { label: "Terugkrijgen", cents: 20000 },
      { label: "Uitbetaald of verrekend", cents: -15000 },
      { label: "Nog terug te krijgen", cents: 5000 },
    ]);
  });

  it("terugkrijgen, nog niets uitbetaald (Daan): geen tussenregel", () => {
    expect(paymentLines(row(weekend, "Daan"))).toEqual([
      { label: "Terugkrijgen", cents: 13000 },
      { label: "Nog terug te krijgen", cents: 13000 },
    ]);
  });

  it("terugkrijgen en helemaal uitbetaald: Afgerond", () => {
    expect(paymentLines({ balance: -13000, open: 0, payments: [] })).toEqual([
      { label: "Terugkrijgen", cents: 13000 },
      { label: "Uitbetaald of verrekend", cents: -13000 },
      { label: "Afgerond", cents: 0 },
    ]);
  });

  it("niets af te rekenen (Joris, uit zijn spaarpot): geen regels", () => {
    expect(paymentLines(row(lustrum, "Joris"))).toEqual([]);
  });

  // Fix-cyclus 3 (besluit Wouter, A-keuze 15): het getoonde betaalde totaal
  // is hoogstens de naheffing, zoals `min(b, -s)` in het clubboek. De
  // betalingen gaan in hun volgorde mee tot de naheffing vol is: de betaling
  // die eroverheen gaat, telt alleen voor wat er nog over was; latere
  // betalingen verschijnen niet. Het teveel staat nergens.
  it("overbetaling in één keer (€ 105 op € 100): € 100 betaald, afgerond", () => {
    expect(
      paymentLines({ balance: 10000, open: 0, payments: [{ date: "2026-11-18", amount: 10500 }] }),
    ).toEqual([
      { label: "Bijbetalen", cents: 10000 },
      { label: "Betaald op 18-11-2026", cents: -10000 },
      { label: "Afgerond", cents: 0 },
    ]);
  });

  it("overbetaling over meer betalingen: de tweede afgekapt, de derde valt weg", () => {
    expect(
      paymentLines({
        balance: 10000,
        open: 0,
        payments: [
          { date: "2026-11-18", amount: 6000 },
          { date: "2026-11-20", amount: 5000 },
          { date: "2026-11-22", amount: 2000 },
        ],
      }),
    ).toEqual([
      { label: "Bijbetalen", cents: 10000 },
      { label: "Betaald op 18-11-2026", cents: -6000 },
      { label: "Betaald op 20-11-2026", cents: -4000 },
      { label: "Afgerond", cents: 0 },
    ]);
  });

  it("precies betaald: niets afgekapt", () => {
    expect(paymentLines(row(lustrum, "Bram"))).toEqual([
      { label: "Bijbetalen", cents: 30234 },
      { label: "Betaald op 17-11-2026", cents: -30234 },
      { label: "Afgerond", cents: 0 },
    ]);
  });

  it("een overbetaalde deelnemer in een voorbeeld: de regels tellen nog steeds op", () => {
    const s = fixture("lustrum");
    const bram = row(s, "Bram");
    bram.payments = [{ date: "2026-11-17", amount: 30234 + 2500 }];
    const lines = paymentLines(bram);
    expect(lines.slice(0, -1).reduce((a: number, l: { cents: number }) => a + l.cents, 0)).toBe(0);
    expect(lines[lines.length - 1]).toEqual({ label: "Afgerond", cents: 0 });
    expect(JSON.stringify(lines)).not.toContain("2500");
  });

  it("de regels tellen op tot de laatste, voor elke deelnemer in de voorbeelden", () => {
    for (const s of [lustrum, weekend]) {
      for (const r of s.rows) {
        const lines = paymentLines(r);
        if (lines.length === 0) continue;
        const last = lines[lines.length - 1]!;
        const sum = lines.slice(0, -1).reduce((a: number, l: { cents: number }) => a + l.cents, 0);
        expect(sum, r.name).toBe(last.cents);
        expect(last.cents, r.name).toBe(r.open);
      }
    }
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
