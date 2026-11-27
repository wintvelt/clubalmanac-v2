import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { MONITORED_FKS } from "../../convex/monitoring";
import { deleteAccount } from "../_helpers/deleteAccount";
import {
  as,
  claimRows,
  claimsApi,
  newDraft,
  newSubmitted,
  newT,
  processClaim,
  purge,
  seedWorld,
  useClaimsEnv,
  type T,
} from "./_claims";

// WP45 §A11 en WP10 (MON1): expenseClaims.groupId → groups en
// expenseClaims.memberId → users zijn verplichte FK's in de integriteitscheck.
//   - een gewone levensloop laat geen losse verwijzing achter;
//   - een declaratie waarvan de groep of de gebruiker buiten de wis-paden om
//     weg is, wordt gemeld;
//   - gevolg van de opzet (zoals WP41): de migratie-tooling telt en leegt de
//     tabel. De lijst zelf staat ook in tests/migration/fkOracle.ts.

useClaimsEnv();

const report = (t: T) => t.query(internal.migration.integrityReport, {});

describe("MON1: expenseClaims", () => {
  it("groupId en memberId staan als verplichte FK in MONITORED_FKS", () => {
    expect(MONITORED_FKS).toContainEqual({ table: "expenseClaims", field: "groupId", required: true });
    expect(MONITORED_FKS).toContainEqual({ table: "expenseClaims", field: "memberId", required: true });
  });

  it("een gewone levensloop blijft schoon", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const draft = await newDraft(as.alice(t), w.groups.club);
    await as.alice(t).mutation(claimsApi.deleteDraft, { claimId: draft });
    const a = await newSubmitted(as.alice(t), w.groups.club, { title: "A" });
    const rev = await processClaim(t, a);
    await purge(t, { claims: [{ id: a, revision: rev }] });
    const b = await newSubmitted(as.alice(t), w.groups.club, { title: "B" });
    await as.alice(t).mutation(claimsApi.withdraw, { claimId: b });
    await newDraft(as.erik(t), w.groups.club, { title: "Concept erik" });
    await newSubmitted(as.erik(t), w.groups.club, { title: "Verzonden erik" });
    expect(await report(t)).toEqual([]);
    await as.erik(t).mutation(api.groups.removeMember, { groupId: w.groups.club, userId: w.users.erik });
    expect(await report(t)).toEqual([]);
    await deleteAccount(t, as.alice(t));
    expect(await report(t)).toEqual([]);
    await as.bob(t).mutation(api.groups.remove, { groupId: w.groups.club });
    expect(await report(t)).toEqual([]);
    expect(await claimRows(t)).toEqual([]);
  });

  it("een declaratie waarvan de groep weg is, wordt gemeld", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await newSubmitted(as.alice(t), w.groups.club);
    await t.run(async (ctx) => {
      await ctx.db.delete(w.groups.club);
    });
    const lines = await report(t);
    expect(lines.some((l) => l.includes("expenseClaims") && l.includes("groupId")), JSON.stringify(lines)).toBe(true);
  });

  it("een declaratie waarvan de gebruiker weg is, wordt gemeld", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await newSubmitted(as.erik(t), w.groups.club);
    await t.run(async (ctx) => {
      await ctx.db.delete(w.users.erik);
    });
    const lines = await report(t);
    expect(lines.some((l) => l.includes("expenseClaims") && l.includes("memberId")), JSON.stringify(lines)).toBe(true);
  });
});

describe("migratie-tooling: tellen en leegmaken (A1.11)", () => {
  it("tableCounts telt expenseClaims", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await newDraft(as.alice(t), w.groups.club);
    await newSubmitted(as.bob(t), w.groups.club);
    const counts = await t.query(internal.migration.tableCounts, {});
    expect(counts.tables.expenseClaims).toBe(2);
  });

  it("clearTable('expenseClaims') leegt de tabel", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await newDraft(as.alice(t), w.groups.club);
    await newSubmitted(as.bob(t), w.groups.club);
    let remaining = true;
    while (remaining) {
      ({ remaining } = await t.mutation(internal.migration.clearTable, { table: "expenseClaims", limit: 1 }));
    }
    expect(await claimRows(t)).toEqual([]);
  });
});
