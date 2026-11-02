import { cameUp, type Conditions, type SessionState } from "./sessionState";

// WP15a F12: een koude start blijft nooit eindeloos op "laden". Zonder netwerk
// faalt Clerk's load() (of hangt hij), en Clerk probeert het dan niet zelf
// opnieuw. Na een vaste time-out volgt:
// - Clerk geladen en ingelogd: "reconnecting" (kop, tabbalk, de melding van
//   F6–F8), want de sessie is bekend en alleen Convex bevestigt niet;
// - anders: "startupFailed", een statusscherm met "Opnieuw". Zonder Clerk weet
//   de app niet of er een sessie is, dus geen navigator.

export type GateState = SessionState | "startupFailed";

export type ClerkStatus = "loading" | "ready" | "degraded" | "error";

export const STARTUP_TIMEOUT_MS = 15_000;

export function deriveStartupState(input: {
  session: SessionState;
  clerkStatus: ClerkStatus;
  clerkSignedIn: boolean;
  // Hoe lang de sessie al op "laden" staat.
  loadingForMs: number;
}): GateState {
  if (input.session !== "loading") return input.session;
  if (input.clerkStatus === "error") return "startupFailed";
  if (input.loadingForMs < STARTUP_TIMEOUT_MS) return "loading";
  if (input.clerkStatus === "loading") return "startupFailed";
  return input.clerkSignedIn ? "reconnecting" : "startupFailed";
}

// Na "startupFailed" start de app Clerk opnieuw zodra hij actief en online
// wordt, vanuit een moment waarop dat niet zo was. Dezelfde regel als
// authRetryDue: bleef hij actief en online, dan tikt de user op "Opnieuw".
export function startupRetryDue(input: {
  state: GateState;
  before: Conditions;
  now: Conditions;
}): boolean {
  return input.state === "startupFailed" && cameUp(input.before, input.now);
}
