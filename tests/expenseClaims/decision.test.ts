import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  advance,
  as,
  CLAIM_KEYS,
  claimFromGet,
  claimRow,
  claimsApi,
  configureClaims,
  decide,
  decideOk,
  DECISION_MAX_BYTES,
  FIXED_NOW,
  HOUR_MS,
  newDraft,
  newSubmitted,
  newT,
  NOT_FOUND_BODY,
  processClaim,
  purge,
  read,
  reject,
  revisionOf,
  seedWorld,
  snapshot,
  TOO_LARGE_BODY,
  useClaimsEnv,
  type R,
  type T,
} from "./_claims";

// WP45 §A7 — POST /claims/decision. Volgorde:
//   403 (access.test.ts) → 413 → 400 vorm → 404 → 409 withdrawn →
//   400 bedrag tegen de declaratie → 200 zelfde besluit → 409 changed → 200.
// Draft-invariant 7: processed = amountCents, adjusted ≠, rejected null.
// Besluit 9: toelichting zonder stuurtekens, wel een regeleinde; leeg wordt null.
// A-keuze 5, 6, 12. Bij elke 4xx verandert er niets.

useClaimsEnv();

/** alice heeft een verzonden declaratie van € 42,50 (revision 2). */
async function world(t: T) {
  const w = await seedWorld(t);
  const id = await newSubmitted(as.alice(t), w.groups.club);
  return { w, id };
}

function body(id: string, over: R = {}): R {
  return { id, status: "processed", processedCents: 4250, note: null, revision: 2, ...over };
}

async function expectInvalid(t: T, payload: unknown, marker?: string): Promise<void> {
  const before = await snapshot(t);
  const { status, body: out, text } = await read(await decide(t, payload));
  expect(status, text).toBe(400);
  expect(out.v).toBe(1);
  expect(out.error).toBe("invalid");
  expect(typeof out.reason).toBe("string");
  expect(Object.keys(out).sort()).toEqual(["error", "reason", "v"]);
  if (marker) expect(text).not.toContain(marker);
  expect(await snapshot(t)).toEqual(before);
}

// --- 413 en 400: de vorm ------------------------------------------------------------

describe("§A7.2: body groter dan 8 KiB", () => {
  it("413 { v: 1, error: too_large }, niets veranderd", async () => {
    const t = newT();
    const { id } = await world(t);
    const before = await snapshot(t);
    const big = JSON.stringify(body(id)).padEnd(DECISION_MAX_BYTES + 1, " ");
    const { status, body: out } = await read(await decide(t, big));
    expect(status).toBe(413);
    expect(out).toEqual(TOO_LARGE_BODY);
    expect(await snapshot(t)).toEqual(before);
  });

  it("precies 8 KiB mag", async () => {
    const t = newT();
    const { id } = await world(t);
    const exact = JSON.stringify(body(id)).padEnd(DECISION_MAX_BYTES, " ");
    expect((await decide(t, exact)).status).toBe(200);
  });

  it("te groot én kapot: 413", async () => {
    const t = newT();
    await world(t);
    const { status } = await read(await decide(t, `{ kapot ${"x".repeat(DECISION_MAX_BYTES)}`));
    expect(status).toBe(413);
  });
});

describe("§A7.3: de vorm (400 met v, error en reason; niets veranderd)", () => {
  const CASES: Array<[string, (id: string) => unknown]> = [
    ["geen JSON", () => "{ kapot"],
    ["een lijst", (id) => [body(id)]],
    ["null", () => "null"],
    ["id ontbreekt", (id) => { const { id: _i, ...rest } = body(id); return rest; }],
    ["status ontbreekt", (id) => { const { status: _s, ...rest } = body(id); return rest; }],
    ["processedCents ontbreekt", (id) => { const { processedCents: _p, ...rest } = body(id); return rest; }],
    ["note ontbreekt", (id) => { const { note: _n, ...rest } = body(id); return rest; }],
    ["revision ontbreekt", (id) => { const { revision: _r, ...rest } = body(id); return rest; }],
    ["een onbekend veld", (id) => ({ ...body(id), extra: 1 })],
    ["een groupId", (id) => ({ ...body(id), groupId: "iets" })],
    ["id is geen tekst", () => body("x", { id: 17 })],
    ["status submitted", (id) => body(id, { status: "submitted" })],
    ["status draft", (id) => body(id, { status: "draft" })],
    ["status withdrawn", (id) => body(id, { status: "withdrawn" })],
    ["status onbekend", (id) => body(id, { status: "paid" })],
    ["processedCents 0", (id) => body(id, { status: "adjusted", processedCents: 0 })],
    ["processedCents negatief", (id) => body(id, { status: "adjusted", processedCents: -5 })],
    ["processedCents een breuk", (id) => body(id, { status: "adjusted", processedCents: 10.5 })],
    ["processedCents boven 1.000.000", (id) => body(id, { status: "adjusted", processedCents: 1_000_001 })],
    ["processedCents als tekst", (id) => body(id, { processedCents: "4250" })],
    ["processed zonder bedrag", (id) => body(id, { processedCents: null })],
    ["adjusted zonder bedrag", (id) => body(id, { status: "adjusted", processedCents: null })],
    ["rejected met een bedrag", (id) => body(id, { status: "rejected", processedCents: 4250 })],
    ["revision 0", (id) => body(id, { revision: 0 })],
    ["revision een breuk", (id) => body(id, { revision: 1.5 })],
    ["revision als tekst", (id) => body(id, { revision: "2" })],
    ["note is geen tekst", (id) => body(id, { note: 12 })],
    ["note van 301 tekens", (id) => body(id, { note: "n".repeat(301) })],
    ["note met een tab", (id) => body(id, { note: "Bon\tontbreekt" })],
    ["note met een losse \\r", (id) => body(id, { note: "Bon\rontbreekt" })],
    ["note met een nul-teken", (id) => body(id, { note: "Bon\u0000" })],
    ["note met U+2028", (id) => body(id, { note: "Bon ontbreekt" })],
    ["note met een bidi-override", (id) => body(id, { note: "Bon‮ontbreekt" })],
    ["note met een losse surrogaathelft", (id) => body(id, { note: "Bon \uDC00" })],
  ];

  for (const [label, make] of CASES) {
    it(label, async () => {
      const t = newT();
      const { id } = await world(t);
      await expectInvalid(t, make(id));
    });
  }

  it("de reden noemt geen waarde uit de body", async () => {
    const t = newT();
    const { id } = await world(t);
    await expectInvalid(t, body(id, { note: "GEHEIMWOORD\u0007" }), "GEHEIMWOORD");
    await expectInvalid(t, { ...body(id), GEHEIMVELD: 1 }, "GEHEIMVELD");
    await expectInvalid(t, body(id, { status: "GEHEIMSTATUS" }), "GEHEIMSTATUS");
  });

  it("vorm vóór 404: een onbekend id met een kapotte vorm is 400", async () => {
    const t = newT();
    await world(t);
    await expectInvalid(t, body("onbekend", { revision: 0 }));
  });
});

// --- 404 ----------------------------------------------------------------------------

describe("§A7.4: geen declaratie van de groep, of een draft: één 404", () => {
  it("onbekend, opgeruimd, een id van een andere tabel, geen id, een draft, een andere groep: byte voor byte gelijk", async () => {
    const t = newT();
    const { w, id } = await world(t);
    const draft = await newDraft(as.alice(t), w.groups.club, { title: "Concept" });
    const purged = await newSubmitted(as.bob(t), w.groups.club, { title: "Opgeruimd" });
    const rev = await processClaim(t, purged);
    expect((await purge(t, { claims: [{ id: purged, revision: rev }] })).status).toBe(200);
    configureClaims(w.groups.other);
    const elsewhere = await newSubmitted(as.dave(t), w.groups.other, { title: "Elders" });
    configureClaims(w.groups.club);

    const before = await snapshot(t);
    const texts = new Set<string>();
    for (const target of [purged, w.users.alice, w.groups.club, "onbekend", "", draft, elsewhere]) {
      const res = await decide(t, body(target, { revision: 1 }));
      const { status, body: out, text } = await read(res);
      expect(status, `${target}: ${text}`).toBe(404);
      expect(out).toEqual(NOT_FOUND_BODY);
      texts.add(text);
    }
    expect([...texts]).toHaveLength(1);
    expect(await snapshot(t)).toEqual(before);
    expect(await revisionOf(t, id)).toBe(2);
  });

  it("een draft met een bedrag dat niet klopt: 404, niet 400", async () => {
    const t = newT();
    const { w } = await world(t);
    const draft = await newDraft(as.alice(t), w.groups.club, { title: "Concept" });
    const { status } = await read(await decide(t, body(draft, { processedCents: 1, revision: 1 })));
    expect(status).toBe(404);
  });
});

// --- 409 withdrawn ----------------------------------------------------------------------

describe("§A7.5: ingetrokken: 409 withdrawn met de declaratie", () => {
  it("ook met de juiste revision; de declaratie staat in de body; niets veranderd", async () => {
    const t = newT();
    const { id } = await world(t);
    advance(HOUR_MS);
    await as.alice(t).mutation(claimsApi.withdraw, { claimId: id });
    const before = await snapshot(t);
    const { status, body: out } = await read(await decide(t, body(id, { revision: 3 })));
    expect(status).toBe(409);
    expect(Object.keys(out).sort()).toEqual(["claim", "error", "v"]);
    expect(out.v).toBe(1);
    expect(out.error).toBe("withdrawn");
    expect(Object.keys(out.claim).sort()).toEqual(CLAIM_KEYS);
    expect(out.claim).toMatchObject({ id, status: "withdrawn", revision: 3, withdrawnAt: "2026-11-27T12:00:00.000Z" });
    expect(await snapshot(t)).toEqual(before);
  });

  it("ook als het besluit er al precies zo stond (verwerkt, daarna ingetrokken)", async () => {
    const t = newT();
    const { id } = await world(t);
    await processClaim(t, id);
    await as.alice(t).mutation(claimsApi.withdraw, { claimId: id });
    const { status, body: out } = await read(await decide(t, body(id, { revision: 3 })));
    expect(status).toBe(409);
    expect(out.error).toBe("withdrawn");
    expect(out.claim).toMatchObject({ status: "withdrawn", processedCents: 4250, revision: 4 });
  });

  it("409 withdrawn gaat vóór de controle van het bedrag", async () => {
    const t = newT();
    const { id } = await world(t);
    await as.alice(t).mutation(claimsApi.withdraw, { claimId: id });
    const { status, body: out } = await read(await decide(t, body(id, { processedCents: 1, revision: 3 })));
    expect(status).toBe(409);
    expect(out.error).toBe("withdrawn");
  });
});

// --- 400 bedrag tegen de declaratie ---------------------------------------------------

describe("§A7.6 en draft-invariant 7: het bedrag tegen de declaratie", () => {
  it("processed met een ander bedrag dan gedeclareerd: 400", async () => {
    const t = newT();
    const { id } = await world(t);
    await expectInvalid(t, body(id, { processedCents: 4000 }));
  });

  it("adjusted met hetzelfde bedrag als gedeclareerd: 400", async () => {
    const t = newT();
    const { id } = await world(t);
    await expectInvalid(t, body(id, { status: "adjusted", processedCents: 4250 }));
  });

  it("adjusted mag hoger of lager dan gedeclareerd", async () => {
    const t = newT();
    const { w, id } = await world(t);
    await decideOk(t, body(id, { status: "adjusted", processedCents: 4000 }));
    const higher = await newSubmitted(as.bob(t), w.groups.club, { title: "Hoger" });
    await decideOk(t, body(higher, { status: "adjusted", processedCents: 5000 }));
    expect((await claimRow(t, higher))!.processedCents).toBe(5000);
  });

  it("de 400 op het bedrag gaat vóór 409 changed (een verouderde revision met een fout bedrag)", async () => {
    const t = newT();
    const { id } = await world(t);
    await expectInvalid(t, body(id, { processedCents: 4000, revision: 1 }));
  });
});

// --- opslaan, hetzelfde besluit, 409 changed ------------------------------------------

describe("§A7.9: opslaan", () => {
  it("processed: status, processedCents, note, decidedAt nu, revision +1; 200 { v, ok, revision }", async () => {
    const t = newT();
    const { w, id } = await world(t);
    advance(HOUR_MS);
    const { status, body: out } = await read(await decide(t, body(id, { note: "Prima" })));
    expect(status).toBe(200);
    expect(out).toEqual({ v: 1, ok: true, revision: 3 });
    expect(await claimRow(t, id)).toMatchObject({
      status: "processed",
      processedCents: 4250,
      note: "Prima",
      decidedAt: FIXED_NOW + HOUR_MS,
      revision: 3,
    });
    const mine = await as.alice(t).query(claimsApi.listMine, { groupId: w.groups.club });
    expect(mine[0]).toMatchObject({ status: "processed", processedCents: 4250, note: "Prima", decidedAt: FIXED_NOW + HOUR_MS });
  });

  it("herzien: processed → rejected maakt processedCents null en vervangt de toelichting", async () => {
    const t = newT();
    const { id } = await world(t);
    await decideOk(t, body(id, { note: "Prima" }));
    advance(HOUR_MS);
    expect(await decideOk(t, body(id, { status: "rejected", processedCents: null, note: null, revision: 3 }))).toBe(4);
    expect(await claimRow(t, id)).toMatchObject({
      status: "rejected",
      processedCents: null,
      note: null,
      decidedAt: FIXED_NOW + HOUR_MS,
      revision: 4,
    });
  });

  it("herzien: rejected → adjusted", async () => {
    const t = newT();
    const { id } = await world(t);
    await reject(t, id, "Geen bon");
    expect(await decideOk(t, body(id, { status: "adjusted", processedCents: 3000, note: "Bon gevonden", revision: 3 }))).toBe(4);
    expect(await claimFromGet(t, id)).toMatchObject({ status: "adjusted", processedCents: 3000, note: "Bon gevonden" });
  });

  it("besluit 3: een declaratie van een lid dat vertrok, kan het clubboek nog besluiten", async () => {
    const t = newT();
    const { w } = await world(t);
    const id = await newSubmitted(as.erik(t), w.groups.club, { title: "Van erik" });
    await as.erik(t).mutation(api.groups.removeMember, { groupId: w.groups.club, userId: w.users.erik });
    expect(await decideOk(t, body(id))).toBe(3);
  });
});

describe("§A7.7: staat het besluit er al precies zo, dan 200 zonder wijziging", () => {
  it("dezelfde aanroep nog eens: 200 met de huidige revision, niets veranderd (ook decidedAt niet)", async () => {
    const t = newT();
    const { id } = await world(t);
    await decideOk(t, body(id, { note: "Prima" }));
    const before = await snapshot(t);
    advance(HOUR_MS);
    const { status, body: out } = await read(await decide(t, body(id, { note: "Prima" })));
    expect(status).toBe(200);
    expect(out).toEqual({ v: 1, ok: true, revision: 3 });
    expect(await snapshot(t)).toEqual(before);
  });

  it("ook met een hogere revision", async () => {
    const t = newT();
    const { id } = await world(t);
    await decideOk(t, body(id));
    const { status, body: out } = await read(await decide(t, body(id, { revision: 99 })));
    expect(status).toBe(200);
    expect(out).toEqual({ v: 1, ok: true, revision: 3 });
  });

  it("A-keuze 6: '' en null, rand-witruimte en \\r\\n tegen \\n gelden als dezelfde toelichting", async () => {
    const t = newT();
    const { id } = await world(t);
    await decideOk(t, body(id, { status: "rejected", processedCents: null, note: "Geen bon\nVraag Bob" }));
    const before = await snapshot(t);
    for (const note of ["Geen bon\r\nVraag Bob", "  Geen bon\nVraag Bob \n"]) {
      const { status, body: out } = await read(await decide(t, body(id, { status: "rejected", processedCents: null, note })));
      expect(status).toBe(200);
      expect(out.revision).toBe(3);
    }
    expect(await snapshot(t)).toEqual(before);

    const other = await newSubmitted(as.bob(t), (await claimRow(t, id))!.groupId, { title: "Ander" });
    await decideOk(t, body(other, { note: "" }));
    const again = await read(await decide(t, body(other, { note: null })));
    expect(again.status).toBe(200);
    expect(again.body.revision).toBe(3);
  });

  it("een andere toelichting is een ander besluit (met een oude revision: 409 changed)", async () => {
    const t = newT();
    const { id } = await world(t);
    await decideOk(t, body(id, { note: "Prima" }));
    const { status, body: out } = await read(await decide(t, body(id, { note: "Anders" })));
    expect(status).toBe(409);
    expect(out.error).toBe("changed");
  });
});

describe("§A7.8: revision wijkt af: 409 changed met de declaratie", () => {
  for (const revision of [1, 3, 50]) {
    it(`revision ${revision} tegen 2: 409, niets veranderd`, async () => {
      const t = newT();
      const { id } = await world(t);
      const before = await snapshot(t);
      const { status, body: out } = await read(await decide(t, body(id, { revision })));
      expect(status).toBe(409);
      expect(Object.keys(out).sort()).toEqual(["claim", "error", "v"]);
      expect(out).toMatchObject({ v: 1, error: "changed" });
      expect(Object.keys(out.claim).sort()).toEqual(CLAIM_KEYS);
      expect(out.claim).toMatchObject({ id, status: "submitted", revision: 2 });
      expect(await snapshot(t)).toEqual(before);
    });
  }

  it("de claim in de 409 is precies het element uit GET /claims", async () => {
    const t = newT();
    const { id } = await world(t);
    await decideOk(t, body(id, { note: "Prima" }));
    const { body: out } = await read(await decide(t, body(id, { status: "rejected", processedCents: null })));
    expect(out.claim).toEqual(await claimFromGet(t, id));
  });
});

describe("§A1.14: besluit en intrekken kruisen", () => {
  it("eerst intrekken, dan het besluit: 409 withdrawn", async () => {
    const t = newT();
    const { id } = await world(t);
    await as.alice(t).mutation(claimsApi.withdraw, { claimId: id });
    const { status, body: out } = await read(await decide(t, body(id)));
    expect(status).toBe(409);
    expect(out.error).toBe("withdrawn");
  });

  it("eerst het besluit, dan intrekken: ingetrokken, het besluit blijft staan", async () => {
    const t = newT();
    const { id } = await world(t);
    await decideOk(t, body(id));
    await as.alice(t).mutation(claimsApi.withdraw, { claimId: id });
    expect(await claimFromGet(t, id)).toMatchObject({ status: "withdrawn", processedCents: 4250, revision: 4 });
  });
});

describe("besluit 9 en A-keuze 6: de toelichting", () => {
  it("een regeleinde mag; \\r\\n wordt \\n; rand-witruimte gaat eraf", async () => {
    const t = newT();
    const { id } = await world(t);
    await decideOk(t, body(id, { note: "  Bon klopt\r\nStatiegeld eraf  " , status: "adjusted", processedCents: 4000 }));
    expect((await claimRow(t, id))!.note).toBe("Bon klopt\nStatiegeld eraf");
    expect((await claimFromGet(t, id))!.note).toBe("Bon klopt\nStatiegeld eraf");
  });

  it("leeg of alleen witruimte wordt null", async () => {
    const t = newT();
    const { w, id } = await world(t);
    await decideOk(t, body(id, { note: "" }));
    expect((await claimRow(t, id))!.note).toBeNull();
    const other = await newSubmitted(as.bob(t), w.groups.club, { title: "Ander" });
    await decideOk(t, body(other, { note: "  \n " }));
    expect((await claimRow(t, other))!.note).toBeNull();
  });

  it("300 tekens mag (ook 300 emoji); een regeleinde telt als één", async () => {
    const t = newT();
    const { w, id } = await world(t);
    await decideOk(t, body(id, { note: "é".repeat(300) }));
    const b = await newSubmitted(as.bob(t), w.groups.club, { title: "B" });
    await decideOk(t, body(b, { note: "🙂".repeat(300) }));
    const c = await newSubmitted(as.erik(t), w.groups.club, { title: "C" });
    await decideOk(t, body(c, { note: `${"a".repeat(149)}\r\n${"b".repeat(150)}` }));
    expect((await claimRow(t, c))!.note).toHaveLength(300);
  });
});
