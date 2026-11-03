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

// WP15a F22: wat er gebeurde sinds de app voor het laatst actief en online
// was. De poort vergelijkt daarmee, niet met de vorige render: anders mist hij
// een netwerk dat terugkwam terwijl de app "inactive" was (vliegtuigmodus uit
// via het Bedieningspaneel).
// - Actief en online: een nieuwe periode begint.
// - Was het netwerk weg, dan blijft het weg tot de app weer actief en online
//   is. Na een bekende meting telt "onbekend" als weg; de allereerste meting
//   neemt het geheugen over.
// - Was de app op de achtergrond, dan blijft dat staan; anders volgt appState
//   de laatste meting.
export function rememberSinceUp(memo: Conditions, now: Conditions): Conditions {
  if (isUp(now)) return now;
  const online = memo.online === null ? now.online : memo.online && now.online === true;
  const appState =
    memo.appState === "background" || now.appState === "background" ? "background" : now.appState;
  return { appState, online };
}

// Werd de app actief en online, vanuit een moment waarop dat niet zo was?
export function cameUp(before: Conditions, now: Conditions): boolean {
  return isUp(now) && !isUp(before);
}

function isUp(c: Conditions): boolean {
  return c.appState === "active" && c.online === true;
}
