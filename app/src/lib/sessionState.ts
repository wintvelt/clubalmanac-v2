import { deriveAuthState, type AuthState, type AuthStateInput } from "./authState";

// WP15a F1: de vijf toestanden van WP13, plus "reconnecting". Eén mislukte
// tokenophaal (offline, terug uit de achtergrond, of één fout van Clerk) is
// geen weigering. Dan blijft de navigator staan en probeert de app het
// opnieuw. Alleen een weigering terwijl er wel netwerk is, is
// "convexAuthFailed" (het WP13-foutscherm).

export type SessionState = AuthState | "reconnecting";

export type SessionStateInput = AuthStateInput & {
  // De laatste poging om een Clerk-token voor Convex te halen gaf een fout of
  // geen token.
  tokenFetchFailed: boolean;
  // Netwerk: null = onbekend, en dat telt als niet online.
  online: boolean | null;
};

export function deriveSessionState(input: SessionStateInput): SessionState {
  const state = deriveAuthState(input);
  if (state !== "convexAuthFailed") return state;
  return input.tokenFetchFailed || input.online !== true ? "reconnecting" : "convexAuthFailed";
}

export type Conditions = { appState: string; online: boolean | null };

// Opnieuw proberen in "reconnecting": zodra de app actief en online wordt,
// vanuit een moment waarop dat niet zo was. Bleef hij actief en online, dan
// tikt de user op "Opnieuw". Zo ontstaat geen lus.
export function authRetryDue(input: {
  state: SessionState;
  before: Conditions;
  now: Conditions;
}): boolean {
  if (input.state !== "reconnecting") return false;
  return cameUp(input.before, input.now);
}

// Werd de app actief en online, vanuit een moment waarop dat niet zo was?
export function cameUp(before: Conditions, now: Conditions): boolean {
  return isUp(now) && !isUp(before);
}

function isUp(c: Conditions): boolean {
  return c.appState === "active" && c.online === true;
}
