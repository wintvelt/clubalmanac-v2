// WP20: pure logica achter "Gemelde foto's" (eigenaar) en de wachtrij van de
// webmaster. Spec: docs/work-packages/WP20-melden.md §A-invarianten, A-keuze 7.
//
// De fasen volgen de backend (photos.appeal, decideFlag, de cron FL1):
//   gemeld     geen bezwaar, niet afgewezen  → bezwaar kan; verdwijnt op flaggedDeleteDate
//   bezwaar    bezwaar, geen besluit         → bezwaar kan niet meer; geen datum (gepauzeerd)
//   afgewezen  besluit "afgewezen"           → bezwaar kan niet; verdwijnt op flaggedDeleteDate
// Gemigreerde meldingen (WP12) hebben datums op dag-niveau en soms geen
// verwijderdatum; dan is de datum onbekend (`null`).

// `flaggedAt` is optioneel in de vorm van de backend (lib/shapes), maar de
// lijsten geven alleen foto's waar hij gezet is.
export type FlagDates = {
  flaggedAt?: number;
  flaggedDeleteDate?: number;
  flaggedAppealDate?: number;
  flaggedAppealDenyDate?: number;
};

export type FlagStage = "flagged" | "appealed" | "denied";

export type OwnFlagView = {
  stage: FlagStage;
  canAppeal: boolean;
  deleteAt: number | null;
};

export function flagStage(p: FlagDates): FlagStage {
  if (p.flaggedAppealDenyDate !== undefined) return "denied";
  if (p.flaggedAppealDate !== undefined) return "appealed";
  return "flagged";
}

export function ownFlagView(p: FlagDates): OwnFlagView {
  const stage = flagStage(p);
  return {
    stage,
    canAppeal: stage === "flagged",
    deleteAt: stage === "appealed" ? null : (p.flaggedDeleteDate ?? null),
  };
}

/** Wacht deze melding op een besluit van de webmaster? */
function awaitsDecision(p: FlagDates): boolean {
  return flagStage(p) === "appealed";
}

/**
 * A-keuze 7: eerst een bezwaar zonder besluit, dan de rest; binnen elke groep
 * de oudste melding eerst. Voor `Array.prototype.sort`.
 */
export function flagQueueOrder(a: FlagDates, b: FlagDates): number {
  const wa = awaitsDecision(a) ? 0 : 1;
  const wb = awaitsDecision(b) ? 0 : 1;
  if (wa !== wb) return wa - wb;
  return (a.flaggedAt ?? 0) - (b.flaggedAt ?? 0);
}

const MONTHS = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

/**
 * Een datum op dag-niveau, zoals "28 november 2026". In UTC, zoals de mail
 * (convex/lib/emailTemplates formatNlDate): gemigreerde datums zijn middernacht
 * UTC, en de cron wist om 03:00 UTC.
 */
export function flagDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** De stand in woorden, voor eigenaar en webmaster. */
export function flagStageLabel(stage: FlagStage): string {
  switch (stage) {
    case "flagged":
      return "Gemeld, nog geen bezwaar";
    case "appealed":
      return "Bezwaar gemaakt, wacht op besluit";
    case "denied":
      return "Bezwaar afgewezen";
  }
}
