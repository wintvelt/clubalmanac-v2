import type { SessionState } from "./sessionState";

// WP15a invarianten 5, 12, 13 + 14: loopt een live query, ja of nee? Alles
// wat niet expliciet "ja" is, is "nee". Alleen de AppState-waarde "active"
// telt als actief; `inactive` (Bedieningspaneel, app-wisselaar) en elke
// onbekende of nieuwe waarde pauzeren.

const ACTIVE = "active";

// De queries die buiten focus om mogen lopen (F2), zoals getFunctionName ze
// noemt: users.current, en (WP19b A-invariant 3) users.signupState, waarmee
// de poort zonder users-rij weet of er een uitnodiging is. De poort zet de
// tweede alleen live zolang users.current `null` is.
const SESSION_QUERIES: ReadonlySet<string> = new Set(["users:current", "users:signupState"]);

// Het scherm in beeld: focus (geen andere tab, geen scherm erbovenop, geen
// modaal erover), app actief, sessie ready. In "reconnecting" heeft Convex
// geen identiteit, dus loopt er niets (F1).
export function screenQueryIsLive(input: {
  focused: boolean;
  appState: string;
  authState: SessionState;
}): boolean {
  return input.focused && input.appState === ACTIVE && input.authState === "ready";
}

// De query achter de auth-poort (users.current). Staat boven de navigatie,
// dus zonder focus; wel met dezelfde voorwaarden als WP13 voor Clerk en Convex.
// Elke andere query via deze route is nooit live (F2).
export function sessionQueryIsLive(input: {
  query: string;
  appState: string;
  clerkLoaded: boolean;
  clerkSignedIn: boolean;
  convexAuthLoading: boolean;
  convexAuthenticated: boolean;
}): boolean {
  return (
    SESSION_QUERIES.has(input.query) &&
    input.appState === ACTIVE &&
    input.clerkLoaded &&
    input.clerkSignedIn &&
    !input.convexAuthLoading &&
    input.convexAuthenticated
  );
}
