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
