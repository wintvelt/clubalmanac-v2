import { describe, expect, it } from "vitest";
import { isSignUpTransfer, loginErrorMessage } from "../src/lib/loginErrors";

// WP19b A-antwoord vraag 6: aanmelden met code via Clerks sign-in-or-up
// (`signIn.create({ identifier, signUpIfMissing: true })`). Na de juiste code
// meldt Clerk voor een onbekend adres de fout `sign_up_if_missing_transfer`;
// de app maakt dan het account (`signUp.create({ transfer: true })`). Die fout
// is dus geen melding voor de gebruiker maar een stap. Herkend in beide
// vormen die Clerk gebruikt: `errors[0].code` (API-fout) en `code` (ClerkError
// uit de signal-API). Gooit zelf nooit.

const transferApi = { errors: [{ code: "sign_up_if_missing_transfer", message: "x" }] };
const transferSignal = { code: "sign_up_if_missing_transfer", message: "x" };

describe("isSignUpTransfer", () => {
  it("herkent de transfer-fout in beide vormen", () => {
    expect(isSignUpTransfer(transferApi)).toBe(true);
    expect(isSignUpTransfer(transferSignal)).toBe(true);
  });

  it("andere fouten en geen fout: false", () => {
    expect(isSignUpTransfer({ errors: [{ code: "form_code_incorrect" }] })).toBe(false);
    expect(isSignUpTransfer({ code: "form_identifier_not_found" })).toBe(false);
    for (const v of [undefined, null, "sign_up_if_missing_transfer", 42, {}, { errors: [] }]) {
      expect(isSignUpTransfer(v)).toBe(false);
    }
  });

  it("de foutmelding toont nooit de ruwe code", () => {
    expect(loginErrorMessage(transferApi)).not.toContain("sign_up_if_missing_transfer");
  });
});
