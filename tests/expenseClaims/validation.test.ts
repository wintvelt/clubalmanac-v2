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
  // Fix-cyclus 1, F3: de tekenregel van namen (convex/lib/names.ts), met de
  // gevallen van de red-team. Alleen onzichtbare tekens is ook ongeldig.
  ["alleen U+200B", { title: "\u200B" }],
  ["U+200B midden in de titel", { title: "Bier\u200Bborrel" }],
  ["alleen U+3164 (Hangul-vulteken)", { title: "\u3164\u3164" }],
  ["alleen U+2800 (braille-blanco)", { title: "\u2800" }],
  ["alleen U+00AD (zachte afbreekstreep)", { title: "\u00AD" }],
  ["U+00AD midden in de titel", { title: "Bier\u00ADborrel" }],
  ["U+2060 (word joiner)", { title: "Bier\u2060borrel" }],
  ["U+200F vooraan", { title: "\u200FBier borrel" }],
  ["U+061C vooraan", { title: "\u061CBier borrel" }],
  ["alleen tag-tekens", { title: "\u{E0041}\u{E0042}" }],
  ["een tag-teken achter de titel", { title: "Bier\u{E0041}" }],
  ["U+FFF9–U+FFFB (interlineaire annotatie)", { title: "Bier\uFFF9a\uFFFAb\uFFFB" }],
  ["een losse ZWJ tussen Latijnse letters", { title: "Bi\u200Der" }],
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

  it("F3: ZWNJ in het Perzisch mag, zoals bij namen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const title = "می\u200Cخواهم";
    const id = await newDraft(as.alice(t), w.groups.club, { title });
    expect((await claimRow(t, id))!.title).toBe(title);
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

  // Fix-cyclus 1, F5: rond de omschakelingen (EU: laatste zondag van maart en
  // oktober, 01:00 UTC). In 2026 zijn dat 29 maart en 25 oktober.
  for (const [label, at, date, ok] of [
    ["oktober, nog zomertijd: 20 okt 22:30 UTC is 21 okt 00:30", Date.UTC(2026, 9, 20, 22, 30), "2026-10-21", true],
    ["oktober, al wintertijd: 25 okt 22:30 UTC is 25 okt 23:30", Date.UTC(2026, 9, 25, 22, 30), "2026-10-26", false],
    ["maart, nog wintertijd: 28 mrt 23:30 UTC is 29 mrt 00:30", Date.UTC(2026, 2, 28, 23, 30), "2026-03-29", true],
    ["maart, al zomertijd: 29 mrt 21:30 UTC is 29 mrt 23:30", Date.UTC(2026, 2, 29, 21, 30), "2026-03-30", false],
    ["maart, al zomertijd: 29 mrt 22:30 UTC is 30 mrt 00:30", Date.UTC(2026, 2, 29, 22, 30), "2026-03-30", true],
  ] as const) {
    it(`F5 ${label}: ${date} ${ok ? "mag" : "is DATE_INVALID"}`, async () => {
      const t = newT();
      const w = await seedWorld(t);
      vi.setSystemTime(at);
      const call = as.alice(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club, { expenseDate: date }));
      if (ok) {
        await call;
        expect(await claimRows(t)).toHaveLength(1);
      } else {
        await expectCode(call, "DATE_INVALID");
        expect(await claimRows(t)).toEqual([]);
      }
    });
  }

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
