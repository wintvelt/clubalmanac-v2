import { describe, expect, it, vi } from "vitest";
import {
  as,
  claimRow,
  claimRows,
  claimsApi,
  draftInput,
  expectCode,
  newDraft,
  newT,
  seedWorld,
  snapshot,
  useClaimsEnv,
  type DraftArgs,
} from "./_claims";

// WP45 §A3 — de invoer van het lid. Besluit 5: een concept is al compleet en
// geldig, dezelfde regels als bij verzenden, ook bij wijzigen. Besluit 6:
// "niet in de toekomst" naar de datum in Nederland; ondergrens 2000-01-01.
// A-keuze 7: titel zonder rand-witruimte, 1–80 codepunten.

useClaimsEnv();

type Case = [label: string, over: Partial<DraftArgs>];

const BAD_TITLES: Case[] = [
  ["lege titel", { title: "" }],
  ["alleen spaties", { title: "    " }],
  ["81 tekens", { title: "a".repeat(81) }],
  ["81 tekens na het weghalen van rand-witruimte", { title: ` ${"b".repeat(81)} ` }],
  ["een regeleinde", { title: "Bier\nborrel" }],
  ["een tab", { title: "Bier\tborrel" }],
  ["een nul-teken", { title: "Bier\u0000" }],
  ["een C1-teken", { title: "Bier\u0085borrel" }],
  ["DEL", { title: "Bier\u007f" }],
  ["U+2028", { title: "Bier borrel" }],
  ["U+2029", { title: "Bier borrel" }],
  ["een bidi-override", { title: "Bier‮borrel" }],
  ["een bidi-isolate", { title: "Bier⁦borrel" }],
  ["een losse surrogaathelft", { title: "Bier \uD83D" }],
];

const BAD_AMOUNTS: Case[] = [
  ["0", { amountCents: 0 }],
  ["negatief", { amountCents: -100 }],
  ["een breuk", { amountCents: 42.5 }],
  ["boven 1.000.000", { amountCents: 1_000_001 }],
  ["NaN", { amountCents: Number.NaN }],
  ["oneindig", { amountCents: Number.POSITIVE_INFINITY }],
];

const BAD_DATES: Case[] = [
  ["leeg", { expenseDate: "" }],
  ["geen ISO-vorm", { expenseDate: "26-11-2026" }],
  ["zonder voorloopnullen", { expenseDate: "2026-1-5" }],
  ["met een tijd erachter", { expenseDate: "2026-11-26T10:00" }],
  ["29 februari in een gewoon jaar", { expenseDate: "2026-02-29" }],
  ["maand 13", { expenseDate: "2026-13-01" }],
  ["dag 0", { expenseDate: "2026-11-00" }],
  ["31 november", { expenseDate: "2026-11-31" }],
  ["vóór 2000-01-01", { expenseDate: "1999-12-31" }],
  ["morgen in Nederland", { expenseDate: "2026-11-28" }],
  ["ver in de toekomst", { expenseDate: "2099-01-01" }],
];

function refusedOnCreate(code: string, cases: Case[]) {
  for (const [label, over] of cases) {
    it(`${code}: ${label}`, async () => {
      const t = newT();
      const w = await seedWorld(t);
      await expectCode(as.alice(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club, over)), code);
      expect(await claimRows(t)).toEqual([]);
    });
  }
}

describe("§A3 titel", () => {
  refusedOnCreate("TITLE_INVALID", BAD_TITLES);

  it("1 teken en 80 tekens mogen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await newDraft(as.alice(t), w.groups.club, { title: "B" });
    await newDraft(as.alice(t), w.groups.club, { title: "c".repeat(80) });
    expect(await claimRows(t)).toHaveLength(2);
  });

  it("A-keuze 7: lengte in codepunten; 80 emoji mogen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newDraft(as.alice(t), w.groups.club, { title: "🍺".repeat(80) });
    expect((await claimRow(t, id))!.title).toBe("🍺".repeat(80));
  });

  it("rand-witruimte gaat eraf", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newDraft(as.alice(t), w.groups.club, { title: "  Bier borrel " });
    expect((await claimRow(t, id))!.title).toBe("Bier borrel");
  });

  it("accenten, leestekens en een emoji met ZWJ mogen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const title = "Café-avond (€) 👨‍👩‍👧";
    const id = await newDraft(as.alice(t), w.groups.club, { title });
    expect((await claimRow(t, id))!.title).toBe(title);
  });
});

describe("§A3 bedrag", () => {
  refusedOnCreate("AMOUNT_INVALID", BAD_AMOUNTS);

  it("1 cent en 1.000.000 cent mogen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await newDraft(as.alice(t), w.groups.club, { amountCents: 1 });
    await newDraft(as.alice(t), w.groups.club, { amountCents: 1_000_000 });
    expect((await claimRows(t)).map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([1, 1_000_000]);
  });
});

describe("§A3 en besluit 6: datum van de uitgave", () => {
  refusedOnCreate("DATE_INVALID", BAD_DATES);

  it("2000-01-01, een schrikkeldag en vandaag in Nederland mogen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    for (const expenseDate of ["2000-01-01", "2024-02-29", "2026-11-27"]) {
      await newDraft(as.alice(t), w.groups.club, { expenseDate });
    }
    expect(await claimRows(t)).toHaveLength(3);
  });

  it("wintertijd: om 00:30 in Nederland (23:30 UTC de dag ervoor) is de Nederlandse datum vandaag", async () => {
    const t = newT();
    const w = await seedWorld(t);
    vi.setSystemTime(Date.UTC(2026, 10, 26, 23, 30)); // 27 nov 00:30 CET
    await newDraft(as.alice(t), w.groups.club, { expenseDate: "2026-11-27" });
    await expectCode(
      as.alice(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club, { expenseDate: "2026-11-28" })),
      "DATE_INVALID",
    );
  });

  it("zomertijd: om 00:30 in Nederland (22:30 UTC de dag ervoor) is de Nederlandse datum vandaag", async () => {
    const t = newT();
    const w = await seedWorld(t);
    vi.setSystemTime(Date.UTC(2026, 5, 30, 22, 30)); // 1 juli 00:30 CEST
    await newDraft(as.alice(t), w.groups.club, { expenseDate: "2026-07-01" });
    await expectCode(
      as.alice(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club, { expenseDate: "2026-07-02" })),
      "DATE_INVALID",
    );
  });

  it("om 23:30 in Nederland is morgen nog in de toekomst (niet een tijdzone ver vooruit)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    vi.setSystemTime(Date.UTC(2026, 10, 27, 22, 30)); // 27 nov 23:30 CET
    await expectCode(
      as.alice(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club, { expenseDate: "2026-11-28" })),
      "DATE_INVALID",
    );
  });
});

describe("besluit 5: dezelfde regels bij wijzigen; een fout laat het concept zoals het was", () => {
  for (const [code, over] of [
    ["TITLE_INVALID", { title: "" }],
    ["AMOUNT_INVALID", { amountCents: 0 }],
    ["DATE_INVALID", { expenseDate: "2026-11-28" }],
  ] as const) {
    it(`${code} bij wijzigen`, async () => {
      const t = newT();
      const w = await seedWorld(t);
      const id = await newDraft(as.alice(t), w.groups.club);
      const before = await snapshot(t);
      await expectCode(
        as.alice(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club, { claimId: id, ...over })),
        code,
      );
      expect(await snapshot(t)).toEqual(before);
    });
  }

  it("een concept zonder titel, datum of bedrag bestaat niet (de velden zijn verplicht)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { title: _t, ...noTitle } = draftInput(w.groups.club);
    await expect(as.alice(t).mutation(claimsApi.saveDraft, noTitle as DraftArgs)).rejects.toBeDefined();
    const { amountCents: _a, ...noAmount } = draftInput(w.groups.club);
    await expect(as.alice(t).mutation(claimsApi.saveDraft, noAmount as DraftArgs)).rejects.toBeDefined();
    expect(await claimRows(t)).toEqual([]);
  });
});
