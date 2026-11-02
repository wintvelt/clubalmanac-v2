import type { AuthState } from "./authState";

// WP15a invarianten 5, 12, 13 + 14: loopt een live query, ja of nee? Alles
// wat niet expliciet "ja" is, is "nee". Alleen de AppState-waarde "active"
// telt als actief; `inactive` (Bedieningspaneel, app-wisselaar) en elke
// onbekende of nieuwe waarde pauzeren.

const ACTIVE = "active";

// Het scherm in beeld: focus (geen andere tab, geen scherm erbovenop, geen
// modaal erover), app actief, sessie ready.
export function screenQueryIsLive(input: {
  focused: boolean;
  appState: string;
  authState: AuthState;
}): boolean {
  return input.focused && input.appState === ACTIVE && input.authState === "ready";
}

// De query achter de auth-poort (users.current). Staat boven de navigatie,
// dus zonder focus; wel met dezelfde voorwaarden als WP13 voor Clerk en Convex.
export function sessionQueryIsLive(input: {
  appState: string;
  clerkLoaded: boolean;
  clerkSignedIn: boolean;
  convexAuthLoading: boolean;
  convexAuthenticated: boolean;
}): boolean {
  return (
    input.appState === ACTIVE &&
    input.clerkLoaded &&
    input.clerkSignedIn &&
    !input.convexAuthLoading &&
    input.convexAuthenticated
  );
}
