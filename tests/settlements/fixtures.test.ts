import { describe, expect, it } from "vitest";
import { publicatie, request, type Example, type R } from "./_settlements";

// WP41 §A2 — de voorbeelden in tests/fixtures/wp41 zijn het contract tussen
// clubboek en Convex. Deze test hangt van geen productiecode af en is dus nu al
// groen: een vangnet voor wie een voorbeeld aanpast.
//   - het verzoek voldoet aan de samenhang van A2 (sommen, cellen, namen);
//   - het verzoek volgt uit de gepubliceerde versie volgens de tabel van A2:
//     elke Decimal half-even op centen (zoals het filter `euro` van het
//     clubboek), het teken van de cellen omgedraaid, geen lid_id.
// De omzetting hieronder is een onafhankelijke oracle (met de hand, BigInt),
// niet de omzetting die B in het clubboek schrijft.

const EXAMPLES: Example[] = ["lustrum", "weekend"];

/** Decimal-tekst naar centen, half-even op 0,01 (Python: quantize met de standaardcontext). */
function cents(dec: string): number {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(dec);
  if (!m) throw new Error(`geen Decimal: ${dec}`);
  const neg = m[1] === "-";
  const frac = (m[3] ?? "").padEnd(3, "0");
  const whole = BigInt(m[2]! + frac.slice(0, 2));
  const rest = frac.slice(2);
  const firstRest = Number(rest[0]);
  const tail = rest.slice(1).replace(/0/g, "");
  let c = whole;
  if (firstRest > 5 || (firstRest === 5 && tail.length > 0) || (firstRest === 5 && tail.length === 0 && c % 2n === 1n)) {
    c += 1n;
  }
  const n = Number(c);
  return neg && n !== 0 ? -n : 0 + n;
}

describe("de oracle zelf (half-even)", () => {
  it.each([
    ["0.125", 12],
    ["0.135", 14],
    ["-0.00", 0],
    ["912.4", 91240],
    ["655", 65500],
    ["33.33333333333333333333333333", 3333],
    ["2352.625", 235262],
    ["2352.6251", 235263],
    ["-83.335", -8334],
  ])("%s → %i", (dec, expected) => {
    expect(cents(dec)).toBe(expected);
    expect(Object.is(cents(dec), -0)).toBe(false);
  });
});

for (const name of EXAMPLES) {
  describe(`voorbeeld ${name}`, () => {
    const req = request(name);
    const pub = publicatie(name);
    const data = pub.publicatie.data as R;
    const rows = req.rows as R[];

    it("de samenhang van A2", () => {
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.name)).size).toBe(rows.length);
      for (const r of rows) expect((r.cells as unknown[]).length).toBe((req.parts as R[]).length);
      for (const k of ["costs", "club", "fromPot", "advanced", "balance", "open"]) {
        expect(req.totals[k], k).toBe(rows.reduce((a, r) => a + (r[k] as number), 0));
      }
      if (req.lustrum) {
        expect(req.totals.potBefore).toBe(rows.reduce((a, r) => a + (r.potBefore as number), 0));
        expect(req.totals.potAfter).toBe(rows.reduce((a, r) => a + (r.potAfter as number), 0));
      } else {
        expect(req.totals.potBefore).toBeNull();
        expect(req.totals.potAfter).toBeNull();
        for (const r of rows) expect([r.potBefore, r.potAfter, r.savings]).toEqual([null, null, []]);
      }
      for (const r of rows) expect(r.open).toBeGreaterThanOrEqual(0);
      // F3: betalingen alleen bij wie bijbetaalt, zoals afgerond() in het clubboek.
      for (const r of rows) if (r.balance <= 0) expect(r.payments).toEqual([]);
    });

    it("geen lid_id en geen clubboek-veldnaam in het verzoek", () => {
      const json = JSON.stringify(req);
      for (const w of ["lid_id", "\"lid\"", "kosten", "cellen", "delen", "maanden", "afgerond", "betaald", "terug"]) {
        expect(json).not.toContain(w);
      }
    });

    it("kop: sleutel, datums en vlaggen", () => {
      expect(req.key).toBe(String(pub.evenement.pk));
      expect(req.startDate).toBe(pub.evenement.startdatum);
      expect(req.publishedOn).toBe(pub.publicatie.datum);
      expect(req.name).toBe(data.naam);
      expect(req.period).toBe(data.periode);
      expect(req.settledOn).toBe(data.afrekendatum);
      expect(req.lustrum).toBe(data.lustrum);
      expect(req.costPerPerson).toBe(data.kosten_pp === null ? null : cents(data.kosten_pp));
    });

    it("onderdelen", () => {
      expect(req.parts).toEqual(
        (data.onderdelen as R[]).map((o) => ({
          name: o.naam,
          costs: cents(o.kosten),
          count: o.n,
          pricePerPerson: o.prijs === null ? null : cents(o.prijs),
        })),
      );
    });

    it("rijen: bedragen half-even op centen, cellen met het teken omgedraaid", () => {
      const rijen = data.rijen as R[];
      expect(rows.map((r) => r.name)).toEqual(rijen.map((r) => r.lid));
      rijen.forEach((rij, i) => {
        const r = rows[i]!;
        expect(r.costs).toBe(cents(rij.kosten));
        expect(r.club).toBe(cents(rij.club));
        expect(r.fromPot).toBe(cents(rij.uit_pot));
        expect(r.advanced).toBe(cents(rij.voorgeschoten));
        expect(r.balance).toBe(cents(rij.bij));
        expect(r.open).toBe(cents(rij.nog));
        expect(r.potBefore).toBe(data.lustrum ? cents(rij.pot) : null);
        expect(r.potAfter).toBe(data.lustrum ? cents(rij.pot_na) : null);
        expect(r.cells).toEqual((rij.cellen as Array<string | null>).map((c) => (c === null ? null : cents(c) === 0 ? 0 : -cents(c))));
        expect(r.lines).toEqual(
          (rij.delen as R[]).map((d) => ({ part: d.onderdeel, amount: cents(d.bedrag), basis: d.grondslag })),
        );
        expect(r.payments).toEqual((rij.betalingen as R[]).map((b) => ({ date: b.datum, amount: cents(b.bedrag) })));
        expect(r.savings).toEqual(
          (rij.spaarpot as R[]).map((s) => ({
            date: s.datum,
            description: s.omschrijving,
            amount: cents(s.bedrag),
            months: s.maanden ? (s.maanden as R[]).map((m) => ({ date: m.datum, amount: cents(m.bedrag) })) : null,
          })),
        );
        // In overzicht() is afgerond precies nog == 0 (A1): daarom niet meesturen.
        expect(rij.afgerond).toBe(r.open === 0);
      });
    });

    it("totalen", () => {
      const t = data.totaal as R;
      expect(req.totals).toEqual({
        costs: cents(t.kosten),
        club: cents(t.club),
        fromPot: cents(t.uit_pot),
        potBefore: data.lustrum ? cents(t.pot) : null,
        potAfter: data.lustrum ? cents(t.pot_na) : null,
        advanced: cents(t.voorgeschoten),
        balance: cents(t.bij),
        open: cents(t.nog),
      });
    });

    it("compact past het ruim binnen 128 KiB", () => {
      expect(new TextEncoder().encode(JSON.stringify(req)).byteLength).toBeLessThan(32 * 1024);
    });
  });
}

describe("randgevallen die de voorbeelden dekken", () => {
  it("lustrum: iemand helemaal uit zijn spaarpot, met bij = -0.00 in het clubboek", () => {
    const rij = (publicatie("lustrum").publicatie.data.rijen as R[]).find((r) => r.lid === "Joris")!;
    expect(rij.bij).toBe("-0.00");
    const r = (request("lustrum").rows as R[]).find((x) => x.name === "Joris")!;
    expect([r.balance, r.open, r.fromPot > 0, r.potAfter > 0]).toEqual([0, 0, true, true]);
    expect(Object.is(r.balance, -0)).toBe(false);
  });

  it("weekend: een prijs met een eindeloze breuk en een cel die niet op centen staat", () => {
    const data = publicatie("weekend").publicatie.data as R;
    expect((data.onderdelen as R[])[2]!.prijs).toBe("33.33333333333333333333333333");
    expect((data.rijen as R[])[0]!.cellen[2]).toBe("-33.33333333333333333333333333");
    // Afronding: de som van de rijen wijkt een cent af van de onderdelen.
    const req = request("weekend");
    expect(req.totals.costs).toBe((req.parts as R[]).reduce((a, p) => a + (p.costs as number), 0) - 1);
  });

  it("F3, weekend: Ruud krijgt terug en is deels uitbetaald; het clubboek geeft dan geen betalingen", () => {
    const rij = (publicatie("weekend").publicatie.data.rijen as R[]).find((r) => r.lid === "Ruud")!;
    expect([rij.bij, rij.nog, rij.betalingen, rij.terug]).toEqual(["-200.00", "50.00", [], "200.00"]);
    const r = (request("weekend").rows as R[]).find((x) => x.name === "Ruud")!;
    expect([r.costs, r.advanced, r.balance, r.open, r.payments]).toEqual([0, 20000, -20000, 5000, []]);
    // Uitbetaald of verrekend: alleen af te leiden uit balance en open.
    expect(-r.balance - r.open).toBe(15000);
  });

  it("weekend: iemand die terugkrijgt (balance < 0, open > 0)", () => {
    const r = (request("weekend").rows as R[]).find((x) => x.name === "Daan")!;
    expect(r.balance).toBeLessThan(0);
    expect(r.open).toBe(-r.balance);
  });
});
