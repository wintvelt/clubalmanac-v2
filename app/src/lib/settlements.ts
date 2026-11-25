// WP41 — de pure logica van Geld (de afrekeningen uit het clubboek).
// Spec: docs/work-packages/WP41-financieel.md §A10 (app), A-keuzes 5–8.
//
// - Bedragen zijn hele centen uit het clubboek. De app rekent geen totalen,
//   afrondingen of tekens na: tegels en voettekst komen uit `totals`,
//   `costPerPerson` en `parts[].costs`. Alleen afgeleid: tellingen, `stillToPay`
//   en "terug" (= -balance).
// - Een bedrag breekt nooit: een harde spatie (U+00A0) na het euroteken en een
//   minteken (U+2212), geen gewone spatie of koppelteken.
// - Derde persoon (besluit 3): "Maarten betaalt nog", nooit "je".
// - De tab Geld alleen bij minstens één afrekening (invariant 8).

const NBSP = " ";
const MINUS = "−";

// --- vormen (zoals settlements.get en listByGroup ze geven) ----------------------

export type SettlementPart = { name: string; costs: number; count: number; pricePerPerson: number | null };

export type SettlementRow = {
  name: string;
  costs: number;
  club: number;
  fromPot: number;
  potBefore: number | null;
  potAfter: number | null;
  advanced: number;
  balance: number;
  open: number;
  cells: (number | null)[];
  lines: { part: string; amount: number; basis: string }[];
  payments: { date: string; amount: number }[];
  savings: { date: string; description: string; amount: number; months: { date: string; amount: number }[] | null }[];
};

export type SettlementTotals = {
  costs: number;
  club: number;
  fromPot: number;
  potBefore: number | null;
  potAfter: number | null;
  advanced: number;
  balance: number;
  open: number;
};

export type Settlement = {
  name: string;
  period: string;
  startDate: string;
  settledOn: string | null;
  publishedOn: string;
  lustrum: boolean;
  costPerPerson: number | null;
  parts: SettlementPart[];
  rows: SettlementRow[];
  totals: SettlementTotals;
};

// --- bedragen -----------------------------------------------------------------------

/** `123456` → `1.234,56` (zonder teken). */
function digits(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped},${rest}`;
}

/** `€ 1.234,56`; negatief `−€ 1.400,00`. Nul is nooit negatief. */
export function formatEuro(cents: number): string {
  const sign = cents < 0 ? MINUS : "";
  return `${sign}€${NBSP}${digits(cents)}`;
}

/** Een cel in de tabel, zonder euroteken (`912,40`); leeg bij null of 0, zoals `euro_leeg` in het clubboek. */
export function formatCell(cents: number | null): string {
  if (cents === null || cents === 0) return "";
  return `${cents < 0 ? MINUS : ""}${digits(cents)}`;
}

/** De afrekening rechts in de lijst Deelnemers: `−€ x` bijbetalen, `+€ x` terugkrijgen, `—` bij 0. */
export function balanceLabel(balance: number): string {
  if (balance === 0) return "—";
  return `${balance > 0 ? MINUS : "+"}€${NBSP}${digits(balance)}`;
}

/** De afrekening in de tabel: `−302,34`, `+130,00`, leeg bij 0. */
export function balanceCell(balance: number): string {
  if (balance === 0) return "";
  return `${balance > 0 ? MINUS : "+"}${digits(balance)}`;
}

// --- datums ----------------------------------------------------------------------------

const MONTHS = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

function dateParts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y ?? 0, m ?? 0, d ?? 0];
}

/** `2026-11-21` → `21 november 2026` (geen tijdzone: de datum zoals hij is). */
export function formatLongDate(iso: string): string {
  const [y, m, d] = dateParts(iso);
  return `${d}${NBSP}${MONTHS[m - 1] ?? ""} ${y}`;
}

/** `2026-06-18` → `18-6-2026`: zoals het clubboek hem toont (`j-n-Y`, zonder voorloopnul; A-keuze 13). */
export function formatShortDate(iso: string): string {
  const [y, m, d] = dateParts(iso);
  return `${d}-${m}-${y}`;
}

/** `2026-06-18` → `18-6`: in het spaarpot-overzicht, zonder jaartal (WP41b). */
export function formatDayMonth(iso: string): string {
  const [, m, d] = dateParts(iso);
  return `${d}-${m}`;
}

// --- tijdlijn ----------------------------------------------------------------------------

/** Het jaar van een ISO-datum, uit de tekst (geen tijdzone). */
function yearOfDate(iso: string): number {
  return Number(iso.slice(0, 4));
}

/** Opeenvolgende afrekeningen per jaar van `startDate`, in de volgorde van de backend. */
export function settlementsByYear<S extends { startDate: string }>(
  items: readonly S[],
): { year: number; settlements: S[] }[] {
  const out: { year: number; settlements: S[] }[] = [];
  for (const item of items) {
    const year = yearOfDate(item.startDate);
    const last = out[out.length - 1];
    if (last && last.year === year) last.settlements.push(item);
    else out.push({ year, settlements: [item] });
  }
  return out;
}

/** Het label op de kaart: `3 van 8 nog open`, of `Afgerond`. */
export function timelineLabel(item: { participantCount: number; openCount: number }): string {
  return item.openCount > 0 ? `${item.openCount} van ${item.participantCount} nog open` : "Afgerond";
}

/** De regel onder de naam op de kaart: de periode uit het clubboek en het aantal deelnemers. */
export function timelineMeta(item: { period: string; participantCount: number }): string {
  const count = participantsText(item.participantCount);
  return item.period ? `${item.period} · ${count}` : count;
}

export function participantsText(n: number): string {
  return n === 1 ? "1 deelnemer" : `${n} deelnemers`;
}

// --- per deelnemer -------------------------------------------------------------------------

export type ParticipantStatusKind = "done" | "pays" | "receives";

/** De status in de lijst Deelnemers: grijs `Afgerond`, rood `Nog € x`, groen `Krijgt nog € x` (x = open). */
export function participantStatus(row: Pick<SettlementRow, "balance" | "open">): {
  kind: ParticipantStatusKind;
  label: string;
} {
  if (row.open === 0) return { kind: "done", label: "Afgerond" };
  if (row.balance > 0) return { kind: "pays", label: `Nog ${formatEuro(row.open)}` };
  return { kind: "receives", label: `Krijgt nog ${formatEuro(row.open)}` };
}

/** De uitkomst bovenaan het scherm van één deelnemer: in de derde persoon of onpersoonlijk. */
export function participantOutcome(row: Pick<SettlementRow, "balance" | "open" | "fromPot">, lustrum: boolean): string {
  if (row.open > 0) {
    return row.balance > 0 ? `Betaalt nog ${formatEuro(row.open)}` : `Krijgt nog ${formatEuro(row.open)} terug`;
  }
  if (lustrum && row.balance === 0 && row.fromPot > 0) return "Deelname volledig uit spaarpot betaald";
  return "Afgerond";
}

/**
 * De regel onder de uitkomst (WP41b, zoals `evenement_lid.html` in het
 * clubboek): wat er na de afrekening in de spaarpot zit. Alleen bij een
 * lustrum en als dat niet 0 is; anders null.
 */
export function potAfterNote(row: Pick<SettlementRow, "potAfter">, lustrum: boolean): string | null {
  if (!lustrum || !row.potAfter) return null;
  return `Na de afrekening zit er ${formatEuro(row.potAfter)} in de spaarpot`;
}

/** De slotregel van de kosten: wat er bij moet of terug komt, als positief bedrag. */
export function balanceLine(balance: number): { label: string; cents: number } {
  if (balance > 0) return { label: "Bijbetalen", cents: balance };
  if (balance < 0) return { label: "Terugkrijgen", cents: -balance };
  return { label: "Afrekening", cents: 0 };
}

/** De betalingen in hun volgorde, samen hoogstens `due` (A-keuze 15). */
function paidUpTo(due: number, payments: readonly { date: string; amount: number }[]): { label: string; cents: number }[] {
  const lines: { label: string; cents: number }[] = [];
  let left = due;
  for (const p of payments) {
    if (left <= 0) break;
    const part = Math.min(p.amount, left);
    lines.push({ label: `Betaald op ${formatShortDate(p.date)}`, cents: -part });
    left -= part;
  }
  return lines;
}

/**
 * De regels van blok 3, Afrekening (F3). Een bedrag dat eraf gaat is negatief;
 * de regels tellen op tot de laatste (`open`). Bijbetalen: de naheffing, per
 * betaling `Betaald op d-m-jjjj`, dan wat nog open staat. Het betaalde totaal
 * is hoogstens de naheffing (A-keuze 15): de betaling die eroverheen gaat telt
 * alleen voor wat er nog over was, latere vallen weg; het teveel staat nergens. Terugkrijgen: het
 * bedrag, als er al iets af is één regel `Uitbetaald of verrekend` (het
 * clubboek geeft daar geen betalingen), dan wat nog open staat. Niets af te
 * rekenen: geen regels.
 */
export function paymentLines(
  row: Pick<SettlementRow, "balance" | "open" | "payments">,
): { label: string; cents: number }[] {
  const end = (label: string) => ({ label: row.open > 0 ? label : "Afgerond", cents: row.open });
  if (row.balance > 0) {
    return [
      { label: "Bijbetalen", cents: row.balance },
      ...paidUpTo(row.balance, row.payments),
      end("Nog te betalen"),
    ];
  }
  if (row.balance < 0) {
    const back = -row.balance;
    const settled = back - row.open;
    return [
      { label: "Terugkrijgen", cents: back },
      ...(settled !== 0 ? [{ label: "Uitbetaald of verrekend", cents: -settled }] : []),
      end("Nog terug te krijgen"),
    ];
  }
  return [];
}

// --- de afrekening ------------------------------------------------------------------------

/** De tegel "Nog te betalen" (A-keuze 5): de som van `open` van wie bijbetaalt, en hoeveel dat zijn. */
export function stillToPay(rows: readonly Pick<SettlementRow, "balance" | "open">[]): { cents: number; count: number } {
  const paying = rows.filter((r) => r.balance > 0 && r.open > 0);
  return { cents: paying.reduce((a, r) => a + r.open, 0), count: paying.length };
}

/** De regel onder een onderdeel: de prijs per persoon (als die er is) en het aantal deelnemers. */
export function partMeta(part: { count: number; pricePerPerson: number | null }): string {
  const count = participantsText(part.count);
  return part.pricePerPerson === null ? count : `${formatEuro(part.pricePerPerson)} pp · ${count}`;
}

// --- de hele tabel -------------------------------------------------------------------------

export type ColumnKey = "costs" | "club" | "fromPot" | "potAfter" | "advanced" | "balance" | "status";

export const COLUMN_TITLES: Record<ColumnKey, string> = {
  costs: "Kosten",
  club: "Clubkas",
  fromPot: "Uit spaarpot",
  potAfter: "Spaarpot na",
  advanced: "Voorgeschoten",
  balance: "Afrekening",
  status: "Status",
};

/**
 * De vaste kolommen na de onderdelen, in de volgorde van het clubboek. Clubkas
 * en Voorgeschoten alleen als hun totaal niet 0 is; de spaarpot alleen bij een
 * lustrum.
 */
export function visibleColumns(settlement: Pick<Settlement, "lustrum" | "totals">): ColumnKey[] {
  const cols: ColumnKey[] = ["costs"];
  if (settlement.totals.club !== 0) cols.push("club");
  if (settlement.lustrum) cols.push("fromPot", "potAfter");
  if (settlement.totals.advanced !== 0) cols.push("advanced");
  cols.push("balance", "status");
  return cols;
}

/** De tekst van een vaste kolom in de rij van een deelnemer. */
export function rowCell(row: SettlementRow, column: ColumnKey): string {
  switch (column) {
    case "costs":
      return formatCell(row.costs);
    case "club":
      return formatCell(row.club);
    case "fromPot":
      return formatCell(row.fromPot);
    case "potAfter":
      return formatCell(row.potAfter);
    case "advanced":
      return formatCell(row.advanced);
    case "balance":
      return balanceCell(row.balance);
    case "status":
      return row.open === 0 ? "✓" : `nog ${formatCell(row.open)}`;
  }
}

/** De tekst van een vaste kolom in de totaalrij: uit `totals`, niets nagerekend (A-keuze 7). */
export function totalCell(totals: SettlementTotals, column: ColumnKey): string {
  switch (column) {
    case "costs":
      return formatCell(totals.costs);
    case "club":
      return formatCell(totals.club);
    case "fromPot":
      return formatCell(totals.fromPot);
    case "potAfter":
      return formatCell(totals.potAfter);
    case "advanced":
      return formatCell(totals.advanced);
    case "balance":
      return balanceCell(totals.balance);
    case "status":
      return "";
  }
}

// --- de tab ----------------------------------------------------------------------------------

/** Of de groep afrekeningen heeft. Zolang de lijst laadt: nee (geen tab die weer verdwijnt). */
export function groupHasSettlements(list: readonly unknown[] | undefined): boolean {
  return (list?.length ?? 0) > 0;
}

export type GroupTabKey = "albums" | "films" | "leden" | "geld";

/** De groepstabs: Albums, (Films), Leden, (Geld). */
export function groupTabs(opts: { hasFilms: boolean; hasSettlements: boolean }): { key: GroupTabKey; title: string }[] {
  const tabs: { key: GroupTabKey; title: string }[] = [{ key: "albums", title: "Albums" }];
  if (opts.hasFilms) tabs.push({ key: "films", title: "Films" });
  tabs.push({ key: "leden", title: "Leden" });
  if (opts.hasSettlements) tabs.push({ key: "geld", title: "Geld" });
  return tabs;
}
