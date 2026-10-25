// WP13 invariant 17: leesbare NL-meldingen bij code-login, zonder te verraden
// of een e-mailadres bij een account hoort. Nooit de ruwe Clerk-tekst tonen.
//
// Clerk-fouten (ClerkAPIResponseError) hebben `errors: [{ code, message,
// longMessage }]`. De codes komen van de Clerk Frontend API; gecheckt tegen
// @clerk/expo 4.14.1.

export const LOGIN_MESSAGES = {
  wrongCode: "Deze code klopt niet. Controleer de code in de mail en probeer het opnieuw.",
  expiredCode: "Deze code is verlopen. Vraag een nieuwe code aan.",
  tooManyAttempts: "Te veel verkeerde pogingen met deze code. Vraag een nieuwe code aan.",
  locked: "Je account is tijdelijk geblokkeerd. Probeer het over een kwartier opnieuw.",
  rateLimited: "Te veel pogingen achter elkaar. Wacht even en probeer het dan opnieuw.",
  invalidEmail: "Dit is geen geldig e-mailadres. Controleer het en probeer het opnieuw.",
  generic: "Er ging iets mis. Controleer je internetverbinding en probeer het opnieuw.",
} as const;

// form_identifier_not_found staat hier bewust niet in: een onbekend account
// krijgt geen eigen melding (zie emailStepResult).
const MESSAGE_BY_CODE: Record<string, string> = {
  form_code_incorrect: LOGIN_MESSAGES.wrongCode,
  verification_expired: LOGIN_MESSAGES.expiredCode,
  verification_failed: LOGIN_MESSAGES.tooManyAttempts,
  user_locked: LOGIN_MESSAGES.locked,
  too_many_requests: LOGIN_MESSAGES.rateLimited,
  form_param_format_invalid: LOGIN_MESSAGES.invalidEmail,
};

const UNKNOWN_ACCOUNT_CODE = "form_identifier_not_found";

// Code van de eerste Clerk-fout, of undefined als het geen Clerk-fout is.
function firstClerkErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const errors: unknown = (error as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return undefined;
  const first: unknown = errors[0];
  if (typeof first !== "object" || first === null) return undefined;
  const code: unknown = (first as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function loginErrorMessage(error: unknown): string {
  const code = firstClerkErrorCode(error);
  return (code !== undefined && MESSAGE_BY_CODE[code]) || LOGIN_MESSAGES.generic;
}

export type EmailStepResult =
  | { kind: "codeScreen" }
  | { kind: "error"; message: string };

// Na de e-mailstap: geen fout en een onbekend account zien er hetzelfde uit.
export function emailStepResult(error: unknown): EmailStepResult {
  if (error === undefined || isUnknownAccountError(error)) {
    return { kind: "codeScreen" };
  }
  return { kind: "error", message: loginErrorMessage(error) };
}

export function isUnknownAccountError(error: unknown): boolean {
  return firstClerkErrorCode(error) === UNKNOWN_ACCOUNT_CODE;
}
