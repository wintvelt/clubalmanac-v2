import { ConvexError } from "convex/values";

// WP15b invarianten 1 en 10: de melding onder het naamveld. Hij komt uit de
// `code` van de ConvexError die users.updateProfile gooit, nooit uit de tekst
// van een fout: die is in productie "Server Error". Elke andere fout geeft de
// algemene melding.

/** Zelfde maximum als de backend (convex/lib/constants.ts), in tekens. */
export const NAME_MAX_LENGTH = 50;

const MESSAGE_BY_CODE: Record<string, string> = {
  NAME_EMPTY: "Vul een naam in. Je naam kan niet leeg zijn.",
  NAME_TOO_LONG: `Je naam is te lang. Gebruik hoogstens ${NAME_MAX_LENGTH} tekens.`,
  NAME_INVALID: "Je naam bevat een teken dat niet mag, zoals een tab of een onzichtbaar teken. Haal dat weg en probeer het opnieuw.",
};

const GENERIC = "Opslaan lukt nu niet. Controleer je internetverbinding en probeer het opnieuw.";

export function nameErrorText(error: unknown): string {
  if (!(error instanceof ConvexError)) return GENERIC;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return GENERIC;
  const code: unknown = (data as { code?: unknown }).code;
  return (typeof code === "string" && MESSAGE_BY_CODE[code]) || GENERIC;
}
