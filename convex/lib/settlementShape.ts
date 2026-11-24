import { v, type Infer } from "convex/values";

// WP41 — de vorm van een afrekening uit het clubboek (spec §A2) en de grenzen
// (§A3). Twee kanten van hetzelfde contract:
//   - de Convex-validators voor het schema en de return-validators van de
//     reads: getypt, zonder `any` of `record`;
//   - `parseSettlementRequest`: de controle van het verzoek in de HTTP-route,
//     met een korte reden die het pad van het veld noemt en nooit een waarde
//     uit de body (A-keuze 11, A4.3). Een veld buiten het contract, waar ook,
//     is een fout (A-invariant 3), en elk totaal is de som van zijn rijen
//     (A-invariant 6).
// Bedragen zijn hele centen; Convex en de app ronden niets af en rekenen geen
// totalen na (A-invariant 1).

// --- grenzen (A3) ---------------------------------------------------------------

export const SETTLEMENT_MAX_BODY_BYTES = 128 * 1024;
export const SETTLEMENTS_PER_GROUP = 40;
const MAX_TEXT = 200;
const MAX_KEY = 64;
const MAX_ROWS = 100;
const MAX_PARTS = 50;
const MAX_LINES = 50;
const MAX_PAYMENTS = 50;
const MAX_SAVINGS = 100;
const MAX_MONTHS = 60;
const MAX_CENTS = 1_000_000_000;
const MAX_COUNT = 1000;

export const SETTLEMENT_KEY = /^[A-Za-z0-9_-]{1,64}$/;

/** Een geldige sleutel (A3): 1 tot 64 tekens uit `A–Z a–z 0–9 _ -`. */
export function isSettlementKey(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_KEY && SETTLEMENT_KEY.test(value);
}

// --- Convex-validators ------------------------------------------------------------

const cents = v.number();
const centsOrNull = v.union(v.number(), v.null());
const date = v.string();

export const settlementPart = v.object({
  name: v.string(),
  costs: cents,
  count: v.number(),
  pricePerPerson: centsOrNull,
});

export const settlementRow = v.object({
  name: v.string(),
  costs: cents,
  club: cents,
  fromPot: cents,
  potBefore: centsOrNull,
  potAfter: centsOrNull,
  advanced: cents,
  balance: cents,
  open: cents,
  cells: v.array(centsOrNull),
  lines: v.array(v.object({ part: v.string(), amount: cents, basis: v.string() })),
  payments: v.array(v.object({ date, amount: cents })),
  savings: v.array(
    v.object({
      date,
      description: v.string(),
      amount: cents,
      months: v.union(v.array(v.object({ date, amount: cents })), v.null()),
    }),
  ),
});

export const settlementTotals = v.object({
  costs: cents,
  club: cents,
  fromPot: cents,
  potBefore: centsOrNull,
  potAfter: centsOrNull,
  advanced: cents,
  balance: cents,
  open: cents,
});

/** De inhoud van een afrekening zoals een lid hem leest (A6): het verzoek zonder `key`. */
export const settlementContentFields = {
  name: v.string(),
  period: v.string(),
  startDate: date,
  settledOn: v.union(date, v.null()),
  publishedOn: date,
  lustrum: v.boolean(),
  costPerPerson: centsOrNull,
  parts: v.array(settlementPart),
  rows: v.array(settlementRow),
  totals: settlementTotals,
};

export const settlementContent = v.object(settlementContentFields);
export type SettlementContent = Infer<typeof settlementContent>;

// --- de controle van het verzoek --------------------------------------------------

type Spec =
  | { k: "text"; required?: boolean; participant?: boolean }
  | { k: "key" }
  | { k: "date" }
  | { k: "bool" }
  | { k: "cents"; min?: number }
  | { k: "count" }
  | { k: "nullable"; of: Spec }
  | { k: "list"; of: Spec; min?: number; max: number }
  | { k: "object"; fields: Record<string, Spec> };

const text: Spec = { k: "text" };
const name: Spec = { k: "text", required: true };
// De naam van een deelnemer staat in de app-route (F2, A-keuze 12).
const participantName: Spec = { k: "text", required: true, participant: true };
const dateSpec: Spec = { k: "date" };
const amount: Spec = { k: "cents" };
const amountOrNull: Spec = { k: "nullable", of: amount };

const REQUEST: Spec = {
  k: "object",
  fields: {
    key: { k: "key" },
    name,
    period: text,
    startDate: dateSpec,
    settledOn: { k: "nullable", of: dateSpec },
    publishedOn: dateSpec,
    lustrum: { k: "bool" },
    costPerPerson: amountOrNull,
    parts: {
      k: "list",
      max: MAX_PARTS,
      of: {
        k: "object",
        fields: { name, costs: amount, count: { k: "count" }, pricePerPerson: amountOrNull },
      },
    },
    rows: {
      k: "list",
      min: 1,
      max: MAX_ROWS,
      of: {
        k: "object",
        fields: {
          name: participantName,
          costs: amount,
          club: amount,
          fromPot: amount,
          potBefore: amountOrNull,
          potAfter: amountOrNull,
          advanced: amount,
          balance: amount,
          open: { k: "cents", min: 0 },
          cells: { k: "list", max: MAX_PARTS, of: amountOrNull },
          lines: {
            k: "list",
            max: MAX_LINES,
            of: { k: "object", fields: { part: text, amount, basis: text } },
          },
          payments: {
            k: "list",
            max: MAX_PAYMENTS,
            // F3: wat de deelnemer betaalde, nooit negatief.
            of: { k: "object", fields: { date: dateSpec, amount: { k: "cents", min: 0 } } },
          },
          savings: {
            k: "list",
            max: MAX_SAVINGS,
            of: {
              k: "object",
              fields: {
                date: dateSpec,
                description: text,
                amount,
                months: {
                  k: "nullable",
                  of: {
                    k: "list",
                    max: MAX_MONTHS,
                    of: { k: "object", fields: { date: dateSpec, amount } },
                  },
                },
              },
            },
          },
        },
      },
    },
    totals: {
      k: "object",
      fields: {
        costs: amount,
        club: amount,
        fromPot: amount,
        potBefore: amountOrNull,
        potAfter: amountOrNull,
        advanced: amount,
        balance: amount,
        open: amount,
      },
    },
  },
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `jjjj-mm-dd` en een datum die echt bestaat (geen 30 februari). */
function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Tekens, niet UTF-16-eenheden: een emoji telt als één.
const textLength = (s: string): number => Array.from(s).length;

// F2: een losse surrogaathelft (geen well-formed Unicode).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// F2: control-tekens (C0, DEL, C1) en bidi-override- en isolate-tekens.
const FORBIDDEN_CHAR = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;
// F2: de naam van een deelnemer. Geen witruimte (ook geen harde spatie) aan de
// randen, niet alleen punten, geen `%` of `/`.
const EDGE_SPACE = /^\s|\s$/;
const ONLY_DOTS = /^\.+$/;
const ROUTE_CHAR = /[%/]/;

/** De sleutel voor uniekheid van een deelnemer: NFC, zonder hoofdletteronderscheid (A-keuze 12). */
function nameKey(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

class Invalid extends Error {}

function fail(path: string, reason: string): never {
  throw new Invalid(`${path}: ${reason}`);
}

/** Controleert `value` tegen `spec`; geeft de waarde terug met -0 als 0. */
function check(spec: Spec, value: unknown, path: string): unknown {
  switch (spec.k) {
    case "text":
      if (typeof value !== "string") fail(path, "moet tekst zijn");
      if (spec.required && value.length === 0) fail(path, "is leeg");
      if (LONE_SURROGATE.test(value)) fail(path, "geen geldige Unicode");
      if (FORBIDDEN_CHAR.test(value)) fail(path, "bevat een control- of richtingsteken");
      if (textLength(value) > MAX_TEXT) fail(path, `is langer dan ${MAX_TEXT} tekens`);
      if (spec.participant) {
        if (EDGE_SPACE.test(value)) fail(path, "witruimte aan begin of eind");
        if (ONLY_DOTS.test(value)) fail(path, "alleen punten");
        if (ROUTE_CHAR.test(value)) fail(path, "bevat % of /");
      }
      return value;
    case "key":
      if (!isSettlementKey(value)) fail(path, "ongeldige sleutel (1 tot 64 tekens, A-Z a-z 0-9 _ -)");
      return value;
    case "date":
      if (typeof value !== "string" || !isIsoDate(value)) fail(path, "geen geldige datum (jjjj-mm-dd)");
      return value;
    case "bool":
      if (typeof value !== "boolean") fail(path, "moet true of false zijn");
      return value;
    case "cents":
      if (typeof value !== "number" || !Number.isInteger(value)) fail(path, "geen geheel aantal centen");
      if (Math.abs(value) > MAX_CENTS) fail(path, "bedrag buiten de grens");
      if (spec.min !== undefined && value < spec.min) fail(path, "mag niet negatief zijn");
      return value === 0 ? 0 : value;
    case "count":
      if (typeof value !== "number" || !Number.isInteger(value)) fail(path, "geen geheel getal");
      if (value < 0 || value > MAX_COUNT) fail(path, `moet van 0 tot ${MAX_COUNT} zijn`);
      return value === 0 ? 0 : value;
    case "nullable":
      return value === null ? null : check(spec.of, value, path);
    case "list": {
      if (!Array.isArray(value)) fail(path, "moet een lijst zijn");
      if (spec.min !== undefined && value.length < spec.min) fail(path, `minstens ${spec.min} nodig`);
      if (value.length > spec.max) fail(path, `meer dan ${spec.max}`);
      return value.map((item, i) => check(spec.of, item, `${path}[${i}]`));
    }
    case "object": {
      if (!isPlainObject(value)) fail(path || "body", "moet een object zijn");
      // Een veld buiten het contract: het pad, niet de naam (die komt uit de body).
      for (const field of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(spec.fields, field)) fail(path || "body", "onbekend veld");
      }
      const out: Record<string, unknown> = {};
      for (const [field, fieldSpec] of Object.entries(spec.fields)) {
        const at = path === "" ? field : `${path}.${field}`;
        if (!Object.prototype.hasOwnProperty.call(value, field)) fail(at, "ontbreekt");
        out[field] = check(fieldSpec, value[field], at);
      }
      return out;
    }
  }
}

export type SettlementRequest = SettlementContent & { key: string };

const SUMMED = ["costs", "club", "fromPot", "advanced", "balance", "open"] as const;
const POTS = ["potBefore", "potAfter"] as const;

/**
 * De samenhang van A2: cellen per onderdeel, spaarpot bij een lustrum, unieke
 * namen (NFC, zonder hoofdletteronderscheid), betalingen alleen bij
 * bijbetalen, totalen.
 */
function checkCoherence(s: SettlementRequest): void {
  const names = new Set<string>();
  s.rows.forEach((row, i) => {
    const at = `rows[${i}]`;
    const key = nameKey(row.name);
    if (names.has(key)) fail(`${at}.name`, "komt twee keer voor");
    names.add(key);
    if (row.cells.length !== s.parts.length) fail(`${at}.cells`, "niet één cel per onderdeel");
    for (const pot of POTS) {
      if (s.lustrum && row[pot] === null) fail(`${at}.${pot}`, "moet bij een lustrum een bedrag zijn");
      if (!s.lustrum && row[pot] !== null) fail(`${at}.${pot}`, "moet null zijn als het geen lustrum is");
    }
    if (!s.lustrum && row.savings.length > 0) fail(`${at}.savings`, "moet leeg zijn als het geen lustrum is");
    // F3: het clubboek geeft betalingen alleen bij wie moet bijbetalen.
    if (row.balance <= 0 && row.payments.length > 0) fail(`${at}.payments`, "alleen bij balance > 0");
  });
  for (const field of SUMMED) {
    const sum = s.rows.reduce((a, r) => a + r[field], 0);
    if (s.totals[field] !== sum) fail(`totals.${field}`, "is niet de som van de rijen");
  }
  for (const pot of POTS) {
    const total = s.totals[pot];
    if (!s.lustrum) {
      if (total !== null) fail(`totals.${pot}`, "moet null zijn als het geen lustrum is");
      continue;
    }
    if (total === null) fail(`totals.${pot}`, "moet bij een lustrum een bedrag zijn");
    const sum = s.rows.reduce((a, r) => a + (r[pot] ?? 0), 0);
    if (total !== sum) fail(`totals.${pot}`, "is niet de som van de rijen");
  }
}

export type ParseResult = { ok: true; value: SettlementRequest } | { ok: false; error: string };

/**
 * Het verzoek van het clubboek, al als JSON gelezen. Geldig: de waarde zonder
 * velden buiten het contract. Ongeldig: een korte reden met het pad.
 */
export function parseSettlementRequest(raw: unknown): ParseResult {
  try {
    if (!isPlainObject(raw)) return { ok: false, error: "body: moet een JSON-object zijn" };
    const value = check(REQUEST, raw, "") as SettlementRequest;
    checkCoherence(value);
    return { ok: true, value };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}
