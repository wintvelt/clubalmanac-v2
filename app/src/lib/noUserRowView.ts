// WP29 fix-cyclus 1, punt 7: wat de poort toont als er een sessie is maar
// users.current `null` is. Na Account verwijderen is dat zo:
// - het verwijderen of uitloggen loopt nog: alleen "Laden…";
// - verwijderd, maar het uitloggen lukte niet: "Je account is verwijderd",
//   met Uitloggen (niet "Je account is nog niet klaar");
// - WP19b A-invariant 3: geen rij en geen uitnodiging (users.signupState
//   "noInvite"): "Je hebt eerst een uitnodiging nodig", met Uitloggen;
// - anders: "Je account is nog niet klaar" (ook "waiting": de onboarding via
//   de webhook komt nog).
// De vlaggen komen uit app/src/data/accountDeletion.ts. Verwijderen gaat voor.

export type SignupState = "account" | "waiting" | "noInvite";

export type NoUserRowView = "loading" | "accountDeleted" | "noInvite" | "notReady";

export function noUserRowView(input: {
  deleting: boolean;
  deleted: boolean;
  signupState?: SignupState | null;
}): NoUserRowView {
  if (input.deleting) return "loading";
  if (input.deleted) return "accountDeleted";
  if (input.signupState === "noInvite") return "noInvite";
  return "notReady";
}
