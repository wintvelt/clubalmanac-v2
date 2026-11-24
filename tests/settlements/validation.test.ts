import { describe, expect, it } from "vitest";
import {
  MAX_BODY_BYTES,
  newT,
  post,
  postOk,
  request,
  rows,
  seedWorld,
  snapshot,
  useFinanceEnv,
  withTotals,
  type R,
} from "./_settlements";

// WP41 invariant 6, §A2 (het contract) en §A3 (grenzen).
//   Elk verzoek wordt in zijn geheel gecontroleerd. Bij een fout: 400 (vorm)
//   of 413 (te groot), en er wordt niets geschreven. Een bestaande afrekening
//   met dezelfde sleutel blijft precies zoals hij was.
//   A-invariant 3: een veld buiten het contract, waar ook, is een fout (zo kan
//   een intern id van een lid nooit binnenkomen).
//   A-invariant 6: elk totaal is de som van zijn rijen.

useFinanceEnv();

type Mutate = (b: R) => unknown;

const row0 = (b: R): R => (b.rows as R[])[0]!;
const lustrum = (): R => request("lustrum");
const weekend = (): R => request("weekend");

/** Stuurt eerst het geldige verzoek, dan de fout met dezelfde sleutel. */
async function expectRejected(base: () => R, mutate: Mutate, status = 400): Promise<string> {
  const t = newT();
  await seedWorld(t);
  await postOk(t, base());
  const before = await snapshot(t);
  const b = base();
  const replaced = mutate(b);
  const body = replaced === undefined ? b : replaced;
  const res = await post(t, body as R | string);
  const text = await res.text();
  expect(res.status, text).toBe(status);
  expect(await snapshot(t)).toEqual(before);
  return text;
}

/** Een nieuwe sleutel die geweigerd wordt, maakt ook geen nieuwe rij. */
async function expectNotCreated(body: R | string, status = 400): Promise<void> {
  const t = newT();
  await seedWorld(t);
  const res = await post(t, body);
  expect(res.status).toBe(status);
  expect(await rows(t)).toEqual([]);
}

async function expectAccepted(body: R): Promise<void> {
  const t = newT();
  await seedWorld(t);
  await postOk(t, body);
  expect(await rows(t)).toHaveLength(1);
}

const pad = (n: number, c = "x") => c.repeat(n);

// --- het geheel -----------------------------------------------------------------

describe("de body als geheel", () => {
  const cases: Array<[string, string]> = [
    ["kapotte JSON", "{ \"key\": \"17\""],
    ["lege body", ""],
    ["null", "null"],
    ["een lijst", "[]"],
    ["een getal", "17"],
  ];
  for (const [label, raw] of cases) {
    it(`${label}: 400`, async () => {
      await expectNotCreated(raw);
    });
  }
});

describe("A3: grootte (gemeten op de bytes)", () => {
  it("een geldig verzoek van precies 128 KiB (opgevuld met witruimte) wordt aangenomen", async () => {
    const raw = JSON.stringify(lustrum()).padEnd(MAX_BODY_BYTES, " ");
    expect(new TextEncoder().encode(raw).byteLength).toBe(MAX_BODY_BYTES);
    const t = newT();
    await seedWorld(t);
    const res = await post(t, raw);
    expect(res.status).toBe(200);
  });

  it("één byte meer: 413, en een bestaande afrekening blijft", async () => {
    const raw = JSON.stringify({ ...lustrum(), name: "Te groot" }).padEnd(MAX_BODY_BYTES + 1, " ");
    await expectRejected(lustrum, () => raw, 413);
  });

  it("veel groter: 413, niets nieuw", async () => {
    await expectNotCreated(JSON.stringify(lustrum()).padEnd(512 * 1024, " "), 413);
  });
});

// --- velden -----------------------------------------------------------------------

describe("A2: verplichte velden en typen", () => {
  const cases: Array<[string, Mutate]> = [
    ["key ontbreekt", (b) => void delete b.key],
    ["key is een getal", (b) => void (b.key = 17)],
    ["key is leeg", (b) => void (b.key = "")],
    ["key is langer dan 64 tekens", (b) => void (b.key = pad(65, "k"))],
    ["key met een spatie", (b) => void (b.key = "1 7")],
    ["key met een schuine streep", (b) => void (b.key = "17/x")],
    ["key met een letter buiten A-Z", (b) => void (b.key = "ä17")],
    ["name ontbreekt", (b) => void delete b.name],
    ["name is leeg", (b) => void (b.name = "")],
    ["name is langer dan 200 tekens", (b) => void (b.name = pad(201))],
    ["period is langer dan 200 tekens", (b) => void (b.period = pad(201))],
    ["period ontbreekt", (b) => void delete b.period],
    ["startDate in de vorm dd-mm-jjjj", (b) => void (b.startDate = "12-10-2026")],
    ["startDate die niet bestaat", (b) => void (b.startDate = "2026-02-30")],
    ["startDate met een tijd", (b) => void (b.startDate = "2026-10-12T00:00:00Z")],
    ["startDate is null", (b) => void (b.startDate = null)],
    ["settledOn met maand 13", (b) => void (b.settledOn = "2026-13-01")],
    ["settledOn ontbreekt (null mag, weglaten niet)", (b) => void delete b.settledOn],
    ["publishedOn ontbreekt", (b) => void delete b.publishedOn],
    ["publishedOn is null", (b) => void (b.publishedOn = null)],
    ["lustrum is tekst", (b) => void (b.lustrum = "true")],
    ["costPerPerson is een kommagetal", (b) => void (b.costPerPerson = 2352.62)],
    ["costPerPerson is tekst", (b) => void (b.costPerPerson = "235262")],
    ["parts is geen lijst", (b) => void (b.parts = {})],
    ["rows is geen lijst", (b) => void (b.rows = {})],
    ["totals ontbreekt", (b) => void delete b.totals],
  ];
  for (const [label, mutate] of cases) {
    it(`${label}: 400, niets veranderd`, async () => {
      await expectRejected(lustrum, mutate);
    });
  }
});

describe("A2: bedragen zijn hele centen", () => {
  const cases: Array<[string, Mutate]> = [
    ["een kommagetal in een regel", (b) => void ((row0(b).lines as R[])[0]!.amount = 912.4)],
    ["tekst in een betaling", (b) => void ((row0(b).payments as R[])[0]!.amount = "302.34")],
    ["tekst bij de kosten van een onderdeel", (b) => void ((b.parts as R[])[0]!.costs = "7299.20")],
    ["een kommagetal in een cel", (b) => void ((row0(b).cells as unknown[])[0] = 912.4)],
    ["tekst in een cel", (b) => void ((row0(b).cells as unknown[])[0] = "912.40")],
    ["een kommagetal in de spaarpot", (b) => void ((row0(b).savings as R[])[0]!.amount = 0.5)],
    ["een kommagetal bij een maand", (b) => void (((row0(b).savings as R[])[1]!.months as R[])[0]!.amount = 35.0001)],
    ["meer dan 1 000 000 000 centen", (b) => void ((row0(b).lines as R[])[0]!.amount = 1_000_000_001)],
    ["minder dan -1 000 000 000 centen", (b) => void ((row0(b).lines as R[])[0]!.amount = -1_000_000_001)],
    ["pricePerPerson is een kommagetal", (b) => void ((b.parts as R[])[0]!.pricePerPerson = 912.4)],
    [
      "open is negatief (met kloppend totaal)",
      (b) => {
        row0(b).open = -1;
        return withTotals(b);
      },
    ],
    ["count is een kommagetal", (b) => void ((b.parts as R[])[0]!.count = 2.5)],
    ["count is negatief", (b) => void ((b.parts as R[])[0]!.count = -1)],
    ["count is groter dan 1000", (b) => void ((b.parts as R[])[0]!.count = 1001)],
  ];
  for (const [label, mutate] of cases) {
    it(`${label}: 400`, async () => {
      await expectRejected(lustrum, mutate);
    });
  }

  it("precies 1 000 000 000 en -1 000 000 000 centen in een regel mogen", async () => {
    const b = lustrum();
    (row0(b).lines as R[])[0]!.amount = 1_000_000_000;
    (row0(b).lines as R[])[1]!.amount = -1_000_000_000;
    await expectAccepted(b);
  });

  it("null mag waar het contract het toestaat (settledOn, costPerPerson, prijs, cel, months)", async () => {
    const b = lustrum();
    b.settledOn = null;
    b.costPerPerson = null;
    (b.parts as R[])[0]!.pricePerPerson = null;
    (row0(b).cells as unknown[])[3] = null;
    (row0(b).savings as R[])[1]!.months = null;
    await expectAccepted(b);
  });

  it("een lege periode en een lege grondslag mogen", async () => {
    const b = lustrum();
    b.period = "";
    (row0(b).lines as R[])[0]!.basis = "";
    await expectAccepted(b);
  });
});

describe("A-invariant 3: een veld buiten het contract, waar ook", () => {
  const cases: Array<[string, Mutate]> = [
    ["groupId bovenaan", (b) => void (b.groupId = "g")],
    ["lid_id in een rij", (b) => void (row0(b).lid_id = 3)],
    ["telwijze bij een onderdeel", (b) => void ((b.parts as R[])[0]!.telwijze = "vinkje")],
    ["pot in de totalen (clubboek-naam)", (b) => void ((b.totals as R).pot = 0)],
    ["onderdeel in een regel (clubboek-naam)", (b) => void ((row0(b).lines as R[])[0]!.onderdeel = "Vluchten")],
    ["post bij een betaling", (b) => void ((row0(b).payments as R[])[0]!.post = 4711)],
    ["maanden in de spaarpot (clubboek-naam)", (b) => void ((row0(b).savings as R[])[1]!.maanden = [])],
    ["datum bij een maand (clubboek-naam)", (b) => void (((row0(b).savings as R[])[1]!.months as R[])[0]!.datum = "2026-01-05")],
    ["afgerond in een rij (afgeleid, niet meesturen)", (b) => void (row0(b).afgerond = true)],
  ];
  for (const [label, mutate] of cases) {
    it(`${label}: 400`, async () => {
      await expectRejected(lustrum, mutate);
    });
  }

  it("de fout noemt geen waarde uit de body", async () => {
    const marker = "MARKER-Zq7-niet-terugsturen";
    const text = await expectRejected(lustrum, (b) => void (row0(b).notitie = marker));
    expect(text).not.toContain(marker);
    const parsed = JSON.parse(text) as R;
    expect(typeof parsed.error).toBe("string");
  });

  it("de fout bij een te lange naam noemt de naam niet", async () => {
    const marker = `Z${pad(200, "q")}`;
    const text = await expectRejected(lustrum, (b) => void (b.name = marker));
    expect(text).not.toContain(marker.slice(0, 40));
  });
});

describe("A2: samenhang", () => {
  const cases: Array<[string, () => R, Mutate]> = [
    ["nul deelnemers", lustrum, (b) => withTotals({ ...b, rows: [] })],
    ["een cel te weinig", lustrum, (b) => void (row0(b).cells as unknown[]).pop()],
    ["een cel te veel", lustrum, (b) => void (row0(b).cells as unknown[]).push(null)],
    ["twee deelnemers met dezelfde naam", lustrum, (b) => void ((b.rows as R[])[1]!.name = "Bram")],
    ["lustrum met potBefore null in een rij", lustrum, (b) => void (row0(b).potBefore = null)],
    ["lustrum met potAfter null in de totalen", lustrum, (b) => void ((b.totals as R).potAfter = null)],
    ["lustrum zonder potBefore in een rij", lustrum, (b) => void delete row0(b).potBefore],
    ["geen lustrum, wel potBefore in een rij", weekend, (b) => void (row0(b).potBefore = 0)],
    ["geen lustrum, wel potAfter in de totalen", weekend, (b) => void ((b.totals as R).potAfter = 0)],
    [
      "geen lustrum, wel een spaarpot",
      weekend,
      (b) => void (row0(b).savings = [{ date: "2026-01-01", description: "Saldo", amount: 0, months: null }]),
    ],
    ["totals.costs een cent te hoog", lustrum, (b) => void ((b.totals as R).costs += 1)],
    ["totals.balance een cent te laag", lustrum, (b) => void ((b.totals as R).balance -= 1)],
    ["totals.open klopt niet", weekend, (b) => void ((b.totals as R).open = 0)],
    ["totals.club klopt niet", weekend, (b) => void ((b.totals as R).club = 0)],
    ["totals.advanced klopt niet", weekend, (b) => void ((b.totals as R).advanced = 0)],
    ["totals.fromPot klopt niet", lustrum, (b) => void ((b.totals as R).fromPot += 100)],
    ["totals.potBefore klopt niet", lustrum, (b) => void ((b.totals as R).potBefore -= 100)],
    ["totals.potAfter klopt niet", lustrum, (b) => void ((b.totals as R).potAfter += 1)],
  ];
  for (const [label, base, mutate] of cases) {
    it(`${label}: 400`, async () => {
      await expectRejected(base, mutate);
    });
  }

  it("geen onderdelen (club betaalt alles) mag, met lege cellen", async () => {
    const b = weekend();
    b.parts = [];
    for (const r of b.rows as R[]) r.cells = [];
    await expectAccepted(b);
  });
});

// --- grenzen ------------------------------------------------------------------------

function weekendRow(i: number): R {
  const r = { ...row0(weekend()) };
  r.name = `Deelnemer ${i}`;
  r.lines = [];
  r.payments = [];
  return r;
}

describe("A3: aantallen", () => {
  it("100 deelnemers mag", async () => {
    const b = weekend();
    b.rows = Array.from({ length: 100 }, (_, i) => weekendRow(i));
    await expectAccepted(withTotals(b));
  });

  it("101 deelnemers: 400", async () => {
    await expectRejected(weekend, (b) => {
      b.rows = Array.from({ length: 101 }, (_, i) => weekendRow(i));
      return withTotals(b);
    });
  });

  it("50 onderdelen mag; 51: 400", async () => {
    const make = (n: number) => (b: R) => {
      b.parts = Array.from({ length: n }, (_, i) => ({ name: `Onderdeel ${i}`, costs: 0, count: 0, pricePerPerson: null }));
      for (const r of b.rows as R[]) r.cells = Array.from({ length: n }, () => null);
      return b;
    };
    await expectAccepted(make(50)(weekend()) as R);
    await expectRejected(weekend, make(51));
  });

  const lists: Array<[string, number, (b: R, n: number) => void]> = [
    ["regels (lines)", 50, (b, n) => (row0(b).lines = Array.from({ length: n }, () => ({ part: "Huisje", amount: 0, basis: "" })))],
    ["betalingen", 50, (b, n) => (row0(b).payments = Array.from({ length: n }, () => ({ date: "2026-06-18", amount: 0 })))],
    [
      "spaarpotregels",
      100,
      (b, n) =>
        (row0(b).savings = Array.from({ length: n }, () => ({ date: "2026-01-01", description: "Storting", amount: 0, months: null }))),
    ],
    [
      "maanden in één spaarpotregel",
      60,
      (b, n) =>
        ((row0(b).savings as R[])[1]!.months = Array.from({ length: n }, () => ({ date: "2026-01-05", amount: 0 }))),
    ],
  ];
  for (const [label, max, fill] of lists) {
    const base = label.includes("spaarpot") || label.includes("maanden") ? lustrum : weekend;
    it(`${label}: ${max} mag, ${max + 1} niet`, async () => {
      const ok = base();
      fill(ok, max);
      await expectAccepted(ok);
      await expectRejected(base, (b) => fill(b, max + 1));
    });
  }

  const texts: Array<[string, (b: R, s: string) => void]> = [
    ["naam van een onderdeel", (b, s) => ((b.parts as R[])[0]!.name = s)],
    ["naam van een deelnemer", (b, s) => (row0(b).name = s)],
    ["grondslag", (b, s) => ((row0(b).lines as R[])[0]!.basis = s)],
    ["onderdeel van een regel", (b, s) => ((row0(b).lines as R[])[0]!.part = s)],
    ["omschrijving in de spaarpot", (b, s) => ((row0(b).savings as R[])[0]!.description = s)],
  ];
  for (const [label, set] of texts) {
    it(`${label}: 200 tekens mag, 201 niet`, async () => {
      const ok = lustrum();
      set(ok, pad(200));
      await expectAccepted(ok);
      await expectRejected(lustrum, (b) => set(b, pad(201)));
    });
  }

  it("lege naam van een onderdeel of deelnemer: 400", async () => {
    await expectRejected(lustrum, (b) => void ((b.parts as R[])[0]!.name = ""));
    await expectRejected(lustrum, (b) => void (row0(b).name = ""));
  });

  it("datums in betalingen, spaarpot en maanden moeten echte datums zijn", async () => {
    await expectRejected(lustrum, (b) => void ((row0(b).payments as R[])[0]!.date = "2026-11-31"));
    await expectRejected(lustrum, (b) => void ((row0(b).savings as R[])[0]!.date = "1-1-2026"));
    await expectRejected(lustrum, (b) => void (((row0(b).savings as R[])[1]!.months as R[])[0]!.date = "2026-01-5"));
  });
});

// --- fix-cyclus 1 -----------------------------------------------------------------

describe("F2: teksten zijn nette Unicode, zonder control- of bidi-tekens", () => {
  const cases: Array<[string, Mutate]> = [
    ["naam van de afrekening met een losse hoge surrogaathelft", (b) => void (b.name = "Ab\ud800")],
    ["periode met een losse lage surrogaathelft", (b) => void (b.period = "\udc00 oktober")],
    ["naam van een deelnemer met een omgedraaid surrogaatpaar", (b) => void (row0(b).name = "Br\udc00\ud800am")],
    ["onderdeel met een nul-byte", (b) => void ((b.parts as R[])[0]!.name = "Vlucht\u0000en")],
    ["grondslag met een bel-teken", (b) => void ((row0(b).lines as R[])[0]!.basis = "7.299,20 / 8\u0007")],
    ["omschrijving in de spaarpot met een regeleinde", (b) => void ((row0(b).savings as R[])[0]!.description = "Saldo\nextra")],
    ["omschrijving in de spaarpot met een tab", (b) => void ((row0(b).savings as R[])[0]!.description = "Saldo\t1-1")],
    ["periode met een C1-teken (U+0085)", (b) => void (b.period = "12 t/m 26\u0085 oktober")],
    ["onderdeel met DEL (U+007F)", (b) => void ((b.parts as R[])[1]!.name = "Hotels\u007f")],
    ["naam van een deelnemer met right-to-left override (U+202E)", (b) => void (row0(b).name = "‮Bram")],
    ["onderdeel van een regel met pop directional formatting (U+202C)", (b) => void ((row0(b).lines as R[])[0]!.part = "Vluchten‬")],
    ["grondslag met een isolate (U+2066 … U+2069)", (b) => void ((row0(b).lines as R[])[0]!.basis = "⁦x⁩")],
    ["naam van de afrekening met first strong isolate (U+2068)", (b) => void (b.name = "Lustrum⁨")],
  ];
  for (const [label, mutate] of cases) {
    it(`${label}: 400`, async () => {
      await expectRejected(lustrum, mutate);
    });
  }

  it("gewone tekens buiten ASCII, een emoji en een apostrof mogen", async () => {
    const b = lustrum();
    b.name = "Lustrum Nepal 🏔️";
    b.period = "12 t/m 26 oktober 2026 — Kathmandu";
    row0(b).name = "Zoë";
    (b.rows as R[])[1]!.name = "D'Arcy";
    (row0(b).lines as R[])[0]!.basis = "7.299,20 / 8 · ½";
    await expectAccepted(b);
  });
});

describe("F2: namen van deelnemers (ze staan in de app-route)", () => {
  const cases: Array<[string, Mutate]> = [
    ["spatie vooraan", (b) => void (row0(b).name = " Bram")],
    ["spatie achteraan", (b) => void (row0(b).name = "Bram ")],
    ["harde spatie achteraan", (b) => void (row0(b).name = "Bram ")],
    ["alleen een punt", (b) => void (row0(b).name = ".")],
    ["twee punten", (b) => void (row0(b).name = "..")],
    ["drie punten", (b) => void (row0(b).name = "...")],
    ["een procentteken", (b) => void (row0(b).name = "Bram%20")],
    ["een schuine streep", (b) => void (row0(b).name = "Bram/Daan")],
    ["alleen witruimte", (b) => void (row0(b).name = "   ")],
    ["dubbel na NFC (é los en samengesteld)", (b) => {
      row0(b).name = "José";
      (b.rows as R[])[1]!.name = "José";
    }],
    ["dubbel zonder onderscheid in hoofdletters (A-keuze 12)", (b) => void ((b.rows as R[])[1]!.name = "bram")],
  ];
  for (const [label, mutate] of cases) {
    it(`${label}: 400`, async () => {
      await expectRejected(lustrum, mutate);
    });
  }

  it("een spatie of punt binnenin mag", async () => {
    const b = lustrum();
    row0(b).name = "Jan Willem";
    (b.rows as R[])[1]!.name = "J.P.";
    (b.rows as R[])[2]!.name = "José";
    await expectAccepted(b);
  });
});

describe("F3: betalingen alleen bij wie moet bijbetalen", () => {
  const rowOf = (b: R, name: string): R => (b.rows as R[]).find((r) => r.name === name)!;

  it("wie terugkrijgt (balance < 0) met een betaling: 400", async () => {
    await expectRejected(weekend, (b) => void (rowOf(b, "Daan").payments = [{ date: "2026-06-21", amount: 13000 }]));
  });

  it("wie terugkrijgt en al deels is uitbetaald (Ruud) heeft geen betalingen; zo wordt het aangenomen", async () => {
    const b = weekend();
    const ruud = rowOf(b, "Ruud");
    expect([ruud.balance, ruud.open, ruud.payments]).toEqual([-20000, 5000, []]);
    await expectAccepted(b);
  });

  it("wie niets af te rekenen heeft (balance 0) met een betaling: 400", async () => {
    await expectRejected(lustrum, (b) => void (rowOf(b, "Joris").payments = [{ date: "2026-11-20", amount: 100 }]));
  });

  it("wie bijbetaalt mag betalingen hebben (Sander, twee keer)", async () => {
    const b = lustrum();
    expect((rowOf(b, "Sander").payments as R[]).length).toBe(2);
    await expectAccepted(b);
  });
});

describe("F4: eerst de grootte, dan de vorm", () => {
  it("te groot én kapot: 413, niet 400", async () => {
    await expectRejected(lustrum, () => `{ "key": "17", ${" ".repeat(MAX_BODY_BYTES)}`, 413);
  });
});

describe("F9: een onbekend veld noemt alleen het pad", () => {
  it("rows[0]: onbekend veld, zonder de naam van het veld", async () => {
    const text = await expectRejected(lustrum, (b) => void (row0(b).VELDNAAM_UIT_DE_BODY = 1));
    expect(text).not.toContain("VELDNAAM_UIT_DE_BODY");
    expect((JSON.parse(text) as R).error).toBe("rows[0]: onbekend veld");
  });

  it("bovenaan: body: onbekend veld", async () => {
    const text = await expectRejected(lustrum, (b) => void (b.VELDNAAM_UIT_DE_BODY = 1));
    expect((JSON.parse(text) as R).error).toBe("body: onbekend veld");
  });
});
