import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import {
  advance,
  as,
  caught,
  claimFromGet,
  claimRow,
  claimRows,
  claimsApi,
  configureClaims,
  decideOk,
  draftInput,
  expectCode,
  FIXED_NOW,
  MY_CLAIM_KEYS,
  newDraft,
  newSubmitted,
  newT,
  processClaim,
  purge,
  reject,
  revisionOf,
  seedWorld,
  snapshot,
  useClaimsEnv,
  HOUR_MS,
  type ClaimId,
  type Client,
  type DraftArgs,
  type T,
} from "./_claims";

// WP45 §A2 — de functies van het lid.
//   Draft-invariant 1: memberId is de gebruiker van de sessie.
//   Draft-invariant 2: één weigering (NOT_MEMBER) voor elke oorzaak rond een
//     declaratie of groep (ook voor een admin en de webmaster).
//   Draft-invariant 3: alleen eigen declaraties, met een veld-whitelist.
//   Draft-invariant 4: na verzenden alleen nog intrekken (WRONG_STATUS).
//   Draft-invariant 5: intrekken laat het besluit staan.
//   Draft-invariant 6: revision 1, +1 bij elke wijziging.
//   Besluit 1 en A1.5: alleen de groep van CLAIMS_GROUP_ID (CLAIMS_DISABLED),
//     na de lidmaatschapscontrole.

useClaimsEnv();

describe("overgangen van het lid", () => {
  it("saveDraft maakt een concept: revision 1, memberId uit de sessie, in de groep", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newDraft(as.alice(t), w.groups.club);
    const row = await claimRow(t, id);
    expect(row).toMatchObject({
      groupId: w.groups.club,
      memberId: w.users.alice,
      title: "Bier borrel",
      expenseDate: "2026-11-26",
      amountCents: 4250,
      status: "draft",
      revision: 1,
    });
    const mine = await as.alice(t).query(claimsApi.listMine, { groupId: w.groups.club });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toEqual({
      _id: id,
      title: "Bier borrel",
      expenseDate: "2026-11-26",
      amountCents: 4250,
      status: "draft",
      submittedAt: null,
      processedCents: null,
      note: null,
      decidedAt: null,
      withdrawnAt: null,
    });
  });

  it("saveDraft met claimId wijzigt het concept: revision +1, hetzelfde id", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newDraft(as.alice(t), w.groups.club);
    const again = await as
      .alice(t)
      .mutation(claimsApi.saveDraft, draftInput(w.groups.club, { claimId: id, title: "Huur zaal", amountCents: 15000 }));
    expect(again).toBe(id);
    expect(await claimRow(t, id)).toMatchObject({ title: "Huur zaal", amountCents: 15000, status: "draft", revision: 2 });
    expect(await claimRows(t)).toHaveLength(1);
  });

  it("A-keuze 14: ook zonder verschil telt opslaan als wijziging", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newDraft(as.alice(t), w.groups.club);
    await as.alice(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club, { claimId: id }));
    expect(await revisionOf(t, id)).toBe(2);
  });

  it("deleteDraft haalt het concept weg", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newDraft(as.alice(t), w.groups.club);
    const keep = await newDraft(as.alice(t), w.groups.club, { title: "Blijft" });
    await as.alice(t).mutation(claimsApi.deleteDraft, { claimId: id });
    expect((await claimRows(t)).map((r) => r._id)).toEqual([keep]);
  });

  it("submit: submitted, submittedAt nu, revision +1; het clubboek ziet hem", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newDraft(as.alice(t), w.groups.club);
    advance(5 * 60 * 1000);
    await as.alice(t).mutation(claimsApi.submit, { claimId: id });
    expect(await claimRow(t, id)).toMatchObject({ status: "submitted", submittedAt: FIXED_NOW + 5 * 60 * 1000, revision: 2 });
    expect(await claimFromGet(t, id)).toMatchObject({ status: "submitted", revision: 2 });
  });

  it("withdraw vanuit submitted: withdrawn, withdrawnAt nu, revision +1, geen besluit", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newSubmitted(as.alice(t), w.groups.club);
    advance(60_000);
    await as.alice(t).mutation(claimsApi.withdraw, { claimId: id });
    const row = await claimRow(t, id);
    expect(row).toMatchObject({ status: "withdrawn", withdrawnAt: FIXED_NOW + 60_000, revision: 3 });
    const got = await claimFromGet(t, id);
    expect(got).toMatchObject({ status: "withdrawn", processedCents: null, note: null, decidedAt: null, revision: 3 });
  });

  it("invariant 5: intrekken na een besluit laat processedCents, note en decidedAt staan", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newSubmitted(as.alice(t), w.groups.club);
    advance(HOUR_MS);
    await decideOk(t, { id, status: "adjusted", processedCents: 4000, note: "Statiegeld eraf", revision: 2 });
    const decidedAt = FIXED_NOW + HOUR_MS;
    advance(HOUR_MS);
    await as.alice(t).mutation(claimsApi.withdraw, { claimId: id });
    expect(await claimRow(t, id)).toMatchObject({
      status: "withdrawn",
      processedCents: 4000,
      note: "Statiegeld eraf",
      decidedAt,
      withdrawnAt: FIXED_NOW + 2 * HOUR_MS,
      revision: 4,
    });
    const mine = await as.alice(t).query(claimsApi.listMine, { groupId: w.groups.club });
    expect(mine[0]).toMatchObject({ status: "withdrawn", processedCents: 4000, note: "Statiegeld eraf", decidedAt });
  });

  for (const decided of ["processed", "rejected"] as const) {
    it(`intrekken mag ook vanuit ${decided}`, async () => {
      const t = newT();
      const w = await seedWorld(t);
      const id = await newSubmitted(as.alice(t), w.groups.club);
      if (decided === "processed") await processClaim(t, id);
      else await reject(t, id, "Geen clubkosten");
      await as.alice(t).mutation(claimsApi.withdraw, { claimId: id });
      expect(await claimRow(t, id)).toMatchObject({ status: "withdrawn", revision: 4 });
    });
  }

  it("invariant 6: revision 1 → 2 (wijzigen) → 3 (verzenden) → 4 (besluit) → 5 (intrekken)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newDraft(as.alice(t), w.groups.club);
    expect(await revisionOf(t, id)).toBe(1);
    await as.alice(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club, { claimId: id, title: "Anders" }));
    expect(await revisionOf(t, id)).toBe(2);
    await as.alice(t).mutation(claimsApi.submit, { claimId: id });
    expect(await revisionOf(t, id)).toBe(3);
    await processClaim(t, id);
    expect(await revisionOf(t, id)).toBe(4);
    await as.alice(t).mutation(claimsApi.withdraw, { claimId: id });
    expect(await revisionOf(t, id)).toBe(5);
  });
});

// --- WRONG_STATUS --------------------------------------------------------------------

type Setup = (t: T, c: Client, groupId: Parameters<typeof newDraft>[1]) => Promise<ClaimId>;

const IN_STATUS: Record<string, Setup> = {
  draft: (_t, c, g) => newDraft(c, g),
  submitted: (_t, c, g) => newSubmitted(c, g),
  processed: async (t, c, g) => {
    const id = await newSubmitted(c, g);
    await processClaim(t, id);
    return id;
  },
  rejected: async (t, c, g) => {
    const id = await newSubmitted(c, g);
    await reject(t, id);
    return id;
  },
  withdrawn: async (_t, c, g) => {
    const id = await newSubmitted(c, g);
    await c.mutation(claimsApi.withdraw, { claimId: id });
    return id;
  },
};

type Action = { label: string; run: (t: T, c: Client, g: Parameters<typeof newDraft>[1], id: ClaimId) => Promise<unknown> };

const ACTIONS: Record<string, Action> = {
  edit: {
    label: "saveDraft (wijzigen)",
    run: (_t, c, g, id) => c.mutation(claimsApi.saveDraft, draftInput(g, { claimId: id, title: "Anders" })),
  },
  delete: { label: "deleteDraft", run: (_t, c, _g, id) => c.mutation(claimsApi.deleteDraft, { claimId: id }) },
  submit: { label: "submit", run: (_t, c, _g, id) => c.mutation(claimsApi.submit, { claimId: id }) },
  withdraw: { label: "withdraw", run: (_t, c, _g, id) => c.mutation(claimsApi.withdraw, { claimId: id }) },
};

const NOT_ALLOWED_IN: Array<[keyof typeof ACTIONS, string]> = [
  ["edit", "submitted"],
  ["edit", "processed"],
  ["edit", "withdrawn"],
  ["delete", "submitted"],
  ["delete", "rejected"],
  ["delete", "withdrawn"],
  ["submit", "submitted"],
  ["submit", "processed"],
  ["submit", "withdrawn"],
  ["withdraw", "draft"],
  ["withdraw", "withdrawn"],
];

describe("invariant 4 en A-keuze 3: geen andere overgang (WRONG_STATUS, niets verandert)", () => {
  for (const [action, status] of NOT_ALLOWED_IN) {
    it(`${ACTIONS[action]!.label} op een ${status}-declaratie`, async () => {
      const t = newT();
      const w = await seedWorld(t);
      const id = await IN_STATUS[status]!(t, as.alice(t), w.groups.club);
      const before = await snapshot(t);
      await expectCode(ACTIONS[action]!.run(t, as.alice(t), w.groups.club, id), "WRONG_STATUS");
      expect(await snapshot(t)).toEqual(before);
    });
  }
});

// --- één weigering ---------------------------------------------------------------------

/** De data van de fout, als JSON (voor "precies dezelfde weigering"). */
async function refusal(promise: Promise<unknown>): Promise<string> {
  const err = await caught(promise);
  expect(err).toBeInstanceOf(ConvexError);
  return JSON.stringify((err as ConvexError<Record<string, string>>).data);
}

describe("invariant 2: één weigering (NOT_MEMBER) voor elke oorzaak", () => {
  it("de declaratie van een ander, een opgeruimde, een na vertrek, en een niet-lid: allemaal dezelfde", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bobs = await newSubmitted(as.bob(t), w.groups.club);
    const gone = await newDraft(as.alice(t), w.groups.club);
    await as.alice(t).mutation(claimsApi.deleteDraft, { claimId: gone });
    const eriks = await newSubmitted(as.erik(t), w.groups.club);
    await as.erik(t).mutation(api.groups.removeMember, { groupId: w.groups.club, userId: w.users.erik });

    const seen = new Set<string>();
    seen.add(await refusal(as.alice(t).mutation(claimsApi.withdraw, { claimId: bobs })));
    seen.add(await refusal(as.alice(t).mutation(claimsApi.submit, { claimId: gone })));
    seen.add(await refusal(as.erik(t).mutation(claimsApi.withdraw, { claimId: eriks })));
    seen.add(await refusal(as.carol(t).mutation(claimsApi.withdraw, { claimId: bobs })));
    seen.add(await refusal(as.carol(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club))));
    seen.add(await refusal(as.carol(t).query(claimsApi.listMine, { groupId: w.groups.club })));
    seen.add(await refusal(as.wm(t).query(claimsApi.listMine, { groupId: w.groups.club })));
    seen.add(await refusal(as.wm(t).mutation(claimsApi.withdraw, { claimId: bobs })));
    expect([...seen]).toEqual([JSON.stringify({ code: "NOT_MEMBER" })]);
  });

  it("een admin van de groep raakt de declaratie van een lid niet", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const draft = await newDraft(as.alice(t), w.groups.club);
    const sent = await newSubmitted(as.alice(t), w.groups.club, { title: "Verzonden" });
    const before = await snapshot(t);
    await expectCode(as.bob(t).mutation(claimsApi.deleteDraft, { claimId: draft }), "NOT_MEMBER");
    await expectCode(as.bob(t).mutation(claimsApi.submit, { claimId: draft }), "NOT_MEMBER");
    await expectCode(
      as.bob(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club, { claimId: draft, title: "Van bob" })),
      "NOT_MEMBER",
    );
    await expectCode(as.bob(t).mutation(claimsApi.withdraw, { claimId: sent }), "NOT_MEMBER");
    expect(await snapshot(t)).toEqual(before);
    expect(await as.bob(t).query(claimsApi.listMine, { groupId: w.groups.club })).toEqual([]);
  });

  it("saveDraft met een claimId uit een andere groep dan groupId: NOT_MEMBER", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newDraft(as.alice(t), w.groups.club);
    const before = await snapshot(t);
    await expectCode(
      as.alice(t).mutation(claimsApi.saveDraft, draftInput(w.groups.other, { claimId: id })),
      "NOT_MEMBER",
    );
    expect(await snapshot(t)).toEqual(before);
  });

  it("een onbekende groep (verwijderd): NOT_MEMBER", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("groups", { name: "Weg", createdBy: w.users.alice, createdAt: Date.now() });
      await ctx.db.delete(id);
      return id;
    });
    await expectCode(as.alice(t).mutation(claimsApi.saveDraft, draftInput(gone)), "NOT_MEMBER");
    await expectCode(as.alice(t).query(claimsApi.listMine, { groupId: gone }), "NOT_MEMBER");
  });

  it("uitgelogd: een fout, niets geschreven, geen gegevens", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newSubmitted(as.alice(t), w.groups.club);
    const before = await snapshot(t);
    await expect(t.mutation(claimsApi.saveDraft, draftInput(w.groups.club))).rejects.toBeDefined();
    await expect(t.mutation(claimsApi.withdraw, { claimId: id })).rejects.toBeDefined();
    await expect(t.query(claimsApi.listMine, { groupId: w.groups.club })).rejects.toBeDefined();
    expect(await snapshot(t)).toEqual(before);
  });

  it("invariant 1: een memberId in de invoer wordt geweigerd; de eigenaar is altijd de caller", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const sneaky = { ...draftInput(w.groups.club), memberId: w.users.bob } as unknown as DraftArgs;
    await expect(as.alice(t).mutation(claimsApi.saveDraft, sneaky)).rejects.toBeDefined();
    expect(await claimRows(t)).toEqual([]);
    const id = await newDraft(as.alice(t), w.groups.club);
    expect((await claimRow(t, id))!.memberId).toBe(w.users.alice);
  });
});

// --- besluit 1: alleen de groep van CLAIMS_GROUP_ID ----------------------------------

describe("besluit 1 en A1.5: alleen in de groep van CLAIMS_GROUP_ID", () => {
  it("een lid van een andere groep: CLAIMS_DISABLED bij elke functie, niets geschreven", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expectCode(as.alice(t).mutation(claimsApi.saveDraft, draftInput(w.groups.other)), "CLAIMS_DISABLED");
    await expectCode(as.dave(t).mutation(claimsApi.saveDraft, draftInput(w.groups.other)), "CLAIMS_DISABLED");
    await expectCode(as.alice(t).query(claimsApi.listMine, { groupId: w.groups.other }), "CLAIMS_DISABLED");
    expect(await claimRows(t)).toEqual([]);
  });

  for (const [label, set] of [
    ["CLAIMS_GROUP_ID ontbreekt", () => delete process.env.CLAIMS_GROUP_ID],
    ["CLAIMS_GROUP_ID is leeg", () => (process.env.CLAIMS_GROUP_ID = "")],
    ["CLAIMS_GROUP_ID is geen id", () => (process.env.CLAIMS_GROUP_ID = "geen-groep")],
  ] as const) {
    it(`${label}: CLAIMS_DISABLED voor een lid (fail-closed)`, async () => {
      const t = newT();
      const w = await seedWorld(t);
      set();
      await expectCode(as.alice(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club)), "CLAIMS_DISABLED");
      await expectCode(as.alice(t).query(claimsApi.listMine, { groupId: w.groups.club }), "CLAIMS_DISABLED");
      expect(await claimRows(t)).toEqual([]);
    });
  }

  it("CLAIMS_GROUP_ID is het id van een user: CLAIMS_DISABLED", async () => {
    const t = newT();
    const w = await seedWorld(t);
    process.env.CLAIMS_GROUP_ID = w.users.alice;
    await expectCode(as.alice(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club)), "CLAIMS_DISABLED");
  });

  it("wie geen lid is, krijgt altijd NOT_MEMBER, ook als de groep geen declaraties heeft (geen orakel)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expectCode(as.carol(t).mutation(claimsApi.saveDraft, draftInput(w.groups.other)), "NOT_MEMBER");
    await expectCode(as.bob(t).query(claimsApi.listMine, { groupId: w.groups.other }), "NOT_MEMBER");
    delete process.env.CLAIMS_GROUP_ID;
    await expectCode(as.carol(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club)), "NOT_MEMBER");
  });

  it("volgorde: niet-lid met ongeldige invoer is NOT_MEMBER; lid elders met ongeldige invoer is CLAIMS_DISABLED", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bad = draftInput(w.groups.club, { title: "", amountCents: 0, expenseDate: "kapot" });
    await expectCode(as.carol(t).mutation(claimsApi.saveDraft, bad), "NOT_MEMBER");
    await expectCode(as.alice(t).mutation(claimsApi.saveDraft, { ...bad, groupId: w.groups.other }), "CLAIMS_DISABLED");
  });

  it("A1.6: gaat CLAIMS_GROUP_ID naar een andere groep, dan staan de declaraties van de oude groep stil", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const draft = await newDraft(as.alice(t), w.groups.club);
    const sent = await newSubmitted(as.alice(t), w.groups.club, { title: "Verzonden" });
    configureClaims(w.groups.other);
    const before = await snapshot(t);
    await expectCode(as.alice(t).query(claimsApi.listMine, { groupId: w.groups.club }), "CLAIMS_DISABLED");
    await expectCode(as.alice(t).mutation(claimsApi.submit, { claimId: draft }), "CLAIMS_DISABLED");
    await expectCode(as.alice(t).mutation(claimsApi.withdraw, { claimId: sent }), "CLAIMS_DISABLED");
    expect(await snapshot(t)).toEqual(before);
    // In de nieuwe groep kan alice wel declareren.
    await newDraft(as.alice(t), w.groups.other);
    expect(await as.alice(t).query(claimsApi.listMine, { groupId: w.groups.other })).toHaveLength(1);
  });
});

// --- listMine --------------------------------------------------------------------------

describe("invariant 3: listMine, alleen eigen declaraties met een whitelist", () => {
  it("precies de velden van §A2, elke status, nieuwste eerst", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const a = await newSubmitted(as.alice(t), w.groups.club, { title: "Eerste" });
    advance(60_000);
    const b = await newDraft(as.alice(t), w.groups.club, { title: "Tweede" });
    advance(60_000);
    const c = await newSubmitted(as.alice(t), w.groups.club, { title: "Derde" });
    await reject(t, c, "Geen clubkosten");
    await newSubmitted(as.bob(t), w.groups.club, { title: "Van bob" });

    const mine = await as.alice(t).query(claimsApi.listMine, { groupId: w.groups.club });
    expect(mine.map((m) => m._id)).toEqual([c, b, a]);
    for (const m of mine) expect(Object.keys(m).sort()).toEqual(MY_CLAIM_KEYS);
    expect(mine[0]).toMatchObject({ status: "rejected", note: "Geen clubkosten", processedCents: null });
    expect(typeof mine[0]!.decidedAt).toBe("number");
    expect(mine[2]).toMatchObject({ status: "submitted", submittedAt: FIXED_NOW });
  });

  it("een lid zonder declaraties krijgt []", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await newSubmitted(as.alice(t), w.groups.club);
    expect(await as.erik(t).query(claimsApi.listMine, { groupId: w.groups.club })).toEqual([]);
  });

  it("een opgeruimde declaratie verdwijnt zonder uitleg", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newSubmitted(as.alice(t), w.groups.club);
    const rev = await processClaim(t, id);
    expect((await purge(t, { claims: [{ id, revision: rev }] })).status).toBe(200);
    expect(await as.alice(t).query(claimsApi.listMine, { groupId: w.groups.club })).toEqual([]);
  });
});
