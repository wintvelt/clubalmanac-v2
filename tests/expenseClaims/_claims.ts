import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { GenericId } from "convex/values";
import { modules } from "../_helpers/modules";
import { registerUser, withUser } from "../_helpers/auth";
import { seedMember } from "../_helpers/membership";

// WP45 — gedeelde opzet voor de tests van de declaraties.
// Spec: docs/work-packages/WP45-declaraties.md §Spec-criticus aanvullingen
// (A2 de functies van het lid, A3 invoer, A4 grenzen, A5 toegang tot de
// routes, A6–A8 de drie routes, A11 cascade).
//
// Alle namen, bedragen en geheimen hier zijn verzonnen.

export type T = ReturnType<typeof convexTest>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type R = Record<string, any>;

// --- geheimen (verzonnen, 64 hex-tekens) ------------------------------------

export const READ_SECRET = "a3f19c0e7b2d4c68e5a1f0b9d7c3e2a18b6f4d0c2e9a7b5d3f1c8e6a4b2d0e11";
export const READ_SECRET_OLD = "b7e20d1f8c3a5d79f6b2e1cae8d4f3b29c7e5f1d3fab8c6e4a2d9f7b5c3e1f22";
export const PURGE_SECRET = "c5d31e2a9d4b6e8af7c3f2dbf9e5a4c3ad8f6e2e4abc9d7f5b3eaf8c6d4f2a33";
export const PURGE_SECRET_OLD = "d9e42f3bae5c7f9b08d4a3ecaaf6b5d4be9a7f3f5bcdae8a6c4fba9d7e5a3b44";
/** Het geheim van WP41 (afrekeningen). Hoort niet te werken op /claims. */
export const FINANCE_SECRET = "e1f53a4cbf6d8aac19e5b4fdbba7c6e5cfab8a4a6cdebf9b7d5acb0e8f6b4c55";

/** WP41 F1: het geheim gaat in een eigen header, niet in Authorization. */
export const SECRET_HEADER = "X-Clubboek-Secret";

export const DECISION_MAX_BYTES = 8 * 1024;
export const PURGE_MAX_BYTES = 32 * 1024;
export const PURGE_MAX_ITEMS = 200;

/** Precies de weigering van §A5. */
export const FORBIDDEN_BODY = { v: 1, error: "forbidden" };
export const NOT_FOUND_BODY = { v: 1, error: "not_found" };
export const TOO_LARGE_BODY = { v: 1, error: "too_large" };

// --- tijd ------------------------------------------------------------------------

/** Vrijdag 27 november 2026, 12:00 in Nederland (CET, UTC+1). */
export const FIXED_NOW = Date.UTC(2026, 10, 27, 11, 0, 0);
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/** Een geldige datum van een uitgave, een dag vóór FIXED_NOW. */
export const YESTERDAY = "2026-11-26";

// --- de functies van het lid (forward-declared: convex/expenseClaims.ts bestaat nog niet) ---

/** Het id van een declaratie (de tabel bestaat nog niet in het gegenereerde datamodel). */
export type ClaimId = GenericId<"expenseClaims">;

export type ClaimStatus = "draft" | "submitted" | "processed" | "adjusted" | "rejected" | "withdrawn";

/** Eén element van listMine (§A2). */
export type MyClaim = {
  _id: ClaimId;
  title: string;
  expenseDate: string;
  amountCents: number;
  status: ClaimStatus;
  submittedAt: number | null;
  processedCents: number | null;
  note: string | null;
  decidedAt: number | null;
  withdrawnAt: number | null;
};

export type DraftArgs = {
  groupId: Id<"groups">;
  claimId?: ClaimId;
  title: string;
  expenseDate: string;
  amountCents: number;
};

export const claimsApi = (
  api as unknown as {
    expenseClaims: {
      saveDraft: FunctionReference<"mutation", "public", DraftArgs, ClaimId>;
      deleteDraft: FunctionReference<"mutation", "public", { claimId: ClaimId }, null>;
      submit: FunctionReference<"mutation", "public", { claimId: ClaimId }, null>;
      withdraw: FunctionReference<"mutation", "public", { claimId: ClaimId }, null>;
      listMine: FunctionReference<"query", "public", { groupId: Id<"groups"> }, MyClaim[]>;
    };
  }
).expenseClaims;

// --- omgeving ------------------------------------------------------------------

export function newT(): T {
  return convexTest(schema, modules);
}

const ENV_NAMES = [
  "CLAIMS_SECRET",
  "CLAIMS_SECRET_PREVIOUS",
  "CLAIMS_PURGE_SECRET",
  "CLAIMS_PURGE_SECRET_PREVIOUS",
  "CLAIMS_GROUP_ID",
  "FINANCE_SECRET",
  "FINANCE_GROUP_ID",
  "WEBMASTER_EMAILS",
] as const;

/** Wist alle env-vars die deze tests zetten (ook binnen één test, per ronde). */
export function clearClaimsEnv(): void {
  for (const n of ENV_NAMES) delete process.env[n];
}

/**
 * Ruimt de env-vars op rond elke test, en zet de klok vast op FIXED_NOW (nep-
 * timers, zoals tests/films en tests/videos; de helper deleteAccount werkt
 * daarmee).
 */
export function useClaimsEnv(): void {
  beforeEach(() => {
    clearClaimsEnv();
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const n of ENV_NAMES) delete process.env[n];
  });
}

/** Zet de vijf env-vars van §A5 op de "deployment": de huidige geheimen en de groep. */
export function configureClaims(groupId: string, opts: { previous?: boolean } = {}): void {
  process.env.CLAIMS_SECRET = READ_SECRET;
  process.env.CLAIMS_PURGE_SECRET = PURGE_SECRET;
  process.env.CLAIMS_GROUP_ID = groupId;
  if (opts.previous) {
    process.env.CLAIMS_SECRET_PREVIOUS = READ_SECRET_OLD;
    process.env.CLAIMS_PURGE_SECRET_PREVIOUS = PURGE_SECRET_OLD;
  } else {
    delete process.env.CLAIMS_SECRET_PREVIOUS;
    delete process.env.CLAIMS_PURGE_SECRET_PREVIOUS;
  }
}

export function advance(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

// --- wereld ----------------------------------------------------------------------

export const WEBMASTER_EMAIL = "wm@x.com";

export type World = Awaited<ReturnType<typeof seedWorld>>;

/**
 * Groep "De Heeren" (bob oprichter en admin, alice lid, erik lid) is de groep
 * van CLAIMS_GROUP_ID. Groep "Ander" (dave oprichter, alice ook lid). carol is
 * nergens lid; wm is webmaster en nergens lid. erik heeft geen profielnaam.
 */
export async function seedWorld(t: T) {
  const alice = await registerUser(t, "user_alice", "alice@x.com", "Alice");
  const bob = await registerUser(t, "user_bob", "bob@x.com", "Bob");
  const carol = await registerUser(t, "user_carol", "carol@x.com", "Carol");
  const dave = await registerUser(t, "user_dave", "dave@x.com", "Dave");
  const erik = await registerUser(t, "user_erik", "erik@x.com");
  const wm = await registerUser(t, "user_wm", WEBMASTER_EMAIL, "Webmaster");
  const [club, other] = await t.run(async (ctx) => [
    await ctx.db.insert("groups", { name: "De Heeren", createdBy: bob, createdAt: Date.now() }),
    await ctx.db.insert("groups", { name: "Ander", createdBy: dave, createdAt: Date.now() }),
  ]);
  await seedMember(t, { groupId: club, userId: bob, role: "admin" });
  await seedMember(t, { groupId: club, userId: alice, role: "member" });
  await seedMember(t, { groupId: club, userId: erik, role: "member" });
  await seedMember(t, { groupId: other, userId: dave, role: "admin" });
  await seedMember(t, { groupId: other, userId: alice, role: "member" });
  process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
  configureClaims(club);
  return { users: { alice, bob, carol, dave, erik, wm }, groups: { club, other } };
}

export const as = {
  alice: (t: T) => withUser(t, "user_alice"),
  bob: (t: T) => withUser(t, "user_bob"),
  carol: (t: T) => withUser(t, "user_carol"),
  dave: (t: T) => withUser(t, "user_dave"),
  erik: (t: T) => withUser(t, "user_erik"),
  wm: (t: T) => withUser(t, "user_wm", WEBMASTER_EMAIL),
};

export type Client = ReturnType<typeof withUser>;

/** Een geldig concept (verzonnen). */
export function draftInput(groupId: Id<"groups">, over: Partial<DraftArgs> = {}): DraftArgs {
  return { groupId, title: "Bier borrel", expenseDate: YESTERDAY, amountCents: 4250, ...over };
}

export async function newDraft(
  client: Client,
  groupId: Id<"groups">,
  over: Partial<DraftArgs> = {},
): Promise<ClaimId> {
  return await client.mutation(claimsApi.saveDraft, draftInput(groupId, over));
}

/** Een concept, meteen verzonden. `revision` is dan 2 (A1.3). */
export async function newSubmitted(
  client: Client,
  groupId: Id<"groups">,
  over: Partial<DraftArgs> = {},
): Promise<ClaimId> {
  const id = await newDraft(client, groupId, over);
  await client.mutation(claimsApi.submit, { claimId: id });
  return id;
}

// --- de tabel --------------------------------------------------------------------

/** Alle rijen van expenseClaims, rechtstreeks uit de database. */
export async function claimRows(t: T): Promise<R[]> {
  return await t.run(async (ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (ctx.db as any).query("expenseClaims").collect()) as R[];
  });
}

export async function claimRow(t: T, id: string): Promise<R | null> {
  return (await claimRows(t)).find((r) => r._id === id) ?? null;
}

/** Voor "er verandert niets"-vergelijkingen. */
export async function snapshot(t: T): Promise<R[]> {
  return (await claimRows(t)).map((r) => ({ ...r })).sort((a, b) => String(a._id).localeCompare(String(b._id)));
}

// --- weigeringen van de functies van het lid ---------------------------------------

export async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("de aanroep had moeten falen");
}

/** Precies een ConvexError met deze code (§A2, A-keuze 3). */
export async function expectCode(promise: Promise<unknown>, code: string): Promise<unknown> {
  const err = await caught(promise);
  expect(err, `verwacht ConvexError ${code}, kreeg ${String(err)}`).toBeInstanceOf(ConvexError);
  expect((err as ConvexError<{ code: string }>).data).toMatchObject({ code });
  return (err as ConvexError<Record<string, string>>).data;
}

// --- de routes ---------------------------------------------------------------------

export type Access = {
  /** Waarde van X-Clubboek-Secret; null: geen header. */
  secret?: string | null;
  /** Extra headers, bv. Authorization. */
  headers?: Record<string, string>;
};

function headersFor(access: Access, fallback: string): Record<string, string> {
  const headers: Record<string, string> = { ...(access.headers ?? {}) };
  const secret = access.secret === undefined ? fallback : access.secret;
  if (secret !== null) headers[SECRET_HEADER] = secret;
  return headers;
}

/** GET /claims (`query`: een query-string zonder `?`). */
export async function getClaims(t: T, access: Access = {}, query = ""): Promise<Response> {
  return await t.fetch(`/claims${query ? `?${query}` : ""}`, {
    method: "GET",
    headers: headersFor(access, READ_SECRET),
  });
}

/** GET /claims die moet slagen; geeft de lijst. */
export async function claimsOk(t: T): Promise<R[]> {
  const res = await getClaims(t);
  const text = await res.text();
  expect(res.status, `verwacht 200, kreeg ${res.status}: ${text}`).toBe(200);
  const body = JSON.parse(text) as R;
  expect(body.v).toBe(1);
  return body.claims as R[];
}

/** POST /claims/decision. `body` als object (wordt JSON) of als ruwe tekst. */
export async function decide(t: T, body: unknown, access: Access = {}): Promise<Response> {
  return await t.fetch("/claims/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersFor(access, READ_SECRET) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** POST /claims/purge. */
export async function purge(t: T, body: unknown, access: Access = {}): Promise<Response> {
  return await t.fetch("/claims/purge", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersFor(access, PURGE_SECRET) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Status en JSON van een antwoord. */
export async function read(res: Response): Promise<{ status: number; body: R; text: string }> {
  const text = await res.text();
  let body: R = {};
  try {
    body = JSON.parse(text) as R;
  } catch {
    body = { __notJson: text };
  }
  return { status: res.status, body, text };
}

/** Een besluit dat moet slagen; geeft de nieuwe revision. */
export async function decideOk(t: T, body: R): Promise<number> {
  const { status, body: out, text } = await read(await decide(t, body));
  expect(status, `verwacht 200, kreeg ${status}: ${text}`).toBe(200);
  expect(out).toMatchObject({ v: 1, ok: true });
  return out.revision as number;
}

/** De huidige revision van een declaratie, uit de database. */
export async function revisionOf(t: T, id: string): Promise<number> {
  const row = await claimRow(t, id);
  if (!row) throw new Error(`geen declaratie ${id}`);
  return row.revision as number;
}

/** Een besluit `processed` (verwerkt, gedeclareerd bedrag) met de huidige revision. */
export async function processClaim(t: T, id: string, note: string | null = null): Promise<number> {
  const row = await claimRow(t, id);
  return await decideOk(t, {
    id,
    status: "processed",
    processedCents: row!.amountCents,
    note,
    revision: row!.revision,
  });
}

/** Een besluit `rejected` met de huidige revision. */
export async function reject(t: T, id: string, note: string | null = null): Promise<number> {
  return await decideOk(t, { id, status: "rejected", processedCents: null, note, revision: await revisionOf(t, id) });
}

/** Een element van GET /claims voor dit id, of undefined. */
export async function claimFromGet(t: T, id: string): Promise<R | undefined> {
  return (await claimsOk(t)).find((c) => c.id === id);
}

// --- voorbeelden (tests/fixtures/wp45) -------------------------------------------

export function fixture(name: string): R {
  const raw = readFileSync(fileURLToPath(new URL(`../fixtures/wp45/${name}`, import.meta.url)), "utf8");
  return JSON.parse(raw) as R;
}

/** De sleutels van één element van GET /claims (§A6). */
export const CLAIM_KEYS = [
  "amountCents",
  "decidedAt",
  "expenseDate",
  "id",
  "member",
  "note",
  "processedCents",
  "revision",
  "status",
  "submittedAt",
  "title",
  "withdrawnAt",
];

/** De sleutels van één element van listMine (§A2). */
export const MY_CLAIM_KEYS = [
  "_id",
  "amountCents",
  "decidedAt",
  "expenseDate",
  "note",
  "processedCents",
  "status",
  "submittedAt",
  "title",
  "withdrawnAt",
];
