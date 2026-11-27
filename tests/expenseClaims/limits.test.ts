import { describe, expect, it } from "vitest";
import {
  advance,
  as,
  claimRow,
  claimRows,
  claimsApi,
  configureClaims,
  DAY_MS,
  draftInput,
  expectCode,
  newDraft,
  newSubmitted,
  newT,
  processClaim,
  purge,
  seedWorld,
  snapshot,
  useClaimsEnv,
  type ClaimId,
  type Client,
} from "./_claims";

// WP45 §A4 en draft-invariant 8 — per lid per groep (besluit 7):
//   20 concepten, 20 submitted, 20 keer verzenden in de laatste 24 uur.
//   Bij de grens een weigering, en er verandert niets.
//   Elk verzenden telt, ook als die declaratie daarna is ingetrokken (A1.15).
//   Fix-cyclus 1, F1: ten hoogste 200 die geen concept zijn (CLAIMS_LIMIT);
//   alleen opruimen maakt plek.

useClaimsEnv();

async function drafts(c: Client, groupId: Parameters<typeof newDraft>[1], n: number): Promise<ClaimId[]> {
  const ids: ClaimId[] = [];
  for (let i = 0; i < n; i++) ids.push(await newDraft(c, groupId, { title: `Concept ${i + 1}` }));
  return ids;
}

async function submitAll(c: Client, ids: ClaimId[]): Promise<void> {
  for (const claimId of ids) await c.mutation(claimsApi.submit, { claimId });
}

async function withdrawAll(c: Client, ids: ClaimId[]): Promise<void> {
  for (const claimId of ids) await c.mutation(claimsApi.withdraw, { claimId });
}

describe("20 concepten", () => {
  it("het 21e nieuwe concept: DRAFT_LIMIT, er komt niets bij", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await drafts(as.alice(t), w.groups.club, 20);
    const before = await snapshot(t);
    await expectCode(as.alice(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club)), "DRAFT_LIMIT");
    expect(await snapshot(t)).toEqual(before);
  });

  it("bij 20 een bestaand concept wijzigen mag", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const ids = await drafts(as.alice(t), w.groups.club, 20);
    await as.alice(t).mutation(claimsApi.saveDraft, draftInput(w.groups.club, { claimId: ids[3]!, title: "Gewijzigd" }));
    expect((await claimRow(t, ids[3]!))!.title).toBe("Gewijzigd");
  });

  it("weggooien of verzenden maakt plek", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const ids = await drafts(as.alice(t), w.groups.club, 20);
    await as.alice(t).mutation(claimsApi.deleteDraft, { claimId: ids[0]! });
    await newDraft(as.alice(t), w.groups.club);
    await as.alice(t).mutation(claimsApi.submit, { claimId: ids[1]! });
    await newDraft(as.alice(t), w.groups.club);
    expect((await claimRows(t)).filter((r) => r.status === "draft")).toHaveLength(20);
  });

  it("per lid: de concepten van alice tellen niet voor bob", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await drafts(as.alice(t), w.groups.club, 20);
    await newDraft(as.bob(t), w.groups.club);
    expect(await claimRows(t)).toHaveLength(21);
  });
});

describe("20 submitted", () => {
  it("verzenden bij 20 submitted: SUBMITTED_LIMIT, het concept blijft een concept", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // Over drie dagen verspreid, zodat de daggrens niet meetelt.
    await submitAll(as.alice(t), await drafts(as.alice(t), w.groups.club, 10));
    advance(DAY_MS + 1000);
    await submitAll(as.alice(t), await drafts(as.alice(t), w.groups.club, 10));
    advance(DAY_MS + 1000);
    const last = await newDraft(as.alice(t), w.groups.club, { title: "Nummer 21" });
    const before = await snapshot(t);
    await expectCode(as.alice(t).mutation(claimsApi.submit, { claimId: last }), "SUBMITTED_LIMIT");
    expect(await snapshot(t)).toEqual(before);
    expect((await claimRow(t, last))!.status).toBe("draft");
  });

  it("een besluit of intrekken maakt plek", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const first = await drafts(as.alice(t), w.groups.club, 10);
    await submitAll(as.alice(t), first);
    advance(DAY_MS + 1000);
    await submitAll(as.alice(t), await drafts(as.alice(t), w.groups.club, 10));
    advance(DAY_MS + 1000);
    const a = await newDraft(as.alice(t), w.groups.club, { title: "Nummer 21" });
    const b = await newDraft(as.alice(t), w.groups.club, { title: "Nummer 22" });
    await processClaim(t, first[0]!);
    await as.alice(t).mutation(claimsApi.submit, { claimId: a });
    await as.alice(t).mutation(claimsApi.withdraw, { claimId: first[1]! });
    await as.alice(t).mutation(claimsApi.submit, { claimId: b });
    expect((await claimRows(t)).filter((r) => r.status === "submitted")).toHaveLength(20);
  });
});

describe("20 keer verzenden in de laatste 24 uur", () => {
  it("de 21e verzending binnen 24 uur: DAILY_SUBMIT_LIMIT, ook als de eerdere zijn ingetrokken", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const ids = await drafts(as.alice(t), w.groups.club, 20);
    await submitAll(as.alice(t), ids);
    await withdrawAll(as.alice(t), ids);
    const next = await newDraft(as.alice(t), w.groups.club, { title: "Nummer 21" });
    const before = await snapshot(t);
    await expectCode(as.alice(t).mutation(claimsApi.submit, { claimId: next }), "DAILY_SUBMIT_LIMIT");
    expect(await snapshot(t)).toEqual(before);

    advance(DAY_MS - 60_000);
    await expectCode(as.alice(t).mutation(claimsApi.submit, { claimId: next }), "DAILY_SUBMIT_LIMIT");

    advance(2 * 60_000);
    await as.alice(t).mutation(claimsApi.submit, { claimId: next });
    expect((await claimRow(t, next))!.status).toBe("submitted");
  });

  it("per lid: alice aan haar grens houdt bob niet tegen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const ids = await drafts(as.alice(t), w.groups.club, 20);
    await submitAll(as.alice(t), ids);
    await withdrawAll(as.alice(t), ids);
    await newSubmitted(as.bob(t), w.groups.club);
    expect((await claimRows(t)).filter((r) => r.status === "submitted")).toHaveLength(1);
  });

  it("besluit 7, per groep: in een andere groep van CLAIMS_GROUP_ID telt alice opnieuw", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const ids = await drafts(as.alice(t), w.groups.club, 20);
    await submitAll(as.alice(t), ids);
    configureClaims(w.groups.other);
    const elsewhere = await newDraft(as.alice(t), w.groups.other);
    await as.alice(t).mutation(claimsApi.submit, { claimId: elsewhere });
    expect((await claimRow(t, elsewhere))!.status).toBe("submitted");
  });

  it("twee verzendingen tegelijk bij 19: nooit meer dan 20 in 24 uur", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const ids = await drafts(as.alice(t), w.groups.club, 19);
    await submitAll(as.alice(t), ids);
    await withdrawAll(as.alice(t), ids);
    const a = await newDraft(as.alice(t), w.groups.club, { title: "A" });
    const b = await newDraft(as.alice(t), w.groups.club, { title: "B" });
    await Promise.allSettled([
      as.alice(t).mutation(claimsApi.submit, { claimId: a }),
      as.alice(t).mutation(claimsApi.submit, { claimId: b }),
    ]);
    const sent = (await claimRows(t)).filter((r) => r.submittedAt !== undefined && r.submittedAt !== null);
    expect(sent).toHaveLength(20);
  });
});

// --- F1: ten hoogste 200 bewaard (fix-cyclus 1, besluit Wouter) ------------------------

/**
 * Brengt alice op `n` ingetrokken declaraties in De Heeren, binnen de andere
 * grenzen: per dag 20 verzenden en meteen intrekken, dan een dag verder.
 */
async function withdrawnClaims(_t: Parameters<typeof claimRows>[0], c: Client, groupId: Parameters<typeof newDraft>[1], n: number): Promise<ClaimId[]> {
  const all: ClaimId[] = [];
  while (all.length < n) {
    const batch = await drafts(c, groupId, Math.min(20, n - all.length));
    await submitAll(c, batch);
    await withdrawAll(c, batch);
    all.push(...batch);
    advance(DAY_MS + 1000);
  }
  return all;
}

describe("F1: ten hoogste 200 die geen concept zijn, per lid per groep", () => {
  it("verzenden bij 200: CLAIMS_LIMIT, er verandert niets; een nieuw concept mag nog wel", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await withdrawnClaims(t, as.alice(t), w.groups.club, 200);
    const next = await newDraft(as.alice(t), w.groups.club, { title: "Nummer 201" });
    const before = await snapshot(t);
    await expectCode(as.alice(t).mutation(claimsApi.submit, { claimId: next }), "CLAIMS_LIMIT");
    expect(await snapshot(t)).toEqual(before);
    expect((await claimRow(t, next))!.status).toBe("draft");
  }, 60_000);

  it("intrekken maakt geen plek; opruimen wel", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const old = await withdrawnClaims(t, as.alice(t), w.groups.club, 199);
    const last = await newSubmitted(as.alice(t), w.groups.club, { title: "Nummer 200" });
    await processClaim(t, last);
    await as.alice(t).mutation(claimsApi.withdraw, { claimId: last });
    const next = await newDraft(as.alice(t), w.groups.club, { title: "Nummer 201" });
    await expectCode(as.alice(t).mutation(claimsApi.submit, { claimId: next }), "CLAIMS_LIMIT");

    const rev = (await claimRow(t, old[0]!))!.revision as number;
    const res = await purge(t, { claims: [{ id: old[0]!, revision: rev }] });
    expect(res.status).toBe(200);
    await as.alice(t).mutation(claimsApi.submit, { claimId: next });
    expect((await claimRow(t, next))!.status).toBe("submitted");
  }, 60_000);

  it("een concept telt niet: 200 bewaard plus 20 concepten kan", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await withdrawnClaims(t, as.alice(t), w.groups.club, 200);
    await drafts(as.alice(t), w.groups.club, 20);
    expect((await claimRows(t)).filter((r) => r.status === "draft")).toHaveLength(20);
  }, 60_000);

  it("per lid: alice op 200 houdt bob niet tegen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await withdrawnClaims(t, as.alice(t), w.groups.club, 200);
    const b = await newSubmitted(as.bob(t), w.groups.club);
    expect((await claimRow(t, b))!.status).toBe("submitted");
  }, 60_000);
});
