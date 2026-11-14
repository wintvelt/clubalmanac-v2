import { ConvexError } from "convex/values";

// WP20: pure logica achter ideeën en problemen. Spec:
// docs/work-packages/WP20-melden.md §A-invarianten (1: codes), A-keuze 6
// (statusnamen) en 7 (volgorde).

/** Zelfde grenzen als de backend (convex/lib/names.ts), in tekens. */
export const TITLE_MAX_LENGTH = 100;
export const DESCRIPTION_MAX_LENGTH = 2000;

export type FeatureStatus = "open" | "planned" | "inProgress" | "done" | "rejected";
export type FeatureType = "feature" | "problem";

export const FEATURE_STATUSES: FeatureStatus[] = ["open", "planned", "inProgress", "done", "rejected"];

export function featureStatusLabel(status: FeatureStatus): string {
  switch (status) {
    case "open":
      return "Nieuw";
    case "planned":
      return "Gepland";
    case "inProgress":
      return "Mee bezig";
    case "done":
      return "Klaar";
    case "rejected":
      return "Afgewezen";
  }
}

const MESSAGE_BY_CODE: Record<string, string> = {
  TITLE_REQUIRED: "Vul een titel in.",
  TITLE_TOO_LONG: `De titel is te lang. Gebruik hoogstens ${TITLE_MAX_LENGTH} tekens.`,
  TITLE_INVALID:
    "De titel bevat een teken dat niet mag, zoals een regeleinde, een tab of een onzichtbaar teken. Haal dat weg en probeer het opnieuw.",
  DESCRIPTION_TOO_LONG: `De omschrijving is te lang. Gebruik hoogstens ${DESCRIPTION_MAX_LENGTH} tekens.`,
  DESCRIPTION_INVALID:
    "De omschrijving bevat een teken dat niet mag, zoals een tab of een onzichtbaar teken. Haal dat weg en probeer het opnieuw.",
};

const GENERIC = "Versturen lukt nu niet. Controleer je internetverbinding en probeer het opnieuw.";

/** Welk veld een code betreft, zodat het scherm de melding bij dat veld zet. */
export function featureErrorField(error: unknown): "title" | "description" | null {
  const code = codeOf(error);
  if (code?.startsWith("TITLE_") && MESSAGE_BY_CODE[code]) return "title";
  if (code?.startsWith("DESCRIPTION_") && MESSAGE_BY_CODE[code]) return "description";
  return null;
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof ConvexError)) return undefined;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return undefined;
  const code: unknown = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** De melding bij een fout uit features.create of update: per code, anders algemeen. */
export function featureErrorText(error: unknown): string {
  const code = codeOf(error);
  return (code !== undefined && MESSAGE_BY_CODE[code]) || GENERIC;
}

type Sortable = { upvoteCount: number; createdAt: number };

/** A-keuze 7: meeste stemmen eerst; bij gelijk aantal het nieuwste eerst. Maakt een kopie. */
export function sortIdeas<T extends Sortable>(ideas: readonly T[]): T[] {
  return [...ideas].sort((a, b) => b.upvoteCount - a.upvoteCount || b.createdAt - a.createdAt);
}

/** A-keuze 7: problemen nieuwste eerst. Maakt een kopie. */
export function sortProblems<T extends { createdAt: number }>(problems: readonly T[]): T[] {
  return [...problems].sort((a, b) => b.createdAt - a.createdAt);
}
