import type { Conditions, SessionState } from "./sessionState";

// WP15a F12: een koude start blijft nooit eindeloos op "laden". Zonder netwerk
// faalt Clerk's load() (of hangt hij), en Clerk probeert het dan niet zelf
// opnieuw. Na een vaste time-out volgt:
// - Clerk geladen en ingelogd: "reconnecting" (kop, tabbalk, de melding van
//   F6–F8), want de sessie is bekend en alleen Convex bevestigt niet;
// - anders: "startupFailed", een statusscherm met "Opnieuw". Zonder Clerk weet
//   de app niet of er een sessie is, dus geen navigator.
// De poort meet de time-out met één timer en geeft een vlag (F16): zo hangt
// de beslissing niet van de klok af.

export type GateState = SessionState | "startupFailed";

export type ClerkStatus = "loading" | "ready" | "degraded" | "error";

export const STARTUP_TIMEOUT_MS = 15_000;

export function deriveStartupState(input: {
  session: SessionState;
  clerkStatus: ClerkStatus;
  clerkSignedIn: boolean;
  // De sessie staat langer dan STARTUP_TIMEOUT_MS op "laden".
  loadingTimedOut: boolean;
}): GateState {
  if (input.session !== "loading") return input.session;
  if (input.clerkStatus === "error") return "startupFailed";
  if (!input.loadingTimedOut) return "loading";
  if (input.clerkStatus === "loading") return "startupFailed";
  return input.clerkSignedIn ? "reconnecting" : "startupFailed";
}

// Na "startupFailed" start de app Clerk opnieuw zodra het netwerk terugkomt,
// of zodra de app terugkomt uit de achtergrond, en hij nu actief en online
// is. Van "inactive" (Bedieningspaneel, melding, app-wisselaar) naar actief
// telt niet (F18): dan zou elke blik op het Bedieningspaneel de app herladen.
// Bleef hij actief en online, dan tikt de user op "Opnieuw".
export function startupRetryDue(input: {
  state: GateState;
  before: Conditions;
  now: Conditions;
}): boolean {
  const { before, now } = input;
  return (
    input.state === "startupFailed" &&
    now.appState === "active" &&
    now.online === true &&
    (before.online !== true || before.appState === "background")
  );
}

// F14: startte Clerk uit de cache en is de user uitgelogd, dan start de app
// Clerk opnieuw zodra het netwerk terugkomt terwijl de app actief is. Alleen
// terugkomen uit de achtergrond telt niet: de user haalt de code uit de
// Mail-app, en een herstart zou de codestap wissen. Loopt er een login (de
// codestap), dan nooit (F17): degraded blijft de hele run staan, en een
// wissel van wifi naar mobiel zou de codestap ook wissen.
// F23: een login loopt vanaf de tik op "Stuur code", ook terwijl dat verzoek
// nog loopt (signIn.status is dan nog needs_identifier), en zolang Clerk op de
// code wacht.
export function loginInProgress(input: {
  signInStatus: string | null;
  requestRunning: boolean;
}): boolean {
  return input.requestRunning || input.signInStatus === "needs_first_factor";
}

export function clerkRestartDue(input: {
  clerkStatus: ClerkStatus;
  clerkSignedIn: boolean;
  loginInProgress: boolean;
  before: Conditions;
  now: Conditions;
}): boolean {
  return (
    !input.loginInProgress &&
    input.clerkStatus === "degraded" &&
    !input.clerkSignedIn &&
    input.now.appState === "active" &&
    input.now.online === true &&
    input.before.online !== true
  );
}
