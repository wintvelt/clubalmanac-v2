import { describe, expect, it, vi } from "vitest";
import { registerUser, withUser } from "../_helpers/auth";
import { seedMember } from "../_helpers/membership";
import {
  claimsApi,
  configureClaims,
  decide,
  fixture,
  getClaims,
  newDraft,
  newT,
  purge,
  read,
  READ_SECRET,
  useClaimsEnv,
  type R,
  type T,
} from "./_claims";

// WP45 — het contract met het clubboek, gepind met de voorbeelden in
// tests/fixtures/wp45 (zie de README daar). De routes geven precies die
// antwoorden, met de echte ids in plaats van de verzonnen.

useClaimsEnv();

const at = (iso: string) => vi.setSystemTime(new Date(iso));

const BERK = "js71b3rkq8v2m6x0d3f5h9k2m4p6r8a1";
const JORIS = "js71j0r1sq8v2m6x0d3f5h9k2m4p6rb2";
const C = (i: number) => `jn7c4q1b8w2v6x0d3f5h9k2m4p6r8t0${i}`;

/** Vervangt elke tekst die in `map` staat, diep in een JSON-waarde. */
function swap(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => swap(v, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as R).map(([k, v]) => [k, swap(v, map)]));
  }
  return value;
}

async function decideAs(t: T, body: R): Promise<void> {
  const res = await decide(t, body);
  expect(res.status, await res.clone().text()).toBe(200);
}

/** Bouwt de toestand van claims.response.json na; geeft verzonnen id → echt id. */
async function build(t: T): Promise<{ toReal: Map<string, string>; toFixture: Map<string, string> }> {
  at("2026-10-01T08:00:00.000Z");
  const berk = await registerUser(t, "user_berk", "berk@x.com", "Berk");
  const joris = await registerUser(t, "user_joris", "joris@x.com", "Joris");
  const group = await t.run(async (ctx) =>
    ctx.db.insert("groups", { name: "De Heeren", createdBy: berk, createdAt: Date.now() }),
  );
  await seedMember(t, { groupId: group, userId: berk, role: "admin" });
  await seedMember(t, { groupId: group, userId: joris, role: "member" });
  configureClaims(group);
  const asBerk = withUser(t, "user_berk");
  const asJoris = withUser(t, "user_joris");

  const send = async (c: typeof asBerk, iso: string, title: string, expenseDate: string, amountCents: number) => {
    at(iso);
    const id = await newDraft(c, group, { title, expenseDate, amountCents });
    await c.mutation(claimsApi.submit, { claimId: id });
    return id;
  };

  const c3 = await send(asBerk, "2026-11-01T10:00:00.000Z", "Boodschappen weekend", "2026-10-31", 8735);
  at("2026-11-02T10:00:00.000Z");
  await decideAs(t, { id: c3, status: "adjusted", processedCents: 7500, note: "Statiegeld eraf\r\nBon klopt verder", revision: 2 });

  const c4 = await send(asJoris, "2026-11-05T22:00:00.000Z", "Taxi station", "2026-11-05", 3200);
  at("2026-11-06T09:00:00.000Z");
  await decideAs(t, { id: c4, status: "processed", processedCents: 3200, note: null, revision: 2 });
  at("2026-11-07T12:00:00.000Z");
  await asJoris.mutation(claimsApi.withdraw, { claimId: c4 });

  const c2 = await send(asJoris, "2026-11-11T08:00:00.000Z", "Huur zaal", "2026-11-10", 15000);
  at("2026-11-12T09:30:00.000Z");
  await decideAs(t, { id: c2, status: "processed", processedCents: 15000, note: "", revision: 2 });

  const c5 = await send(asBerk, "2026-11-15T12:00:00.000Z", "Cadeau jubilaris", "2026-11-15", 2500);
  at("2026-11-16T08:15:00.000Z");
  await decideAs(t, { id: c5, status: "rejected", processedCents: null, note: " Geen clubkosten ", revision: 2 });

  at("2026-11-20T10:00:00.000Z");
  await newDraft(asJoris, group, { title: "Nog invullen", expenseDate: "2026-11-20", amountCents: 999 });

  const c1 = await send(asBerk, "2026-11-26T19:04:05.000Z", "Bier borrel", "2026-11-26", 4250);

  at("2026-11-27T11:00:00.000Z");
  const pairs: Array<[string, string]> = [
    [BERK, berk],
    [JORIS, joris],
    [C(1), c1],
    [C(2), c2],
    [C(3), c3],
    [C(4), c4],
    [C(5), c5],
  ];
  return {
    toReal: new Map(pairs),
    toFixture: new Map(pairs.map(([f, r]) => [r, f])),
  };
}

async function exchange(_t: T, call: Promise<Response>, map: Map<string, string>): Promise<{ status: number; body: unknown }> {
  const { status, body } = await read(await call);
  return { status, body: swap(body, map) };
}

describe("het contract met het clubboek (tests/fixtures/wp45)", () => {
  it("GET /claims geeft precies claims.response.json", async () => {
    const t = newT();
    const { toFixture } = await build(t);
    const got = await exchange(t, getClaims(t), toFixture);
    expect(got.status).toBe(200);
    expect(got.body).toEqual(fixture("claims.response.json"));
  });

  it("de besluiten en het opruimen geven precies de voorbeeld-antwoorden, in de volgorde van de README", async () => {
    const t = newT();
    const { toReal, toFixture } = await build(t);
    const real = (name: string) => swap(fixture(name), toReal);

    const ok = await exchange(t, decide(t, real("decision.request.json")), toFixture);
    expect(ok).toEqual({ status: 200, body: fixture("decision.response.json") });

    const changed = await exchange(t, decide(t, real("decision.changed.request.json")), toFixture);
    expect(changed).toEqual({ status: 409, body: fixture("decision.changed.response.json") });

    const withdrawn = await exchange(t, decide(t, real("decision.withdrawn.request.json")), toFixture);
    expect(withdrawn).toEqual({ status: 409, body: fixture("decision.withdrawn.response.json") });

    const purged = await exchange(t, purge(t, real("purge.request.json")), toFixture);
    expect(purged).toEqual({ status: 200, body: fixture("purge.response.json") });

    const after = (await exchange(t, getClaims(t), toFixture)).body as R;
    expect((after.claims as R[]).map((c) => c.id)).toEqual([C(3), C(5), C(1)]);
  });

  it("de foutbodies van errors.json: 403, 404 en 413 precies, 400 in vorm", async () => {
    const t = newT();
    const { toReal } = await build(t);
    const errors = fixture("errors.json");
    const real = swap(fixture("decision.request.json"), toReal) as R;

    const exact = async (res: Response) => {
      const { status, body } = await read(res);
      return { status, body };
    };
    expect(await exact(await getClaims(t, { secret: READ_SECRET.slice(1) }))).toEqual({ status: 403, body: errors["403"] });
    expect(await exact(await decide(t, { ...real, id: "onbekend" }))).toEqual({ status: 404, body: errors["404"] });
    expect(await exact(await decide(t, " ".repeat(9000)))).toEqual({ status: 413, body: errors["413"] });
    const bad = await read(await decide(t, { ...real, processedCents: 1.5 }));
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body).sort()).toEqual(Object.keys(errors["400"]).sort());
    expect(bad.body).toMatchObject({ v: 1, error: "invalid" });
  });

  it("de voorbeelden zelf: elk antwoord heeft v: 1; ids en revisions zijn consistent", () => {
    for (const name of [
      "claims.response.json",
      "decision.response.json",
      "decision.changed.response.json",
      "decision.withdrawn.response.json",
      "purge.response.json",
    ]) {
      expect(fixture(name).v, name).toBe(1);
    }
    const claims = fixture("claims.response.json").claims as R[];
    expect(claims.map((c) => c.status)).not.toContain("draft");
    const byId = new Map(claims.map((c) => [c.id as string, c]));
    expect(fixture("decision.request.json").revision).toBe(byId.get(C(1))!.revision);
    expect(fixture("decision.withdrawn.response.json").claim).toEqual(byId.get(C(4)));
  });
});
