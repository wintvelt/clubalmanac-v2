import { describe, expect, it } from "vitest";
import { noUserRowView } from "../src/lib/noUserRowView";

// WP29 fix-cyclus 1, punt 7. De poort heeft een sessie, maar users.current is
// `null`. Na Account verwijderen is dat zo; lukt het uitloggen daarna niet
// (signOutAndWipe geeft `false`), dan hoort het lid niet "Je account is nog
// niet klaar" te zien, maar dat zijn account is verwijderd, met Uitloggen.
// Spec: docs/work-packages/WP29-account-verwijderen.md §Fix-cyclus 1.

describe("noUserRowView", () => {
  it("tijdens het verwijderen en uitloggen: laden", () => {
    expect(noUserRowView({ deleting: true, deleted: false })).toBe("loading");
    expect(noUserRowView({ deleting: true, deleted: true })).toBe("loading");
  });

  it("verwijderd, maar het uitloggen lukte niet: het scherm 'account verwijderd'", () => {
    expect(noUserRowView({ deleting: false, deleted: true })).toBe("accountDeleted");
  });

  it("anders: 'Je account is nog niet klaar'", () => {
    expect(noUserRowView({ deleting: false, deleted: false })).toBe("notReady");
  });
});

// WP19b A-invariant 3: zonder rij en zonder uitnodiging zegt de app dat je
// eerst een uitnodiging nodig hebt (met uitloggen), niet "nog niet klaar".
// `signupState` komt uit users.signupState. Verwijderen gaat voor.
describe("noUserRowView — WP19b, geen uitnodiging", () => {
  it("signupState noInvite: het scherm 'eerst een uitnodiging'", () => {
    expect(noUserRowView({ deleting: false, deleted: false, signupState: "noInvite" })).toBe("noInvite");
  });

  it("waiting, account of nog onbekend: 'nog niet klaar'", () => {
    for (const signupState of ["waiting", "account", null, undefined] as const) {
      expect(noUserRowView({ deleting: false, deleted: false, signupState })).toBe("notReady");
    }
  });

  it("verwijderen gaat voor: laden of 'account verwijderd', ook bij noInvite", () => {
    expect(noUserRowView({ deleting: true, deleted: false, signupState: "noInvite" })).toBe("loading");
    expect(noUserRowView({ deleting: false, deleted: true, signupState: "noInvite" })).toBe("accountDeleted");
  });
});

// WP19b fix-cyclus 1 (besluit 3). Geen spinner die nooit ophoudt.
//
// S1, S2 (gewiste subject) — A-invariant 17 en 18: users.signupState zegt
// "blocked" als de onboarding niet vanzelf komt en een uitnodiging niet helpt
// (het adres hoort al bij een andere rij, of de Clerk-user is gewist). De poort
// toont dan "nog niet klaar, meld het bij de beheerder", zonder spinner: het
// scherm "blocked". Niet "eerst een uitnodiging".
//
// S2 — A-invariant 20: de webhook komt maar één keer per sessie. Heeft deze
// sessie al "noInvite" gezien (`sawNoInvite`), dan komt er na een nieuwe
// uitnodiging ("waiting") geen rij meer: de poort zegt "Log uit en opnieuw
// in" (het scherm "signOutAndIn"), geen spinner. A-keuze 4: hetzelfde als
// "waiting" te lang duurt (`waitingTimedOut`), want na een herstart van de app
// is het geheugen van de sessie weg en komt de webhook ook niet meer.
describe("noUserRowView — WP19b fix-cyclus 1", () => {
  const base = { deleting: false, deleted: false };

  it("blocked: het scherm 'nog niet klaar, meld het bij de beheerder' zonder spinner", () => {
    expect(noUserRowView({ ...base, signupState: "blocked" })).toBe("blocked");
  });

  it("blocked blijft blocked, ook na noInvite of na lang wachten", () => {
    expect(noUserRowView({ ...base, signupState: "blocked", sawNoInvite: true })).toBe("blocked");
    expect(noUserRowView({ ...base, signupState: "blocked", waitingTimedOut: true })).toBe("blocked");
  });

  it("waiting na noInvite in deze sessie: 'Log uit en opnieuw in'", () => {
    expect(noUserRowView({ ...base, signupState: "waiting", sawNoInvite: true })).toBe("signOutAndIn");
  });

  it("waiting die te lang duurt: 'Log uit en opnieuw in'", () => {
    expect(noUserRowView({ ...base, signupState: "waiting", waitingTimedOut: true })).toBe("signOutAndIn");
  });

  it("de eerste keer waiting, nog niet lang: de korte wachttijd van de onboarding ('nog niet klaar')", () => {
    expect(noUserRowView({ ...base, signupState: "waiting" })).toBe("notReady");
    expect(noUserRowView({ ...base, signupState: "waiting", sawNoInvite: false, waitingTimedOut: false })).toBe(
      "notReady",
    );
  });

  it("noInvite blijft noInvite, ook als hij al eerder gezien is of lang duurt", () => {
    expect(noUserRowView({ ...base, signupState: "noInvite", sawNoInvite: true })).toBe("noInvite");
    expect(noUserRowView({ ...base, signupState: "noInvite", waitingTimedOut: true })).toBe("noInvite");
  });

  it("verwijderen gaat voor, ook bij blocked en bij waiting na noInvite", () => {
    for (const extra of [
      { signupState: "blocked" as const },
      { signupState: "waiting" as const, sawNoInvite: true, waitingTimedOut: true },
    ]) {
      expect(noUserRowView({ deleting: true, deleted: false, ...extra })).toBe("loading");
      expect(noUserRowView({ deleting: false, deleted: true, ...extra })).toBe("accountDeleted");
    }
  });
});
