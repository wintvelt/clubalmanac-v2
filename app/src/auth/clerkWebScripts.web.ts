// WP35 red-team L2: op het web laadt Clerk clerk-js en @clerk/ui van zijn
// Frontend API. Zonder vaste versie vraagt @clerk/react `@6` en `@1`, en krijgt
// de browser elke nieuwe versie die Clerk publiceert, ongetest. Hier staan de
// versies die we getest hebben (geladen op 2026-11-20 met @clerk/expo 4.16.1).
// Bij een update van @clerk/expo: in de browser kijken welke versies hij
// zonder deze regels laadt (Netwerk, `npm/@clerk/`), testen, en hier ophogen
// (docs/runbooks/webapp.md).
//
// De props zijn intern (`__internal_…`) in @clerk/react; @clerk/expo geeft ze
// via zijn overige props door aan de ClerkProvider van @clerk/react, die ze
// gebruikt voor de script-URL (shared/loadClerkJsScript).
export const CLERK_WEB_SCRIPTS: Record<string, string> = {
  __internal_clerkJSVersion: "6.46.2",
  __internal_clerkUIVersion: "1.44.2",
};
