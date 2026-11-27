import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  advance,
  as,
  CLAIM_KEYS,
  claimsApi,
  claimsOk,
  configureClaims,
  decideOk,
  FIXED_NOW,
  getClaims,
  HOUR_MS,
  newDraft,
  newSubmitted,
  newT,
  processClaim,
  read,
  reject,
  seedWorld,
  useClaimsEnv,
} from "./_claims";

// WP45 §A6 — GET /claims.
//   Alle declaraties van de groep van CLAIMS_GROUP_ID behalve draft, oudste
//   submittedAt eerst, precies de velden van het contract, "v": 1.
//   Besluit 2: member.id is het id van de gebruiker, member.name zijn
//   profielnaam nu ("" zonder naam of zonder users-rij, A1.12).
//   Draft-invariant 10: een declaratie van een andere groep bestaat niet.
//   A-keuze 8: tijdstippen als ISO 8601 in UTC.

useClaimsEnv();

describe("§A6: de vorm", () => {
  it("geen declaraties: { v: 1, claims: [] }", async () => {
    const t = newT();
    await seedWorld(t);
    const { status, body } = await read(await getClaims(t));
    expect(status).toBe(200);
    expect(body).toEqual({ v: 1, claims: [] });
  });

  it("antwoordt met JSON", async () => {
    const t = newT();
    await seedWorld(t);
    const res = await getClaims(t);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("een verzonden declaratie: precies de velden van het contract", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newSubmitted(as.alice(t), w.groups.club);
    const [claim, ...rest] = await claimsOk(t);
    expect(rest).toEqual([]);
    expect(Object.keys(claim!).sort()).toEqual(CLAIM_KEYS);
    expect(claim).toEqual({
      id,
      member: { id: w.users.alice, name: "Alice" },
      title: "Bier borrel",
      expenseDate: "2026-11-26",
      amountCents: 4250,
      status: "submitted",
      submittedAt: new Date(FIXED_NOW).toISOString(),
      processedCents: null,
      note: null,
      decidedAt: null,
      withdrawnAt: null,
      revision: 2,
    });
  });

  it("na besluit en intrekken: decidedAt en withdrawnAt als ISO 8601 in UTC", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newSubmitted(as.alice(t), w.groups.club);
    advance(HOUR_MS);
    await decideOk(t, { id, status: "adjusted", processedCents: 4000, note: "Statiegeld eraf", revision: 2 });
    advance(HOUR_MS);
    await as.alice(t).mutation(claimsApi.withdraw, { claimId: id });
    const [claim] = await claimsOk(t);
    expect(claim).toMatchObject({
      status: "withdrawn",
      processedCents: 4000,
      note: "Statiegeld eraf",
      submittedAt: "2026-11-27T11:00:00.000Z",
      decidedAt: "2026-11-27T12:00:00.000Z",
      withdrawnAt: "2026-11-27T13:00:00.000Z",
      revision: 4,
    });
  });

  it("besluit 2: member.name is de profielnaam nu; zonder naam een lege tekst", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const a = await newSubmitted(as.alice(t), w.groups.club);
    const e = await newSubmitted(as.erik(t), w.groups.club);
    await t.run(async (ctx) => {
      await ctx.db.patch(w.users.alice, { name: "Alice de Vries" });
    });
    const claims = await claimsOk(t);
    expect(claims.find((c) => c.id === a)!.member).toEqual({ id: w.users.alice, name: "Alice de Vries" });
    expect(claims.find((c) => c.id === e)!.member).toEqual({ id: w.users.erik, name: "" });
  });

  it("A1.12: ontbreekt de users-rij (drift), dan toch 200 met een lege naam", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newSubmitted(as.erik(t), w.groups.club);
    await t.run(async (ctx) => {
      await ctx.db.delete(w.users.erik);
    });
    const claims = await claimsOk(t);
    expect(claims.find((c) => c.id === id)!.member).toEqual({ id: w.users.erik, name: "" });
  });
});

describe("§A6: welke declaraties", () => {
  it("alles behalve draft: submitted, processed, adjusted, rejected, withdrawn", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await newDraft(as.alice(t), w.groups.club, { title: "Concept" });
    const s = await newSubmitted(as.alice(t), w.groups.club, { title: "Verzonden" });
    const p = await newSubmitted(as.bob(t), w.groups.club, { title: "Verwerkt" });
    await processClaim(t, p);
    const a = await newSubmitted(as.bob(t), w.groups.club, { title: "Aangepast" });
    await decideOk(t, { id: a, status: "adjusted", processedCents: 100, note: null, revision: 2 });
    const r = await newSubmitted(as.erik(t), w.groups.club, { title: "Afgewezen" });
    await reject(t, r);
    const x = await newSubmitted(as.erik(t), w.groups.club, { title: "Ingetrokken" });
    await as.erik(t).mutation(claimsApi.withdraw, { claimId: x });
    const claims = await claimsOk(t);
    expect(claims.map((c) => c.title).sort()).toEqual(["Aangepast", "Afgewezen", "Ingetrokken", "Verwerkt", "Verzonden"]);
    expect(claims.find((c) => c.id === s)!.status).toBe("submitted");
  });

  it("oudste submittedAt eerst, niet op aanmaak", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const late = await newDraft(as.alice(t), w.groups.club, { title: "Eerst gemaakt, later verzonden" });
    advance(60_000);
    const early = await newSubmitted(as.bob(t), w.groups.club, { title: "Eerst verzonden" });
    advance(60_000);
    await as.alice(t).mutation(claimsApi.submit, { claimId: late });
    advance(60_000);
    const last = await newSubmitted(as.erik(t), w.groups.club, { title: "Laatst" });
    expect((await claimsOk(t)).map((c) => c.id)).toEqual([early, late, last]);
  });

  it("draft-invariant 10: alleen de groep van CLAIMS_GROUP_ID", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const inClub = await newSubmitted(as.alice(t), w.groups.club);
    configureClaims(w.groups.other);
    const inOther = await newSubmitted(as.dave(t), w.groups.other);
    expect((await claimsOk(t)).map((c) => c.id)).toEqual([inOther]);
    configureClaims(w.groups.club);
    expect((await claimsOk(t)).map((c) => c.id)).toEqual([inClub]);
  });

  it("query-parameters doen niets, ook een groupId niet", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newSubmitted(as.alice(t), w.groups.club);
    for (const q of [`groupId=${w.groups.other}`, "status=draft", "all=1"]) {
      const { status, body } = await read(await getClaims(t, {}, q));
      expect(status).toBe(200);
      expect((body.claims as Array<{ id: string }>).map((c) => c.id)).toEqual([id]);
    }
  });

  it("besluit 3: een verzonden declaratie van een lid dat vertrok, staat er nog", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newSubmitted(as.erik(t), w.groups.club);
    await as.erik(t).mutation(api.groups.removeMember, { groupId: w.groups.club, userId: w.users.erik });
    expect((await claimsOk(t)).map((c) => c.id)).toEqual([id]);
  });
});
