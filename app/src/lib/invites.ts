import { ConvexError } from "convex/values";
import { dutchOffset, MONTHS } from "./photos";

// WP19b: pure logica achter Uitnodigen, Uitnodigingen en het blok
// "Uitgenodigd" in Leden. Spec: docs/work-packages/WP19b-uitnodigen-aanmelden.md
// (§Scherm in de app). De backend is de garantie; dit zet een weigering om in
// een Nederlandse melding en houdt de verzendlijst bij.

export type InviteAction = "create" | "accept" | "decline" | "remove";

/** Een regel op de verzendlijst. */
export type InviteDraftRow = { key: string; name: string; email: string; admin: boolean };

export function emptyRow(key: string): InviteDraftRow {
  return { key, name: "", email: "", admin: false };
}

/** Een regel is klaar om te versturen als naam en e-mail zijn ingevuld. */
export function rowReady(row: InviteDraftRow): boolean {
  return row.name.trim().length > 0 && row.email.trim().length > 0;
}

/** Wat `invites.create` per regel krijgt. Een leeg bericht gaat niet mee. */
export function createArgs(
  row: InviteDraftRow,
  groupId: string,
  message: string,
): { name: string; email: string; groupId: string; role: "admin" | "member"; message?: string } {
  const trimmed = message.trim();
  return {
    name: row.name.trim(),
    email: row.email.trim(),
    groupId,
    role: row.admin ? "admin" : "member",
    ...(trimmed ? { message: trimmed } : {}),
  };
}

function dataOf(error: unknown): { code: string | null; email: string | null } {
  if (!(error instanceof ConvexError)) return { code: null, email: null };
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return { code: null, email: null };
  const code: unknown = (data as { code?: unknown }).code;
  const email: unknown = (data as { email?: unknown }).email;
  return {
    code: typeof code === "string" ? code : null,
    email: typeof email === "string" ? email : null,
  };
}

/** De weigering is "niet meer geldig": geen fout, een gewone mededeling. */
export function isInviteGone(error: unknown): boolean {
  return dataOf(error).code === "INVITE_INVALID";
}

export const INVITE_GONE_TEXT = "Deze uitnodiging is niet meer geldig.";

const GENERIC = "Dat lukte niet. Er is niets veranderd. Controleer je verbinding en probeer het opnieuw.";

// Alleen de code telt, nooit de tekst van de fout ("Server Error" in productie).
export function inviteRefusalText(error: unknown, action: InviteAction): string {
  const { code, email } = dataOf(error);
  const who = email ?? "Dit adres";
  switch (code) {
    case "ALREADY_MEMBER":
      return `${who} is al lid van deze groep.`;
    case "ALREADY_INVITED":
      return `${who} heeft al een open uitnodiging voor deze groep.`;
    case "EMAIL_INVALID":
      return "Dit is geen geldig e-mailadres. Controleer het en probeer het opnieuw.";
    case "NAME_REQUIRED":
      return "Vul een naam in.";
    case "NAME_TOO_LONG":
      return "De naam is te lang. Gebruik hoogstens 50 tekens.";
    case "NAME_INVALID":
      return "De naam bevat een teken dat niet mag, zoals een tab of een onzichtbaar teken. Haal dat weg en probeer het opnieuw.";
    case "MESSAGE_TOO_LONG":
      return "Het bericht is te lang. Gebruik hoogstens 1000 tekens.";
    case "INVITE_INVALID":
      return INVITE_GONE_TEXT;
    case "NOT_ALLOWED":
      return "Dat kan alleen een admin. Misschien ben je net lid gemaakt.";
    case "NOT_MEMBER":
      return action === "remove"
        ? "Deze uitnodiging bestaat niet meer, of je bent geen lid meer van de groep."
        : "Je bent geen lid meer van deze groep, of de groep bestaat niet meer.";
    default:
      return GENERIC;
  }
}

/** "geldig tot 27 november 2026", de dag in Nederlandse tijd. */
export function validUntilText(expiresAt: number): string {
  const d = new Date(expiresAt + dutchOffset(expiresAt));
  return `geldig tot ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function sentText(count: number): string {
  return count === 1 ? "1 uitnodiging verstuurd." : `${count} uitnodigingen verstuurd.`;
}

export const WITHDRAW_CONFIRMATION = (who: string) => ({
  title: "Uitnodiging intrekken?",
  message: `${who} kan de uitnodiging daarna niet meer accepteren. ${who} krijgt hier geen mail over.`,
  button: "Intrekken",
  destructive: true,
});

export const DECLINE_CONFIRMATION = (groupName: string) => ({
  title: "Uitnodiging afwijzen?",
  message: `Je wordt geen lid van ${groupName}. Wie je uitnodigde, krijgt daar een mail over.`,
  button: "Afwijzen",
  destructive: true,
});
