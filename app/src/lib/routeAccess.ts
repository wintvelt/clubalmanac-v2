import type { GateState } from "./startupState";

// WP15a invarianten 4, 7 + 10: wat toont de app op dit pad, in deze
// auth-toestand? Alleen "ready" toont een ingelogd scherm, en "reconnecting"
// de navigator zonder live data (F1). Een pad is
// afgeschermd, tenzij het hier expliciet publiek is. Een nieuwe publieke route
// (WP19, WP22) komt in PUBLIC_PATHS, zonder iets aan de rest te veranderen.

export type RouteAccess =
  | "show"
  | "wait"
  | "login"
  | "home"
  | "convexAuthFailed"
  | "noUserRow"
  | "startupFailed";

// Alleen voor wie uitgelogd is. Exacte match, geen voorvoegsel. Elk
// routebestand buiten een Protected moet hier staan (tests/routeFiles.test.ts).
// WP15b: de Info-paden voor wie uitgelogd is. Ingelogd staat Info onder
// /instellingen, en een /info-pad gaat naar Home, zoals /inloggen.
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/inloggen",
  "/info",
  "/info/over",
  "/info/privacy",
  "/info/voorwaarden",
]);

// `pathname` zoals Expo Router hem geeft: zonder scheme en query. Een slash
// aan het eind telt niet mee.
function normalize(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function routeAccess(pathname: string, authState: GateState): RouteAccess {
  // Buiten ready, reconnecting en uitgelogd hangt de uitkomst niet van het pad af.
  if (authState === "startupFailed") return "startupFailed";
  if (authState === "loading") return "wait";
  if (authState === "convexAuthFailed") return "convexAuthFailed";
  if (authState === "noUserRow") return "noUserRow";

  const isPublic = PUBLIC_PATHS.has(normalize(pathname));
  if (authState === "signedOut") return isPublic ? "show" : "login";
  // ready of reconnecting: Clerk is ingelogd.
  return isPublic ? "home" : "show";
}
