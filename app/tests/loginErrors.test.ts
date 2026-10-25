import { describe, expect, it } from "vitest";
import { loginErrorMessage } from "../src/lib/loginErrors";

// WP13 invariant 17 + acceptance-gate 4: leesbare foutmelding bij inloggen.
// - Verkeerd wachtwoord en onbekend account: dezelfde melding (geen
//   account-enumeratie; pariteit met de oude Cognito-app).
// - Geblokkeerd / te veel pogingen: een eigen melding.
// - Onbekende fout: algemene melding, nooit de ruwe Clerk-tekst.
// - De functie gooit zelf nooit.

// Vorm van een Clerk API-fout (ClerkAPIResponseError): errors[] met code,
// message en longMessage. B checkt de codes tegen de vastgezette Clerk-versie.
function clerkError(code: string, message = `Clerk says ${code}`) {
  return {
    clerkError: true,
    errors: [{ code, message, longMessage: `${message} (long)` }],
  };
}

const WRONG_PASSWORD = clerkError(
  "form_password_incorrect",
  "Password is incorrect. Try again, or use another method.",
);
const UNKNOWN_ACCOUNT = clerkError(
  "form_identifier_not_found",
  "Couldn't find your account.",
);
const LOCKED = clerkError(
  "user_locked",
  "Your account is locked. You will be able to try again in 15 minutes.",
);
const RATE_LIMITED = clerkError("too_many_requests", "Too many requests.");

describe("loginErrorMessage", () => {
  it("geeft een niet-lege melding bij een verkeerd wachtwoord", () => {
    expect(loginErrorMessage(WRONG_PASSWORD).trim()).not.toBe("");
  });

  it("verraadt niet of het account bestaat", () => {
    expect(loginErrorMessage(UNKNOWN_ACCOUNT)).toBe(
      loginErrorMessage(WRONG_PASSWORD),
    );
  });

  it("geblokkeerd account krijgt een eigen melding", () => {
    const locked = loginErrorMessage(LOCKED);
    expect(locked.trim()).not.toBe("");
    expect(locked).not.toBe(loginErrorMessage(WRONG_PASSWORD));
  });

  it("te veel pogingen krijgt een andere melding dan verkeerde gegevens", () => {
    const limited = loginErrorMessage(RATE_LIMITED);
    expect(limited.trim()).not.toBe("");
    expect(limited).not.toBe(loginErrorMessage(WRONG_PASSWORD));
  });

  it("onbekende Clerk-code: algemene melding, niet de ruwe tekst", () => {
    const raw = "Some brand new Clerk failure";
    const msg = loginErrorMessage(clerkError("brand_new_code", raw));
    expect(msg.trim()).not.toBe("");
    expect(msg).not.toContain(raw);
    expect(msg).not.toBe(loginErrorMessage(WRONG_PASSWORD));
  });

  it("toont nooit de Engelse Clerk-tekst van bekende codes", () => {
    for (const err of [WRONG_PASSWORD, UNKNOWN_ACCOUNT, LOCKED, RATE_LIMITED]) {
      const msg = loginErrorMessage(err);
      expect(msg).not.toContain(err.errors[0]!.message);
      expect(msg).not.toContain(err.errors[0]!.longMessage);
    }
  });

  it("netwerkfout (geen Clerk-fout) geeft een melding, niet de ruwe tekst", () => {
    const msg = loginErrorMessage(new TypeError("Network request failed"));
    expect(msg.trim()).not.toBe("");
    expect(msg).not.toContain("Network request failed");
  });

  it("gooit nooit, ook niet bij rare input", () => {
    const weird: unknown[] = [
      undefined,
      null,
      "string error",
      42,
      {},
      { errors: [] },
      { errors: "geen array" },
      { errors: [null] },
      { errors: [{}] },
    ];
    for (const input of weird) {
      let msg = "";
      expect(() => {
        msg = loginErrorMessage(input);
      }).not.toThrow();
      expect(typeof msg).toBe("string");
      expect(msg.trim()).not.toBe("");
    }
  });

  it("gebruikt de eerste fout als Clerk er meerdere geeft", () => {
    const multi = {
      errors: [
        { code: "form_password_incorrect", message: "x", longMessage: "x" },
        { code: "user_locked", message: "y", longMessage: "y" },
      ],
    };
    expect(loginErrorMessage(multi)).toBe(loginErrorMessage(WRONG_PASSWORD));
  });
});
