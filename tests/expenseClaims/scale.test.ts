import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { modules } from "../_helpers/modules";
import { registerUser, withUser } from "../_helpers/auth";
import { deleteAccount } from "../_helpers/deleteAccount";
import { claimRows, configureClaims, getClaims, read, useClaimsEnv, type R, type T } from "./_claims";

// WP45 fix-cyclus 1, F2 — de grootste last binnen de grenzen van één
// Convex-functie. Door F1 heeft een lid ten hoogste 200 declaraties die geen
// concept zijn, plus 20 concepten. Bij 16 leden: 3200 + 320.
//
// convex-test dwingt hier de echte Convex-limieten af (`transactionLimits`),
// zoals tests/groups/fixScale.test.ts. Zonder die optie valt een te dure
// functie in de tests niet op.
//
// De rijen gaan rechtstreeks in de tabel (via de API zou dat 160 dagen
// verzenden kosten), met de velden van het schema en `null` voor wat er niet
// is. Statussen gemengd, alle met een verzendtijd.

useClaimsEnv();

const MEMBERS = 16;
const KEPT = 200;
const DRAFTS = 20;
const CHUNK = 400;

const newLimitedT = (): T => convexTest({ schema, modules, transactionLimits: true });

const STATUSES = ["submitted", "processed", "adjusted", "rejected", "withdrawn"] as const;

function keptRow(groupId: Id<"groups">, memberId: Id<"users">, i: number, now: number): R {
  const status = i < 20 ? "submitted" : STATUSES[1 + (i % 4)]!;
  const decided = status !== "submitted";
  const amountCents = 1000 + i;
  return {
    groupId,
    memberId,
    title: `Declaratie ${i + 1} met een titel van redelijke lengte`,
    expenseDate: "2026-11-01",
    amountCents,
    status,
    submittedAt: now - (KEPT - i) * 60_000,
    processedCents: status === "processed" ? amountCents : status === "adjusted" ? amountCents - 1 : null,
    note: decided ? "Toelichting van de penningmeester, ook met een tweede regel\nzoals hier." : null,
    decidedAt: decided ? now - 1000 : null,
    withdrawnAt: status === "withdrawn" ? now - 500 : null,
    revision: decided ? 3 : 2,
  };
}

function draftRow(groupId: Id<"groups">, memberId: Id<"users">, i: number): R {
  return {
    groupId,
    memberId,
    title: `Concept ${i + 1}`,
    expenseDate: "2026-11-01",
    amountCents: 500,
    status: "draft",
    submittedAt: null,
    processedCents: null,
    note: null,
    decidedAt: null,
    withdrawnAt: null,
    revision: 1,
  };
}

async function bigWorld(t: T) {
  const members: Array<Id<"users">> = [];
  for (let m = 0; m < MEMBERS; m++) {
    members.push(await registerUser(t, `user_m${m}`, `m${m}@x.com`, `Lid ${m}`));
  }
  const groupId = await t.run(async (ctx) => {
    const now = Date.now();
    const g = await ctx.db.insert("groups", { name: "De Heeren", createdBy: members[0]!, createdAt: now });
    for (let m = 0; m < MEMBERS; m++) {
      await ctx.db.insert("memberships", {
        userId: members[m]!,
        groupId: g,
        role: m === 0 ? "admin" : "member",
        joinedAt: now + m,
      });
    }
    return g;
  });
  configureClaims(groupId);

  const rows: R[] = [];
  const now = Date.now();
  for (const memberId of members) {
    for (let i = 0; i < KEPT; i++) rows.push(keptRow(groupId, memberId, i, now));
    for (let i = 0; i < DRAFTS; i++) rows.push(draftRow(groupId, memberId, i));
  }
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    await t.run(async (ctx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of chunk) await (ctx.db as any).insert("expenseClaims", row);
    });
  }
  return { groupId, members };
}

describe("F2: de grootste last (16 leden × 200, plus concepten)", () => {
  it("GET /claims geeft 200 met alle 3200, elke naam erbij", async () => {
    const t = newLimitedT();
    await bigWorld(t);
    const { status, body, text } = await read(await getClaims(t));
    expect(status, text.slice(0, 300)).toBe(200);
    const claims = body.claims as R[];
    expect(claims).toHaveLength(MEMBERS * KEPT);
    expect(new Set(claims.map((c) => c.member.name)).size).toBe(MEMBERS);
  }, 120_000);

  it("de groep verwijderen lukt; daarna zijn alle declaraties weg", async () => {
    const t = newLimitedT();
    const { groupId } = await bigWorld(t);
    await withUser(t, "user_m0").mutation(api.groups.remove, { groupId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await claimRows(t)).toEqual([]);
  }, 120_000);

  it("MON1 lukt en is schoon (integrityReport en integrityCheck)", async () => {
    const t = newLimitedT();
    await bigWorld(t);
    expect(await t.query(internal.migration.integrityReport, {})).toEqual([]);
    await t.mutation(internal.monitoring.integrityCheck, {});
  }, 120_000);

  it("een lid verwijdert zijn account: lukt, zijn 220 declaraties weg, de rest blijft", async () => {
    const t = newLimitedT();
    const { members } = await bigWorld(t);
    await deleteAccount(t, withUser(t, "user_m5"));
    const left = await claimRows(t);
    expect(left.filter((r) => r.memberId === members[5])).toEqual([]);
    expect(left).toHaveLength((MEMBERS - 1) * (KEPT + DRAFTS));
  }, 120_000);

  it("een lid vertrekt: lukt, zijn 20 concepten weg, zijn 200 blijven", async () => {
    const t = newLimitedT();
    const { groupId, members } = await bigWorld(t);
    await withUser(t, "user_m7").mutation(api.groups.removeMember, { groupId, userId: members[7]! });
    const his = (await claimRows(t)).filter((r) => r.memberId === members[7]);
    expect(his).toHaveLength(KEPT);
    expect(his.some((r) => r.status === "draft")).toBe(false);
  }, 120_000);
});
