import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getMembership } from "./groups";
import { requireCurrentUser } from "./users";
import { constantTimeEqual } from "./lib/constantTime";
import {
  cleanTitle,
  claimStatus,
  DECISION_MAX_BODY_BYTES,
  DRAFTS_PER_MEMBER,
  isAmount,
  isExpenseDate,
  KEPT_PER_MEMBER,
  parseDecisionRequest,
  parsePurgeRequest,
  PURGE_MAX_BODY_BYTES,
  SETTLED_STATUSES,
  SUBMIT_WINDOW_MS,
  SUBMITS_PER_DAY,
  SUBMITTED_PER_MEMBER,
  WITHDRAWABLE_STATUSES,
  type ClaimStatus,
} from "./lib/claimShape";

// WP45 — declaraties. Spec: docs/work-packages/WP45-declaraties.md (§A1–A12).
//
// Het lid (§A2): saveDraft, deleteDraft, submit, withdraw en listMine. Volgorde
// van de controles, de eerste die faalt bepaalt de fout en er verandert niets:
// ingelogd; lid van de groep en eigenaar van de declaratie (anders NOT_MEMBER,
// voor elke oorzaak dezelfde, ook voor een admin of de webmaster); de groep is
// die van `CLAIMS_GROUP_ID` (anders CLAIMS_DISABLED); de status; de invoer; de
// grenzen. `memberId` komt altijd uit de sessie (draft-invariant 1).
//
// Het clubboek (§A5–A8): `GET /claims`, `POST /claims/decision` en `POST
// /claims/purge`, met `X-Clubboek-Secret` (niet in Authorization, WP41 F1).
// Eerst het geheim, vóór de body; één weigering voor elke oorzaak, in
// constante tijd vergeleken. De groep staat op de deployment, nooit in het
// verzoek. Elke route doet zijn werk in één interne functie. Geen publieke
// functie schrijft een besluit of ruimt op. Deze module logt niets: geen
// geheim, header of body in een log, antwoord of fout. Geen CORS.

type ClaimCode =
  | "NOT_MEMBER"
  | "CLAIMS_DISABLED"
  | "WRONG_STATUS"
  | "TITLE_INVALID"
  | "DATE_INVALID"
  | "AMOUNT_INVALID"
  | "DRAFT_LIMIT"
  | "SUBMITTED_LIMIT"
  | "DAILY_SUBMIT_LIMIT"
  | "CLAIMS_LIMIT";

function refuse(code: ClaimCode): never {
  throw new ConvexError({ code });
}

// --- de gate van het lid ------------------------------------------------------------

/** Lid van een groep die bestaat. */
async function isMember(ctx: QueryCtx, userId: Id<"users">, groupId: Id<"groups">): Promise<boolean> {
  if (!(await getMembership(ctx, userId, groupId))) return false;
  return (await ctx.db.get(groupId)) !== null;
}

/**
 * Besluit 1: alleen in de groep van `CLAIMS_GROUP_ID`. Na de lidmaatschaps-
 * controle (A1.5), dus `groupId` is een bestaande groep. Ontbreekt de
 * env-var, is hij leeg of geen groep: CLAIMS_DISABLED (fail-closed).
 */
function requireClaimsGroup(groupId: Id<"groups">): void {
  if ((process.env.CLAIMS_GROUP_ID ?? "") !== groupId) refuse("CLAIMS_DISABLED");
}

/** Controles 1–3 voor een groep (nieuw concept, listMine). */
async function requireMemberOfClaimsGroup(ctx: QueryCtx, groupId: Id<"groups">): Promise<Doc<"users">> {
  const user = await requireCurrentUser(ctx);
  if (!(await isMember(ctx, user._id, groupId))) refuse("NOT_MEMBER");
  requireClaimsGroup(groupId);
  return user;
}

/**
 * Controles 1–3 voor een bestaande declaratie: ze bestaat, is van de caller,
 * hoort bij een groep waar hij nu lid van is (en bij `groupId` als die er is).
 */
async function requireOwnClaim(
  ctx: QueryCtx,
  claimId: Id<"expenseClaims">,
  groupId?: Id<"groups">,
): Promise<Doc<"expenseClaims">> {
  const user = await requireCurrentUser(ctx);
  const claim = await ctx.db.get(claimId);
  if (!claim || claim.memberId !== user._id) refuse("NOT_MEMBER");
  if (groupId !== undefined && claim.groupId !== groupId) refuse("NOT_MEMBER");
  if (!(await isMember(ctx, user._id, claim.groupId))) refuse("NOT_MEMBER");
  requireClaimsGroup(claim.groupId);
  return claim;
}

function requireStatus(claim: Doc<"expenseClaims">, allowed: readonly ClaimStatus[]): void {
  if (!allowed.includes(claim.status)) refuse("WRONG_STATUS");
}

/** §A3 en besluit 5: elk concept is compleet en geldig. */
function checkDraftInput(args: { title: string; expenseDate: string; amountCents: number }) {
  const title = cleanTitle(args.title);
  if (title === null) refuse("TITLE_INVALID");
  if (!isExpenseDate(args.expenseDate, Date.now())) refuse("DATE_INVALID");
  if (!isAmount(args.amountCents)) refuse("AMOUNT_INVALID");
  return { title, expenseDate: args.expenseDate, amountCents: args.amountCents };
}

async function countByStatus(
  ctx: QueryCtx,
  memberId: Id<"users">,
  groupId: Id<"groups">,
  status: ClaimStatus,
  limit: number,
): Promise<number> {
  const rows = await ctx.db
    .query("expenseClaims")
    .withIndex("by_member_group_and_status", (q) =>
      q.eq("memberId", memberId).eq("groupId", groupId).eq("status", status),
    )
    .take(limit);
  return rows.length;
}

// --- de functies van het lid -----------------------------------------------------------

/** Nieuw concept (zonder `claimId`), of een bestaand concept wijzigen (§A2). */
export const saveDraft = mutation({
  args: {
    groupId: v.id("groups"),
    claimId: v.optional(v.id("expenseClaims")),
    title: v.string(),
    expenseDate: v.string(),
    amountCents: v.number(),
  },
  returns: v.id("expenseClaims"),
  handler: async (ctx, args) => {
    if (args.claimId !== undefined) {
      const claim = await requireOwnClaim(ctx, args.claimId, args.groupId);
      requireStatus(claim, ["draft"]);
      const input = checkDraftInput(args);
      // A-keuze 14: ook zonder verschil een wijziging.
      await ctx.db.patch(claim._id, { ...input, revision: claim.revision + 1 });
      return claim._id;
    }
    const user = await requireMemberOfClaimsGroup(ctx, args.groupId);
    const input = checkDraftInput(args);
    const drafts = await countByStatus(ctx, user._id, args.groupId, "draft", DRAFTS_PER_MEMBER);
    if (drafts >= DRAFTS_PER_MEMBER) refuse("DRAFT_LIMIT");
    return await ctx.db.insert("expenseClaims", {
      groupId: args.groupId,
      memberId: user._id,
      ...input,
      status: "draft",
      submittedAt: null,
      processedCents: null,
      note: null,
      decidedAt: null,
      withdrawnAt: null,
      revision: 1,
    });
  },
});

/** Een concept weggooien. */
export const deleteDraft = mutation({
  args: { claimId: v.id("expenseClaims") },
  returns: v.null(),
  handler: async (ctx, { claimId }) => {
    const claim = await requireOwnClaim(ctx, claimId);
    requireStatus(claim, ["draft"]);
    await ctx.db.delete(claim._id);
    return null;
  },
});

/**
 * Een concept verzenden (§A4): ten hoogste 20 `submitted`, 20 keer verzenden
 * in de laatste 24 uur, en 200 bewaard die geen concept zijn (F1). Elke
 * verzending telt, ook als die declaratie daarna is besloten of ingetrokken
 * (A1.15); alleen opruimen maakt plek onder de 200.
 */
export const submit = mutation({
  args: { claimId: v.id("expenseClaims") },
  returns: v.null(),
  handler: async (ctx, { claimId }) => {
    const claim = await requireOwnClaim(ctx, claimId);
    requireStatus(claim, ["draft"]);
    const { memberId, groupId } = claim;
    const submitted = await countByStatus(ctx, memberId, groupId, "submitted", SUBMITTED_PER_MEMBER);
    if (submitted >= SUBMITTED_PER_MEMBER) refuse("SUBMITTED_LIMIT");
    const now = Date.now();
    const recent = await ctx.db
      .query("expenseClaims")
      .withIndex("by_member_group_and_submittedAt", (q) =>
        q.eq("memberId", memberId).eq("groupId", groupId).gt("submittedAt", now - SUBMIT_WINDOW_MS),
      )
      .take(SUBMITS_PER_DAY);
    if (recent.length >= SUBMITS_PER_DAY) refuse("DAILY_SUBMIT_LIMIT");
    // Een niet-concept heeft altijd een verzendtijd; een concept heeft null.
    const kept = await ctx.db
      .query("expenseClaims")
      .withIndex("by_member_group_and_submittedAt", (q) =>
        q.eq("memberId", memberId).eq("groupId", groupId).gt("submittedAt", null),
      )
      .take(KEPT_PER_MEMBER);
    if (kept.length >= KEPT_PER_MEMBER) refuse("CLAIMS_LIMIT");
    await ctx.db.patch(claim._id, { status: "submitted", submittedAt: now, revision: claim.revision + 1 });
    return null;
  },
});

/** Intrekken, definitief. Een besluit blijft staan (draft-invariant 5). */
export const withdraw = mutation({
  args: { claimId: v.id("expenseClaims") },
  returns: v.null(),
  handler: async (ctx, { claimId }) => {
    const claim = await requireOwnClaim(ctx, claimId);
    requireStatus(claim, WITHDRAWABLE_STATUSES);
    await ctx.db.patch(claim._id, { status: "withdrawn", withdrawnAt: Date.now(), revision: claim.revision + 1 });
    return null;
  },
});

const myClaim = v.object({
  _id: v.id("expenseClaims"),
  title: v.string(),
  expenseDate: v.string(),
  amountCents: v.number(),
  status: claimStatus,
  submittedAt: v.union(v.number(), v.null()),
  processedCents: v.union(v.number(), v.null()),
  note: v.union(v.string(), v.null()),
  decidedAt: v.union(v.number(), v.null()),
  withdrawnAt: v.union(v.number(), v.null()),
});

/** De eigen declaraties in een groep, alle statussen, nieuwste eerst (A-keuze 10). */
export const listMine = query({
  args: { groupId: v.id("groups") },
  returns: v.array(myClaim),
  handler: async (ctx, { groupId }) => {
    const user = await requireMemberOfClaimsGroup(ctx, groupId);
    const rows = await ctx.db
      .query("expenseClaims")
      .withIndex("by_member_group_and_status", (q) => q.eq("memberId", user._id).eq("groupId", groupId))
      .collect();
    rows.sort((a, b) => b._creationTime - a._creationTime);
    return rows.map((c) => ({
      _id: c._id,
      title: c.title,
      expenseDate: c.expenseDate,
      amountCents: c.amountCents,
      status: c.status,
      submittedAt: c.submittedAt,
      processedCents: c.processedCents,
      note: c.note,
      decidedAt: c.decidedAt,
      withdrawnAt: c.withdrawnAt,
    }));
  },
});

// --- cascade (convex/groups.ts, convex/accountDeletion.ts) ---------------------------------

/** G7: alle declaraties van de groep. */
export async function deleteClaimsOfGroup(ctx: MutationCtx, groupId: Id<"groups">): Promise<void> {
  const rows = await ctx.db
    .query("expenseClaims")
    .withIndex("by_group_and_submittedAt", (q) => q.eq("groupId", groupId))
    .collect();
  for (const c of rows) await ctx.db.delete(c._id);
}

/** M6 (besluit 3): uit de groep → zijn concepten daar weg; de rest blijft voor het clubboek. */
export async function deleteDraftsOfMemberInGroup(
  ctx: MutationCtx,
  memberId: Id<"users">,
  groupId: Id<"groups">,
): Promise<void> {
  const rows = await ctx.db
    .query("expenseClaims")
    .withIndex("by_member_group_and_status", (q) =>
      q.eq("memberId", memberId).eq("groupId", groupId).eq("status", "draft"),
    )
    .collect();
  for (const c of rows) await ctx.db.delete(c._id);
}

/** U19 (besluit 4): een begrensd stuk van zijn declaraties, elke status en groep. Geeft of er iets was. */
export async function deleteClaimsOfMember(
  ctx: MutationCtx,
  memberId: Id<"users">,
  limit: number,
): Promise<boolean> {
  const rows = await ctx.db
    .query("expenseClaims")
    .withIndex("by_member_group_and_status", (q) => q.eq("memberId", memberId))
    .take(limit);
  for (const c of rows) await ctx.db.delete(c._id);
  return rows.length > 0;
}

// --- het clubboek: interne functies (één per route) -----------------------------------------

const clubbookClaim = v.object({
  id: v.string(),
  member: v.object({ id: v.string(), name: v.string() }),
  title: v.string(),
  expenseDate: v.string(),
  amountCents: v.number(),
  status: claimStatus,
  submittedAt: v.union(v.string(), v.null()),
  processedCents: v.union(v.number(), v.null()),
  note: v.union(v.string(), v.null()),
  decidedAt: v.union(v.string(), v.null()),
  withdrawnAt: v.union(v.string(), v.null()),
  revision: v.number(),
});

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

type Names = Map<Id<"users">, string>;

/**
 * De profielnaam nu; zonder naam of zonder users-rij (drift, A1.12) een lege
 * tekst. F2: per lid één keer gelezen, ook als hij veel declaraties heeft.
 */
async function nameOf(ctx: QueryCtx, names: Names, memberId: Id<"users">): Promise<string> {
  const known = names.get(memberId);
  if (known !== undefined) return known;
  const name = (await ctx.db.get(memberId))?.name ?? "";
  names.set(memberId, name);
  return name;
}

/** Eén declaratie zoals het clubboek hem ziet (§A6). */
async function forClubbook(ctx: QueryCtx, c: Doc<"expenseClaims">, names: Names = new Map()) {
  return {
    id: c._id as string,
    member: { id: c.memberId as string, name: await nameOf(ctx, names, c.memberId) },
    title: c.title,
    expenseDate: c.expenseDate,
    amountCents: c.amountCents,
    status: c.status,
    submittedAt: iso(c.submittedAt),
    processedCents: c.processedCents,
    note: c.note,
    decidedAt: iso(c.decidedAt),
    withdrawnAt: iso(c.withdrawnAt),
    revision: c.revision,
  };
}

/** De groep van `CLAIMS_GROUP_ID`, als hij bestaat. Een id uit een andere tabel telt niet. */
async function claimsGroupOf(ctx: QueryCtx, groupId: string): Promise<Id<"groups"> | null> {
  const id = ctx.db.normalizeId("groups", groupId);
  if (!id) return null;
  return (await ctx.db.get(id)) ? id : null;
}

/** Een declaratie van de groep, of `null` (onbekend, geen id, een andere groep of tabel). */
async function claimOfGroup(
  ctx: QueryCtx,
  groupId: Id<"groups">,
  id: string,
): Promise<Doc<"expenseClaims"> | null> {
  const claimId = ctx.db.normalizeId("expenseClaims", id);
  if (!claimId) return null;
  const claim = await ctx.db.get(claimId);
  return claim && claim.groupId === groupId ? claim : null;
}

/** Toegang (§A5): bestaat de groep van de deployment nog? */
export const claimsGroup = internalQuery({
  args: { groupId: v.string() },
  returns: v.union(v.id("groups"), v.null()),
  handler: async (ctx, { groupId }) => await claimsGroupOf(ctx, groupId),
});

/** `GET /claims` (§A6): alles behalve `draft`, oudste verzending eerst. `null`: de groep is weg. */
export const listForClubbook = internalQuery({
  args: { groupId: v.id("groups") },
  returns: v.union(v.array(clubbookClaim), v.null()),
  handler: async (ctx, { groupId }) => {
    if (!(await ctx.db.get(groupId))) return null;
    const rows = await ctx.db
      .query("expenseClaims")
      .withIndex("by_group_and_submittedAt", (q) => q.eq("groupId", groupId))
      .collect();
    const names: Names = new Map();
    const out = [];
    for (const c of rows) if (c.status !== "draft") out.push(await forClubbook(ctx, c, names));
    return out;
  },
});

/**
 * `POST /claims/decision` (§A7, stap 4 en verder). De vorm is al gecontroleerd
 * en `note` is genormaliseerd (A-keuze 6). Bij elke uitkomst behalve `ok` met
 * een nieuwe revision verandert er niets.
 */
export const decideFromClubbook = internalMutation({
  args: {
    groupId: v.id("groups"),
    id: v.string(),
    status: v.union(v.literal("processed"), v.literal("adjusted"), v.literal("rejected")),
    processedCents: v.union(v.number(), v.null()),
    note: v.union(v.string(), v.null()),
    revision: v.number(),
  },
  returns: v.union(
    v.object({ kind: v.literal("refused") }),
    v.object({ kind: v.literal("not_found") }),
    v.object({ kind: v.literal("invalid"), reason: v.string() }),
    v.object({ kind: v.literal("withdrawn"), claim: clubbookClaim }),
    v.object({ kind: v.literal("changed"), claim: clubbookClaim }),
    v.object({ kind: v.literal("ok"), revision: v.number() }),
  ),
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.groupId))) return { kind: "refused" as const };
    const claim = await claimOfGroup(ctx, args.groupId, args.id);
    if (!claim || claim.status === "draft") return { kind: "not_found" as const };
    if (claim.status === "withdrawn") return { kind: "withdrawn" as const, claim: await forClubbook(ctx, claim) };
    // Draft-invariant 7: het bedrag tegen de declaratie.
    if (args.status === "processed" && args.processedCents !== claim.amountCents) {
      return { kind: "invalid" as const, reason: "processedCents: moet het gedeclareerde bedrag zijn bij processed" };
    }
    if (args.status === "adjusted" && args.processedCents === claim.amountCents) {
      return { kind: "invalid" as const, reason: "processedCents: moet afwijken van het gedeclareerde bedrag bij adjusted" };
    }
    const same =
      claim.status === args.status && claim.processedCents === args.processedCents && claim.note === args.note;
    if (same) return { kind: "ok" as const, revision: claim.revision };
    if (args.revision !== claim.revision) return { kind: "changed" as const, claim: await forClubbook(ctx, claim) };
    const revision = claim.revision + 1;
    await ctx.db.patch(claim._id, {
      status: args.status,
      processedCents: args.processedCents,
      note: args.note,
      decidedAt: Date.now(),
      revision,
    });
    return { kind: "ok" as const, revision };
  },
});

/**
 * `POST /claims/purge` (§A8): weg gaat een afgehandelde declaratie van de
 * groep (besluit 8) met precies die revision; al het andere is `skipped`.
 * Beide lijsten in de volgorde van het verzoek, met het id zoals het binnenkwam.
 */
export const purgeFromClubbook = internalMutation({
  args: {
    groupId: v.id("groups"),
    claims: v.array(v.object({ id: v.string(), revision: v.number() })),
  },
  returns: v.union(
    v.object({ kind: v.literal("refused") }),
    v.object({ kind: v.literal("ok"), deleted: v.array(v.string()), skipped: v.array(v.string()) }),
  ),
  handler: async (ctx, { groupId, claims }) => {
    if (!(await ctx.db.get(groupId))) return { kind: "refused" as const };
    const deleted: string[] = [];
    const skipped: string[] = [];
    for (const item of claims) {
      const claim = await claimOfGroup(ctx, groupId, item.id);
      if (claim && SETTLED_STATUSES.includes(claim.status) && claim.revision === item.revision) {
        await ctx.db.delete(claim._id);
        deleted.push(item.id);
      } else {
        skipped.push(item.id);
      }
    }
    return { kind: "ok" as const, deleted, skipped };
  },
});

// --- de HTTP-routes (convex/http.ts) ----------------------------------------------------------

const MIN_SECRET_LENGTH = 32;
// WP41 F1: het geheim staat in een eigen header; `Authorization` telt niet.
const SECRET_HEADER = "X-Clubboek-Secret";

// Eén weigering voor elke oorzaak (§A5): zelfde status, body en headers op alle
// drie de routes. Noemt geen geheim, env-var of groep.
const refused = () => Response.json({ v: 1, error: "forbidden" }, { status: 403 });
const tooLarge = () => Response.json({ v: 1, error: "too_large" }, { status: 413 });
const invalid = (reason: string) => Response.json({ v: 1, error: "invalid", reason }, { status: 400 });
const notFound = () => Response.json({ v: 1, error: "not_found" }, { status: 404 });

type SecretKind = "read" | "purge";

const SECRET_ENV: Record<SecretKind, { current: string; previous: string }> = {
  read: { current: "CLAIMS_SECRET", previous: "CLAIMS_SECRET_PREVIOUS" },
  purge: { current: "CLAIMS_PURGE_SECRET", previous: "CLAIMS_PURGE_SECRET_PREVIOUS" },
};

const env = (name: string): string => process.env[name] ?? "";
const usable = (secret: string): boolean => secret.length >= MIN_SECRET_LENGTH;

/**
 * Klopt het gegeven geheim voor deze soort? Het huidige geheim is verplicht
 * (minstens 32 tekens); zonder telt ook de vorige niet (A-keuze 1). Een
 * vorige korter dan 32 tekens telt niet. Beide vergelijkingen lopen altijd,
 * zonder vroeg te stoppen.
 */
function secretMatches(given: string, kind: SecretKind): boolean {
  const current = env(SECRET_ENV[kind].current);
  const previous = env(SECRET_ENV[kind].previous);
  const eqCurrent = constantTimeEqual(given, current);
  const eqPrevious = constantTimeEqual(given, previous);
  return given.length > 0 && usable(current) && (eqCurrent || (eqPrevious && usable(previous)));
}

/**
 * A-keuze 2: is een purge-geheim gelijk aan een lees-geheim, dan is opruimen
 * dicht (fail-closed): wie mag lezen, mag dan niet ook opruimen. Alleen
 * waarden die als geheim tellen (minstens 32 tekens); een te korte telt nergens.
 */
function purgeSecretsCollide(): boolean {
  const purge = [env("CLAIMS_PURGE_SECRET"), env("CLAIMS_PURGE_SECRET_PREVIOUS")].filter(usable);
  const read = [env("CLAIMS_SECRET"), env("CLAIMS_SECRET_PREVIOUS")].filter(usable);
  let collide = false;
  for (const p of purge) for (const r of read) collide = constantTimeEqual(p, r) || collide;
  return collide;
}

/**
 * F4: is een geheim van deze soort (huidig of vorig) gelijk aan het geheim van
 * de afrekeningen (`FINANCE_SECRET`, WP41), dan is de route van deze soort
 * dicht. De andere soort werkt gewoon.
 */
function sharesFinanceSecret(kind: SecretKind): boolean {
  const finance = env("FINANCE_SECRET");
  if (finance === "") return false;
  const own = [env(SECRET_ENV[kind].current), env(SECRET_ENV[kind].previous)].filter(usable);
  let shared = false;
  for (const s of own) shared = constantTimeEqual(s, finance) || shared;
  return shared;
}

/**
 * De groep van de deployment, of `null` bij elke oorzaak van weigering (§A5):
 * een ontbrekend of te kort geheim, geen of een fout `X-Clubboek-Secret`, het
 * geheim van de andere soort, een purge-geheim gelijk aan een lees-geheim,
 * een geheim van deze soort gelijk aan `FINANCE_SECRET` (F4), of een
 * `CLAIMS_GROUP_ID` die geen bestaande groep is.
 */
async function claimsAccess(ctx: ActionCtx, request: Request, kind: SecretKind): Promise<Id<"groups"> | null> {
  const given = request.headers.get(SECRET_HEADER) ?? "";
  const match = secretMatches(given, kind);
  const collide = kind === "purge" ? purgeSecretsCollide() : false;
  const shared = sharesFinanceSecret(kind);
  const groupId = env("CLAIMS_GROUP_ID");
  if (!match || collide || shared || groupId === "") return null;
  return await ctx.runQuery(internal.expenseClaims.claimsGroup, { groupId });
}

type Body = { kind: "ok"; value: unknown } | { kind: "too_large" } | { kind: "invalid" };

/** De body als JSON, met een grens in bytes. Te groot gaat vóór kapot (§A7.2). */
async function readJson(request: Request, maxBytes: number): Promise<Body> {
  const declared = Number(request.headers.get("Content-Length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return { kind: "too_large" };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return { kind: "invalid" };
  }
  if (bytes.byteLength > maxBytes) return { kind: "too_large" };
  try {
    return { kind: "ok", value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { kind: "invalid" };
  }
}

/** `GET /claims` (§A6). Query-parameters doen niets. */
export async function getClaimsRoute(ctx: ActionCtx, request: Request): Promise<Response> {
  const groupId = await claimsAccess(ctx, request, "read");
  if (!groupId) return refused();
  const claims = await ctx.runQuery(internal.expenseClaims.listForClubbook, { groupId });
  if (claims === null) return refused();
  return Response.json({ v: 1, claims }, { status: 200 });
}

/** `POST /claims/decision` (§A7): 403, 413, 400 vorm, dan de interne mutation. */
export async function postDecisionRoute(ctx: ActionCtx, request: Request): Promise<Response> {
  const groupId = await claimsAccess(ctx, request, "read");
  if (!groupId) return refused();
  const body = await readJson(request, DECISION_MAX_BODY_BYTES);
  if (body.kind === "too_large") return tooLarge();
  if (body.kind === "invalid") return invalid("body: geen geldige JSON");
  const parsed = parseDecisionRequest(body.value);
  if (!parsed.ok) return invalid(parsed.reason);

  const result = await ctx.runMutation(internal.expenseClaims.decideFromClubbook, { groupId, ...parsed.value });
  switch (result.kind) {
    case "refused":
      return refused();
    case "not_found":
      return notFound();
    case "invalid":
      return invalid(result.reason);
    case "withdrawn":
      return Response.json({ v: 1, error: "withdrawn", claim: result.claim }, { status: 409 });
    case "changed":
      return Response.json({ v: 1, error: "changed", claim: result.claim }, { status: 409 });
    case "ok":
      return Response.json({ v: 1, ok: true, revision: result.revision }, { status: 200 });
  }
}

/** `POST /claims/purge` (§A8): eigen geheim, 413, 400 vorm, dan de interne mutation. */
export async function postPurgeRoute(ctx: ActionCtx, request: Request): Promise<Response> {
  const groupId = await claimsAccess(ctx, request, "purge");
  if (!groupId) return refused();
  const body = await readJson(request, PURGE_MAX_BODY_BYTES);
  if (body.kind === "too_large") return tooLarge();
  if (body.kind === "invalid") return invalid("body: geen geldige JSON");
  const parsed = parsePurgeRequest(body.value);
  if (!parsed.ok) return invalid(parsed.reason);

  const result = await ctx.runMutation(internal.expenseClaims.purgeFromClubbook, {
    groupId,
    claims: parsed.value.claims,
  });
  if (result.kind === "refused") return refused();
  return Response.json({ v: 1, ok: true, deleted: result.deleted, skipped: result.skipped }, { status: 200 });
}
