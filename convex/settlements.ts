import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getMembership, NOT_MEMBER, requireMemberForRead } from "./groups";
import { requireCurrentUser } from "./users";
import { constantTimeEqual } from "./lib/constantTime";
import {
  isSettlementKey,
  parseSettlementRequest,
  SETTLEMENT_MAX_BODY_BYTES,
  settlementContent,
  settlementContentFields,
  SETTLEMENTS_PER_GROUP,
} from "./lib/settlementShape";

// WP41 — Geld: de afrekeningen uit het clubboek.
// Spec: docs/work-packages/WP41-financieel.md (§A2–A9).
//
// Lezen (A6, A7): alleen een lid van de groep. Geen lid, een onbekende groep,
// een onbekende of weggehaalde afrekening: dezelfde NOT_MEMBER (invariant 1).
// Ook de webmaster heeft geen toegang buiten zijn groepen. Veld-whitelist via
// de return-validators (WP23): geen `key`, `groupId` of `receivedAt`.
//
// Schrijven (invariant 2, 3, 4): alleen het clubboek, via `POST` en `DELETE
// /settlements` naar de interne mutations hieronder. Er is geen publieke
// mutation of action in deze module. Het geheim (`FINANCE_SECRET`) hoort bij
// één groep (`FINANCE_GROUP_ID`); de groep komt nooit uit het verzoek. Eén
// weigering (403, steeds dezelfde body) voor elke oorzaak, vóór de body
// bekeken wordt (A-invariant 5). Het geheim, de header en de body komen niet
// in een log, antwoord of fout: deze module logt niets.
//
// Geen CORS: deze routes zijn niet voor een browser (geen OPTIONS, geen
// Access-Control-headers).

// --- lezen ----------------------------------------------------------------------

const listItem = v.object({
  _id: v.id("settlements"),
  name: v.string(),
  period: v.string(),
  startDate: v.string(),
  participantCount: v.number(),
  openCount: v.number(),
});

/**
 * De tijdlijn van een groep: per afrekening de samenvatting, nieuwste
 * startdatum eerst, bij gelijke datum op naam (A-keuze 4). Ook de bron voor
 * de tab Geld (invariant 8).
 */
export const listByGroup = query({
  args: { groupId: v.id("groups") },
  returns: v.array(listItem),
  handler: async (ctx, { groupId }) => {
    await requireMemberForRead(ctx, groupId);
    const docs = await ctx.db
      .query("settlements")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    docs.sort((a, b) => compare(b.startDate, a.startDate) || compare(a.name, b.name));
    return docs.map((s) => ({
      _id: s._id,
      name: s.name,
      period: s.period,
      startDate: s.startDate,
      participantCount: s.rows.length,
      openCount: s.rows.filter((r) => r.open > 0).length,
    }));
  },
});

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** De hele afrekening, voor het overzicht, de tabel en een deelnemer (A6). */
export const get = query({
  args: { settlementId: v.id("settlements") },
  returns: v.object({ _id: v.id("settlements"), ...settlementContentFields }),
  handler: async (ctx, { settlementId }) => {
    const user = await requireCurrentUser(ctx);
    const doc = await ctx.db.get(settlementId);
    if (!doc || !(await getMembership(ctx, user._id, doc.groupId))) throw new ConvexError(NOT_MEMBER);
    return { _id: doc._id, ...contentOf(doc) };
  },
});

function contentOf(doc: Doc<"settlements">) {
  return {
    name: doc.name,
    period: doc.period,
    startDate: doc.startDate,
    settledOn: doc.settledOn,
    publishedOn: doc.publishedOn,
    lustrum: doc.lustrum,
    costPerPerson: doc.costPerPerson,
    parts: doc.parts,
    rows: doc.rows,
    totals: doc.totals,
  };
}

// --- schrijven (alleen via de HTTP-routes) -----------------------------------------

/** De groep van het geheim, als hij (nog) bestaat. Een id uit een andere tabel telt niet. */
export const financeGroup = internalQuery({
  args: { groupId: v.string() },
  returns: v.union(v.id("groups"), v.null()),
  handler: async (ctx, { groupId }) => {
    const id = ctx.db.normalizeId("groups", groupId);
    if (!id) return null;
    return (await ctx.db.get(id)) ? id : null;
  },
});

async function groupExists(ctx: MutationCtx, groupId: Id<"groups">): Promise<boolean> {
  return (await ctx.db.get(groupId)) !== null;
}

/**
 * Vervangt de afrekening met deze sleutel in de groep, of maakt hem
 * (invariant 5). Vervangen houdt het `_id` (A-invariant 4). Een nieuwe sleutel
 * in een groep met al 40 afrekeningen: `full` (A-invariant 7). Is de groep
 * intussen weg: `refused`, en er wordt niets geschreven.
 */
export const replaceFromClubbook = internalMutation({
  args: { groupId: v.id("groups"), key: v.string(), settlement: settlementContent },
  returns: v.union(
    v.object({ kind: v.literal("ok"), participants: v.number() }),
    v.object({ kind: v.literal("full") }),
    v.object({ kind: v.literal("refused") }),
  ),
  handler: async (ctx, { groupId, key, settlement }) => {
    if (!(await groupExists(ctx, groupId))) return { kind: "refused" as const };
    const existing = await ctx.db
      .query("settlements")
      .withIndex("by_group_key", (q) => q.eq("groupId", groupId).eq("key", key))
      .unique();
    const doc = { groupId, key, ...settlement, receivedAt: Date.now() };
    if (existing) {
      await ctx.db.replace(existing._id, doc);
    } else {
      const inGroup = await ctx.db
        .query("settlements")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .take(SETTLEMENTS_PER_GROUP);
      if (inGroup.length >= SETTLEMENTS_PER_GROUP) return { kind: "full" as const };
      await ctx.db.insert("settlements", doc);
    }
    return { kind: "ok" as const, participants: settlement.rows.length };
  },
});

/** Haalt de afrekening met deze sleutel in de groep weg; bestaat hij niet, dan niets. */
export const removeFromClubbook = internalMutation({
  args: { groupId: v.id("groups"), key: v.string() },
  returns: v.union(v.literal("ok"), v.literal("refused")),
  handler: async (ctx, { groupId, key }) => {
    if (!(await groupExists(ctx, groupId))) return "refused" as const;
    const existing = await ctx.db
      .query("settlements")
      .withIndex("by_group_key", (q) => q.eq("groupId", groupId).eq("key", key))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return "ok" as const;
  },
});

// --- de HTTP-routes (convex/http.ts) --------------------------------------------------

const MIN_SECRET_LENGTH = 32;
const BEARER = "Bearer ";

// Eén weigering voor elke oorzaak (invariant 4, A4.1): zelfde status, body en
// headers. Noemt geen geheim, env-var of groep.
const refused = () => Response.json({ error: "Forbidden" }, { status: 403 });
const invalid = (error: string) => Response.json({ error }, { status: 400 });
const tooLarge = () => Response.json({ error: "body: groter dan 128 KiB" }, { status: 413 });

/**
 * De groep van het geheim, of `null` bij elke oorzaak van weigering: geen of
 * een te kort `FINANCE_SECRET` (A-keuze 3), geen `FINANCE_GROUP_ID`, geen
 * header, een ander schema dan `Bearer `, een fout of onvolledig geheim, of een
 * groep die niet (meer) bestaat. De vergelijking stopt niet vroeg.
 */
async function financeAccess(ctx: ActionCtx, request: Request): Promise<Id<"groups"> | null> {
  const expected = process.env.FINANCE_SECRET ?? "";
  const groupId = process.env.FINANCE_GROUP_ID ?? "";
  const header = request.headers.get("Authorization") ?? "";
  const bearer = header.startsWith(BEARER);
  const given = bearer ? header.slice(BEARER.length) : "";
  const equal = constantTimeEqual(given, expected);
  const open = equal && bearer && given.length > 0 && expected.length >= MIN_SECRET_LENGTH && groupId !== "";
  if (!open) return null;
  return await ctx.runQuery(internal.settlements.financeGroup, { groupId });
}

/** `POST /settlements` (A4): toegang, grootte, vorm, schrijven; in die volgorde. */
export async function postSettlementRoute(ctx: ActionCtx, request: Request): Promise<Response> {
  const groupId = await financeAccess(ctx, request);
  if (!groupId) return refused();

  const declared = Number(request.headers.get("Content-Length") ?? "");
  if (Number.isFinite(declared) && declared > SETTLEMENT_MAX_BODY_BYTES) return tooLarge();
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return invalid("body: niet volledig ontvangen");
  }
  if (bytes.byteLength > SETTLEMENT_MAX_BODY_BYTES) return tooLarge();

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return invalid("body: geen geldige JSON");
  }
  const parsed = parseSettlementRequest(raw);
  if (!parsed.ok) return invalid(parsed.error);

  const { key, ...settlement } = parsed.value;
  const result = await ctx.runMutation(internal.settlements.replaceFromClubbook, { groupId, key, settlement });
  if (result.kind === "refused") return refused();
  if (result.kind === "full") return invalid(`key: al ${SETTLEMENTS_PER_GROUP} afrekeningen in deze groep`);
  return Response.json({ participants: result.participants }, { status: 200 });
}

/** `DELETE /settlements?key=…` (A5): hetzelfde antwoord of er iets was of niet. */
export async function deleteSettlementRoute(ctx: ActionCtx, request: Request): Promise<Response> {
  const groupId = await financeAccess(ctx, request);
  if (!groupId) return refused();

  const key = new URL(request.url).searchParams.get("key");
  if (!isSettlementKey(key)) return invalid("key: ontbreekt of ongeldig (1 tot 64 tekens, A-Z a-z 0-9 _ -)");

  const result = await ctx.runMutation(internal.settlements.removeFromClubbook, { groupId, key });
  if (result === "refused") return refused();
  return Response.json({ ok: true }, { status: 200 });
}
