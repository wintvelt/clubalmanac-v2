import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect } from "vitest";
import type { FunctionReference } from "convex/server";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { modules } from "../_helpers/modules";
import { registerUser, withUser } from "../_helpers/auth";
import { seedMember } from "../_helpers/membership";

// WP41 — gedeelde opzet voor de tests van Geld (afrekeningen uit het clubboek).
// Spec: docs/work-packages/WP41-financieel.md §Spec-criticus aanvullingen
// (A2 het verzoek, A3 grenzen, A4/A5 de routes, A6 lezen, A7 toegang).
//
// Alle namen, bedragen en geheimen hier zijn verzonnen. De voorbeelden staan
// in tests/fixtures/wp41 (zie de README daar).

export type T = ReturnType<typeof convexTest>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type R = Record<string, any>;

/** 64 hex-tekens, zoals het runbook voorschrijft (32 bytes). Verzonnen. */
export const SECRET = "4f1c0e9a7b2d6c38e5a1f0b9d7c3e2a18b6f4d0c2e9a7b5d3f1c8e6a4b2d0f97";
export const BEARER = `Bearer ${SECRET}`;

export const MAX_BODY_BYTES = 128 * 1024;

// --- forward-declared refs (convex/settlements.ts bestaat nog niet) ---------

export type SettlementListItem = {
  _id: string;
  name: string;
  period: string;
  startDate: string;
  participantCount: number;
  openCount: number;
};

export const settlementsApi = (
  api as unknown as {
    settlements: {
      listByGroup: FunctionReference<"query", "public", { groupId: Id<"groups"> }, SettlementListItem[]>;
      get: FunctionReference<"query", "public", { settlementId: string }, R>;
    };
  }
).settlements;

// --- voorbeelden -------------------------------------------------------------

export type Example = "lustrum" | "weekend";

/** Het verzoek uit tests/fixtures/wp41, als verse kopie (tests passen hem aan). */
export function request(name: Example): R {
  const raw = readFileSync(fileURLToPath(new URL(`../fixtures/wp41/${name}.request.json`, import.meta.url)), "utf8");
  return JSON.parse(raw) as R;
}

/** De gepubliceerde versie uit het clubboek (met lid_id, Decimal als tekst). */
export function publicatie(name: Example): R {
  const raw = readFileSync(
    fileURLToPath(new URL(`../fixtures/wp41/${name}.publicatie.json`, import.meta.url)),
    "utf8",
  );
  return JSON.parse(raw) as R;
}

const SUMMED = ["costs", "club", "fromPot", "advanced", "balance", "open"] as const;

/**
 * Zet de totalen gelijk aan de som van de rijen. Alleen voor tests die rijen
 * toevoegen of weghalen en een geldig verzoek willen houden (A2: elk totaal is
 * de som van zijn rijen).
 */
export function withTotals(body: R): R {
  const rows = body.rows as R[];
  const totals: R = {};
  for (const k of SUMMED) totals[k] = rows.reduce((a, r) => a + (r[k] as number), 0);
  totals.potBefore = body.lustrum ? rows.reduce((a, r) => a + (r.potBefore as number), 0) : null;
  totals.potAfter = body.lustrum ? rows.reduce((a, r) => a + (r.potAfter as number), 0) : null;
  return { ...body, totals: { ...body.totals, ...totals } };
}

// --- omgeving ----------------------------------------------------------------

export function newT(): T {
  return convexTest(schema, modules);
}

const ENV_NAMES = ["FINANCE_SECRET", "FINANCE_GROUP_ID", "WEBMASTER_EMAILS"] as const;

/** Ruimt de env-vars van WP41 op na elke test in het bestand. */
export function useFinanceEnv(): void {
  beforeEach(() => {
    for (const n of ENV_NAMES) delete process.env[n];
  });
  afterEach(() => {
    for (const n of ENV_NAMES) delete process.env[n];
  });
}

/** Zet het geheim en de groep op de "deployment". */
export function configure(groupId: string, secret: string = SECRET): void {
  process.env.FINANCE_SECRET = secret;
  process.env.FINANCE_GROUP_ID = groupId;
}

// --- wereld ------------------------------------------------------------------

export const WEBMASTER_EMAIL = "wm@x.com";

/**
 * Groep "De Heeren" (bob oprichter en admin, alice lid). Groep "Ander" (dave
 * enige lid). carol is nergens lid; wm is webmaster en nergens lid. Het
 * geheim staat op de deployment, gebonden aan De Heeren.
 */
export async function seedWorld(t: T) {
  const alice = await registerUser(t, "user_alice", "alice@x.com", "Alice");
  const bob = await registerUser(t, "user_bob", "bob@x.com", "Bob");
  const carol = await registerUser(t, "user_carol", "carol@x.com", "Carol");
  const dave = await registerUser(t, "user_dave", "dave@x.com", "Dave");
  const wm = await registerUser(t, "user_wm", WEBMASTER_EMAIL, "Webmaster");
  const [club, other] = await t.run(async (ctx) => [
    await ctx.db.insert("groups", { name: "De Heeren", createdBy: bob, createdAt: Date.now() }),
    await ctx.db.insert("groups", { name: "Ander", createdBy: dave, createdAt: Date.now() }),
  ]);
  await seedMember(t, { groupId: club, userId: bob, role: "admin" });
  await seedMember(t, { groupId: club, userId: alice, role: "member" });
  await seedMember(t, { groupId: other, userId: dave, role: "admin" });
  process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
  configure(club);
  return { users: { alice, bob, carol, dave, wm }, groups: { club, other } };
}

export const as = {
  alice: (t: T) => withUser(t, "user_alice"),
  bob: (t: T) => withUser(t, "user_bob"),
  carol: (t: T) => withUser(t, "user_carol"),
  dave: (t: T) => withUser(t, "user_dave"),
  wm: (t: T) => withUser(t, "user_wm", WEBMASTER_EMAIL),
};

// --- de routes ---------------------------------------------------------------

type PostOpts = { auth?: string | null; contentType?: string | null };

/** POST /settlements. `body` als object (wordt JSON) of als ruwe tekst. */
export async function post(t: T, body: unknown, opts: PostOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const auth = opts.auth === undefined ? BEARER : opts.auth;
  if (auth !== null) headers.Authorization = auth;
  const ct = opts.contentType === undefined ? "application/json" : opts.contentType;
  if (ct !== null) headers["Content-Type"] = ct;
  return await t.fetch("/settlements", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** DELETE /settlements?key=… (`key` null: geen parameter). */
export async function del(t: T, key: string | null, auth: string | null = BEARER): Promise<Response> {
  const headers: Record<string, string> = {};
  if (auth !== null) headers.Authorization = auth;
  const q = key === null ? "" : `?key=${encodeURIComponent(key)}`;
  return await t.fetch(`/settlements${q}`, { method: "DELETE", headers });
}

/** POST die moet slagen; geeft de JSON van het antwoord. */
export async function postOk(t: T, body: unknown): Promise<R> {
  const res = await post(t, body);
  const text = await res.text();
  expect(res.status, `verwacht 200, kreeg ${res.status}: ${text}`).toBe(200);
  return JSON.parse(text) as R;
}

// --- de tabel ----------------------------------------------------------------

/** Alle rijen van `settlements`, rechtstreeks uit de database. */
export async function rows(t: T): Promise<R[]> {
  return await t.run(async (ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (ctx.db as any).query("settlements").collect()) as R[];
  });
}

/** Zonder systeemvelden, voor "precies zoals het was"-vergelijkingen. */
export async function snapshot(t: T): Promise<R[]> {
  return (await rows(t)).map((r) => ({ ...r })).sort((a, b) => String(a._id).localeCompare(String(b._id)));
}

// --- weigeringen bij lezen ---------------------------------------------------

export async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("de aanroep had moeten falen");
}

/** Precies de ConvexError met code NOT_MEMBER (WP16, WP23). */
export async function expectNotMember(promise: Promise<unknown>): Promise<void> {
  const err = await caught(promise);
  expect(err).toBeInstanceOf(ConvexError);
  expect((err as ConvexError<{ code: string }>).data).toMatchObject({ code: "NOT_MEMBER" });
}

/** Het verzoek zonder `key`: zo hoort `settlements.get` het terug te geven (A6). */
export function asRead(body: R): R {
  const { key: _key, ...rest } = body;
  return rest;
}
