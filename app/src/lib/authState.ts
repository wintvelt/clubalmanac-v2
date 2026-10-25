// WP13 invarianten 4, 10 + 13: welke van de vijf toestanden toont de app?
// Volgorde is de kern: Clerk uitgelogd wint altijd (geen data van een vorige
// user), en zonder bevestiging van Convex is er nooit "ready" of "noUserRow".

export type AuthState =
  | "loading"
  | "signedOut"
  | "convexAuthFailed"
  | "noUserRow"
  | "ready";

export type AuthStateInput = {
  clerkLoaded: boolean;
  clerkSignedIn: boolean;
  convexAuthLoading: boolean;
  convexAuthenticated: boolean;
  // useQuery-conventie: undefined = laadt, null = geen rij.
  currentUser: undefined | null | object;
};

export function deriveAuthState(input: AuthStateInput): AuthState {
  if (!input.clerkLoaded) return "loading";
  if (!input.clerkSignedIn) return "signedOut";
  if (input.convexAuthLoading) return "loading";
  // Convex is klaar en zegt nee: het token is de oorzaak, ook als er nog een
  // null-resultaat van users.current in de cache staat.
  if (!input.convexAuthenticated) return "convexAuthFailed";
  if (input.currentUser === undefined) return "loading";
  if (input.currentUser === null) return "noUserRow";
  return "ready";
}
