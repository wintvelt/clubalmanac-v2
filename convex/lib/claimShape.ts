import { v } from "convex/values";
import { hasForbiddenChar } from "./names";

// WP45 — de vorm van een declaratie: statussen, invoerregels (§A3), grenzen
// (§A4, §A9) en het lezen van de verzoeken van het clubboek (§A7, §A8).
// Spec: docs/work-packages/WP45-declaraties.md.

export const claimStatus = v.union(
  v.literal("draft"),
  v.literal("submitted"),
  v.literal("processed"),
  v.literal("adjusted"),
  v.literal("rejected"),
  v.literal("withdrawn"),
);

export type ClaimStatus = "draft" | "submitted" | "processed" | "adjusted" | "rejected" | "withdrawn";
export type DecisionStatus = "processed" | "adjusted" | "rejected";

/** Na een besluit of intrekken: wat het clubboek mag opruimen (besluit 8). */
export const SETTLED_STATUSES: readonly ClaimStatus[] = ["processed", "adjusted", "rejected", "withdrawn"];
/** Waaruit het lid mag intrekken (draft-tabel, §A2). */
export const WITHDRAWABLE_STATUSES: readonly ClaimStatus[] = ["submitted", "processed", "adjusted", "rejected"];

// §A4 en §A9: per lid per groep (besluit 7).
export const DRAFTS_PER_MEMBER = 20;
export const SUBMITTED_PER_MEMBER = 20;
export const SUBMITS_PER_DAY = 20;
export const SUBMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
// F1: bewaard en niet-concept (elke status behalve `draft`), tot het clubboek
// opruimt. Houdt GET /claims, G7 en MON1 binnen één Convex-functie.
export const KEPT_PER_MEMBER = 200;

export const AMOUNT_MAX_CENTS = 1_000_000;
const TITLE_MAX = 80;
const NOTE_MAX = 300;
export const DECISION_MAX_BODY_BYTES = 8 * 1024;
export const PURGE_MAX_BODY_BYTES = 32 * 1024;
export const PURGE_MAX_ITEMS = 200;

// --- tekens -----------------------------------------------------------------------

// Tekens, niet UTF-16-eenheden: een emoji telt als één (A-keuze 7).
const textLength = (s: string): number => Array.from(s).length;

// Een losse surrogaathelft (geen well-formed Unicode).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * F3: de tekenregel van namen (lib/names.ts): geen control-tekens, geen
 * regel- of alineascheiding, geen bidi-tekens en niets onzichtbaars; ZWJ,
 * ZWNJ en VS15/VS16 alleen in hun context. Plus well-formed Unicode.
 */
const hasBadChar = (text: string): boolean => LONE_SURROGATE.test(text) || hasForbiddenChar(text);

/** De titel zoals hij bewaard wordt (rand-witruimte eraf), of `null` als hij niet mag (§A3). */
export function cleanTitle(raw: string): string | null {
  const title = raw.trim();
  if (hasBadChar(title)) return null;
  const n = textLength(title);
  return n >= 1 && n <= TITLE_MAX ? title : null;
}

/** Een geheel aantal centen van 1 tot 1.000.000 (draft-invariant 7). */
export function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= AMOUNT_MAX_CENTS;
}

// --- datum --------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_DATE = "2000-01-01";

/** `jjjj-mm-dd` en een datum die echt bestaat (geen 31 november). */
function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** 01:00 UTC op de laatste zondag van de maand (EU-regel voor zomertijd). */
function lastSundayAt1Utc(year: number, monthIndex: number): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  const day = lastDay.getUTCDate() - lastDay.getUTCDay();
  return Date.UTC(year, monthIndex, day, 1, 0, 0);
}

/**
 * De datum in Nederland (`Europe/Amsterdam`, besluit 6): CET (UTC+1), en CEST
 * (UTC+2) van de laatste zondag van maart tot de laatste zondag van oktober,
 * telkens om 01:00 UTC. Uitgerekend, zodat het niet afhangt van de
 * tijdzone-gegevens van de runtime. Dit is de EU-regel voor de zomertijd:
 * verandert die (of Nederland), dan moet deze functie mee.
 */
export function dateInNetherlands(now: number): string {
  const year = new Date(now).getUTCFullYear();
  const summer = now >= lastSundayAt1Utc(year, 2) && now < lastSundayAt1Utc(year, 9);
  const offset = (summer ? 2 : 1) * 60 * 60 * 1000;
  return new Date(now + offset).toISOString().slice(0, 10);
}

/** §A3: een echte datum, vanaf 2000-01-01, niet na vandaag in Nederland. */
export function isExpenseDate(value: string, now: number): boolean {
  return isIsoDate(value) && value >= MIN_DATE && value <= dateInNetherlands(now);
}

// --- de verzoeken van het clubboek -----------------------------------------------------

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export type DecisionRequest = {
  id: string;
  status: DecisionStatus;
  processedCents: number | null;
  note: string | null;
  revision: number;
};

export type PurgeRequest = { claims: Array<{ id: string; revision: number }> };

class Invalid extends Error {}

// De reden noemt een pad en een korte reden, nooit een waarde uit de body (§A7.3).
function fail(path: string, reason: string): never {
  throw new Invalid(`${path}: ${reason}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Precies deze sleutels; een onbekende wordt niet bij naam genoemd. */
function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  for (const k of Object.keys(value)) if (!keys.includes(k)) fail(path, "onbekend veld");
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, k)) fail(path ? `${path}.${k}` : k, "ontbreekt");
  }
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * De toelichting zoals hij bewaard en vergeleken wordt (A-keuze 6): `\r\n`
 * wordt `\n`, rand-witruimte eraf, leeg wordt `null`. Daarna ten hoogste 300
 * tekens, alleen `\n` als regeleinde.
 */
function cleanNote(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") fail("note", "moet tekst of null zijn");
  if (LONE_SURROGATE.test(value)) fail("note", "geen geldige Unicode");
  const note = value.replace(/\r\n/g, "\n").trim();
  if (note.length === 0) return null;
  // Besluit 9 en F3: `\n` mag; elke regel volgt de tekenregel van de titel.
  if (note.split("\n").some(hasBadChar)) fail("note", "verboden teken (alleen een regeleinde mag)");
  if (textLength(note) > NOTE_MAX) fail("note", `langer dan ${NOTE_MAX} tekens`);
  return note;
}

const DECISION_KEYS = ["id", "status", "processedCents", "note", "revision"] as const;

/** §A7.3: de vorm van een besluit. Het bedrag tegen de declaratie komt later (§A7.6). */
export function parseDecisionRequest(raw: unknown): ParseResult<DecisionRequest> {
  try {
    if (!isPlainObject(raw)) fail("body", "moet een object zijn");
    exactKeys(raw, DECISION_KEYS, "body");
    if (typeof raw.id !== "string") fail("id", "moet tekst zijn");
    const status = raw.status;
    if (status !== "processed" && status !== "adjusted" && status !== "rejected") {
      fail("status", "moet processed, adjusted of rejected zijn");
    }
    const cents = raw.processedCents;
    if (cents !== null && !isAmount(cents)) {
      fail("processedCents", `moet een geheel getal van 1 tot ${AMOUNT_MAX_CENTS} zijn, of null`);
    }
    if (status === "rejected" && cents !== null) fail("processedCents", "moet null zijn bij rejected");
    if (status !== "rejected" && cents === null) fail("processedCents", "ontbreekt bij processed of adjusted");
    const note = cleanNote(raw.note);
    if (!isRevision(raw.revision)) fail("revision", "moet een geheel getal vanaf 1 zijn");
    return { ok: true, value: { id: raw.id, status, processedCents: cents, note, revision: raw.revision } };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, reason: error.message };
    throw error;
  }
}

/** §A8: de vorm van een opruimverzoek. */
export function parsePurgeRequest(raw: unknown): ParseResult<PurgeRequest> {
  try {
    if (!isPlainObject(raw)) fail("body", "moet een object zijn");
    exactKeys(raw, ["claims"], "body");
    const list = raw.claims;
    if (!Array.isArray(list)) fail("claims", "moet een lijst zijn");
    if (list.length > PURGE_MAX_ITEMS) fail("claims", `meer dan ${PURGE_MAX_ITEMS} elementen`);
    const seen = new Set<string>();
    const claims = list.map((item: unknown, i: number) => {
      const path = `claims[${i}]`;
      if (!isPlainObject(item)) fail(path, "moet een object zijn");
      exactKeys(item, ["id", "revision"], path);
      if (typeof item.id !== "string") fail(`${path}.id`, "moet tekst zijn");
      if (!isRevision(item.revision)) fail(`${path}.revision`, "moet een geheel getal vanaf 1 zijn");
      if (seen.has(item.id)) fail(`${path}.id`, "staat al eerder in de lijst");
      seen.add(item.id);
      return { id: item.id, revision: item.revision };
    });
    return { ok: true, value: { claims } };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, reason: error.message };
    throw error;
  }
}
