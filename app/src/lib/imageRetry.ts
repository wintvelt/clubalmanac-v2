// WP17a invariant 18 (fix-cyclus 3, N-S1): het laden van één foto-beeld met
// het Clerk-token. Pure toestand; src/data/images.tsx haalt de tokens en
// src/components/Photo.tsx meldt de fouten.
//
// Een poging is één token plus één beeld met dat token. Na een fout volgt
// precies één nieuwe poging, met een vers token (skipCache): een verlopen
// token geeft 401, en het token dat al in de toestand stond is dat verlopen
// token. Tot het verse token er is, gaat er geen verzoek uit. Lukt ook die
// poging niet, of komt er geen token, dan valt het beeld terug. Elke melding
// draagt het nummer van zijn poging; een melding van een oudere poging (een
// laat token, een late fout van een vervangen beeld) verandert niets.

export type ImageLoad =
  | { phase: "wait"; attempt: number; retried: boolean; skipCache: boolean }
  | { phase: "load"; attempt: number; retried: boolean; token: string }
  | { phase: "failed"; attempt: number };

export const initialImageLoad: ImageLoad = { phase: "wait", attempt: 0, retried: false, skipCache: false };

// Welk token nu op te halen, of null als er geen nodig is.
export function tokenRequest(s: ImageLoad): { attempt: number; skipCache: boolean } | null {
  return s.phase === "wait" ? { attempt: s.attempt, skipCache: s.skipCache } : null;
}

// Het token voor `attempt` is er; null: geen token (uitgelogd, of ophalen mislukt).
export function tokenArrived(s: ImageLoad, attempt: number, token: string | null): ImageLoad {
  if (s.phase !== "wait" || s.attempt !== attempt) return s;
  if (token === null) return { phase: "failed", attempt: s.attempt };
  return { phase: "load", attempt: s.attempt, retried: s.retried, token };
}

// Het beeld van `attempt` laadde niet.
export function imageFailed(s: ImageLoad, attempt: number): ImageLoad {
  if (s.phase !== "load" || s.attempt !== attempt) return s;
  if (s.retried) return { phase: "failed", attempt: s.attempt };
  return { phase: "wait", attempt: s.attempt + 1, retried: true, skipCache: true };
}

// "Opnieuw" op de fout-tegel: een nieuwe reeks, ook met een vers token.
export function retryByUser(s: ImageLoad): ImageLoad {
  return { phase: "wait", attempt: s.attempt + 1, retried: false, skipCache: true };
}

export type ImageLoadView =
  | { kind: "wait" }
  | { kind: "load"; token: string; attempt: number }
  | { kind: "failed" };

export function imageLoadView(s: ImageLoad): ImageLoadView {
  if (s.phase === "load") return { kind: "load", token: s.token, attempt: s.attempt };
  return { kind: s.phase };
}
