import type { AuthState } from "./authState";

// WP15a invarianten 4, 7 + 10: wat toont de app op dit pad, in deze
// auth-toestand? Alleen "ready" toont een ingelogd scherm. Een pad is
// afgeschermd, tenzij het hier expliciet publiek is. Een nieuwe publieke route
// (WP19, WP22) komt in PUBLIC_PATHS, zonder iets aan de rest te veranderen.

export type RouteAccess = "show" | "wait" | "login" | "home" | "convexAuthFailed" | "noUserRow";

// Alleen voor wie uitgelogd is. Exacte match, geen voorvoegsel.
const PUBLIC_PATHS = new Set(["/inloggen"]);

// `pathname` zoals Expo Router hem geeft: zonder scheme en query. Een slash
// aan het eind telt niet mee.
function normalize(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function routeAccess(pathname: string, authState: AuthState): RouteAccess {
  // Buiten ready en uitgelogd hangt de uitkomst niet van het pad af.
  if (authState === "loading") return "wait";
  if (authState === "convexAuthFailed") return "convexAuthFailed";
  if (authState === "noUserRow") return "noUserRow";

  const isPublic = PUBLIC_PATHS.has(normalize(pathname));
  if (authState === "signedOut") return isPublic ? "show" : "login";
  return isPublic ? "home" : "show";
}
