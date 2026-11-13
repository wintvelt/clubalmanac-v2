// WP29 fix-cyclus 1, punt 7: wat de poort toont als er een sessie is maar
// users.current `null` is. Na Account verwijderen is dat zo:
// - het verwijderen of uitloggen loopt nog: alleen "Laden…";
// - verwijderd, maar het uitloggen lukte niet: "Je account is verwijderd",
//   met Uitloggen (niet "Je account is nog niet klaar");
// - WP19b A-invariant 3: geen rij en geen uitnodiging (users.signupState
//   "noInvite"): "Je hebt eerst een uitnodiging nodig", met Uitloggen;
// - WP19b fix-cyclus 1, A-invariant 17 en 18: "blocked" (het adres hoort al
//   bij een ander account, of de Clerk-user is gewist): "nog niet klaar, meld
//   het bij de beheerder", zonder spinner;
// - A-invariant 20 en A-keuze 4: "waiting", maar deze sessie zag al
//   "noInvite" of het wachten duurt te lang: de webhook komt niet meer, dus
//   "Log uit en opnieuw in";
// - anders: "Je account is nog niet klaar" met spinner ("waiting": de
//   onboarding via de webhook komt nog).
// De vlaggen komen uit app/src/data/accountDeletion.ts. Verwijderen gaat voor.

/** Hoe lang "waiting" mag duren; de onboarding via de webhook duurt meestal een paar seconden. */
export const SIGNUP_WAITING_TIMEOUT_MS = 30_000;

export type SignupState = "account" | "waiting" | "noInvite" | "blocked";

export type NoUserRowView =
  | "loading"
  | "accountDeleted"
  | "noInvite"
  | "blocked"
  | "signOutAndIn"
  | "notReady";

export function noUserRowView(input: {
  deleting: boolean;
  deleted: boolean;
  signupState?: SignupState | null;
  sawNoInvite?: boolean;
  waitingTimedOut?: boolean;
}): NoUserRowView {
  if (input.deleting) return "loading";
  if (input.deleted) return "accountDeleted";
  if (input.signupState === "noInvite") return "noInvite";
  if (input.signupState === "blocked") return "blocked";
  if (input.signupState === "waiting" && (input.sawNoInvite === true || input.waitingTimedOut === true)) {
    return "signOutAndIn";
  }
  return "notReady";
}
