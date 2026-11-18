import { describe, expect, it } from "vitest";
import { emailStepResult, LOGIN_MESSAGES, loginErrorMessage } from "../src/lib/loginErrors";

// WP13 invariant 17 + acceptance-gate 4: leesbare foutmelding bij code-login.
// - Geen account-enumeratie: na de e-mailstap is een onbekend adres niet te
//   onderscheiden van een bekend adres (emailStepResult → codeScreen).
// - Elke andere oorzaak een eigen melding: verkeerde code, verlopen code, te
//   veel pogingen op de code, geblokkeerd account, rate-limit.
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

const UNKNOWN_ACCOUNT = clerkError(
  "form_identifier_not_found",
  "Couldn't find your account.",
);
const WRONG_CODE = clerkError("form_code_incorrect", "Incorrect code");
const EXPIRED_CODE = clerkError(
  "verification_expired",
  "This verification has expired. You must create a new one.",
);
const TOO_MANY_ATTEMPTS = clerkError(
  "verification_failed",
  "Too many failed attempts. You have to try again with the same or another method.",
);
const LOCKED = clerkError(
  "user_locked",
  "Your account is locked. You will be able to try again in 15 minutes.",
);
const RATE_LIMITED = clerkError("too_many_requests", "Too many requests.");

const KNOWN = {
  WRONG_CODE,
  EXPIRED_CODE,
  TOO_MANY_ATTEMPTS,
  LOCKED,
  RATE_LIMITED,
};

const GENERIC = clerkError("brand_new_code", "Some brand new Clerk failure");

describe("loginErrorMessage — een melding per oorzaak", () => {
  for (const [name, err] of Object.entries(KNOWN)) {
    it(`${name}: niet-lege melding, niet de Clerk-tekst`, () => {
      const msg = loginErrorMessage(err);
      expect(msg.trim()).not.toBe("");
      expect(msg).not.toContain(err.errors[0]!.message);
      expect(msg).not.toContain(err.errors[0]!.longMessage);
    });
  }

  it("verlopen code: andere melding dan verkeerde code", () => {
    expect(loginErrorMessage(EXPIRED_CODE)).not.toBe(
      loginErrorMessage(WRONG_CODE),
    );
  });

  it("te veel pogingen op de code: andere melding dan verkeerde code", () => {
    expect(loginErrorMessage(TOO_MANY_ATTEMPTS)).not.toBe(
      loginErrorMessage(WRONG_CODE),
    );
  });

  it("geblokkeerd account: andere melding dan verkeerde code", () => {
    expect(loginErrorMessage(LOCKED)).not.toBe(loginErrorMessage(WRONG_CODE));
  });

  it("rate-limit: andere melding dan verkeerde code", () => {
    expect(loginErrorMessage(RATE_LIMITED)).not.toBe(
      loginErrorMessage(WRONG_CODE),
    );
  });

  it("geen bekende oorzaak valt terug op de algemene melding", () => {
    const generic = loginErrorMessage(GENERIC);
    for (const err of Object.values(KNOWN)) {
      expect(loginErrorMessage(err)).not.toBe(generic);
    }
  });
});

describe("loginErrorMessage — onbekende en rare fouten", () => {
  it("onbekende Clerk-code: algemene melding, niet de ruwe tekst", () => {
    const msg = loginErrorMessage(GENERIC);
    expect(msg.trim()).not.toBe("");
    expect(msg).not.toContain("Some brand new Clerk failure");
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
        { code: "form_code_incorrect", message: "x", longMessage: "x" },
        { code: "user_locked", message: "y", longMessage: "y" },
      ],
    };
    expect(loginErrorMessage(multi)).toBe(loginErrorMessage(WRONG_CODE));
  });
});

describe("emailStepResult — geen account-enumeratie (invariant 17)", () => {
  it("geen fout: door naar het code-scherm", () => {
    expect(emailStepResult(undefined)).toEqual({ kind: "codeScreen" });
  });

  it("onbekend account: precies hetzelfde als geen fout", () => {
    expect(emailStepResult(UNKNOWN_ACCOUNT)).toEqual(
      emailStepResult(undefined),
    );
  });

  it("loginErrorMessage heeft geen eigen melding voor een onbekend account", () => {
    // Komt de fout toch ergens langs, dan alleen de algemene melding.
    expect(loginErrorMessage(UNKNOWN_ACCOUNT)).toBe(loginErrorMessage(GENERIC));
  });

  it("onbekend account: geen melding die het verraadt", () => {
    const result = emailStepResult(UNKNOWN_ACCOUNT);
    expect(result).not.toHaveProperty("message");
  });

  it("andere fouten bij de e-mailstap: melding van loginErrorMessage", () => {
    for (const err of [RATE_LIMITED, LOCKED, GENERIC]) {
      expect(emailStepResult(err)).toEqual({
        kind: "error",
        message: loginErrorMessage(err),
      });
    }
  });

  it("netwerkfout bij de e-mailstap: melding, geen code-scherm", () => {
    const err = new TypeError("Network request failed");
    expect(emailStepResult(err)).toEqual({
      kind: "error",
      message: loginErrorMessage(err),
    });
  });

  it("gooit nooit, ook niet bij rare input", () => {
    for (const input of [null, "x", 42, {}, { errors: [null] }]) {
      expect(() => emailStepResult(input)).not.toThrow();
    }
  });
});

// Fix na WP32: op dev weigerde Clerk "Stuur code" met HTTP 429 en code
// verification_code_rate_limit_exceeded ("Too many verification code
// requests"). De user zag de algemene melding over de internetverbinding.
// Elke rate-limit-code van Clerk geeft de rate-limit-melding:
// - too_many_requests: algemene 429 van Clerk.
// - verification_code_rate_limit_exceeded: te vaak een code aangevraagd
//   (gezien op dev, staat niet in de typings van @clerk/shared 4.45.1).
// - signup_rate_limit_exceeded: te veel aanmeldingen (constante in
//   @clerk/shared 4.45.1); kan langskomen via sign-in-or-up (WP19b).
// too_many_unverified_identifications hoort hier niet bij: dat gaat over te
// veel onbevestigde adressen op één account, niet over wachten.
function clerk429(code: string, message: string) {
  return { ...clerkError(code, message), status: 429 };
}

const RATE_LIMIT_ERRORS = {
  too_many_requests: clerk429("too_many_requests", "Too many requests."),
  verification_code_rate_limit_exceeded: clerk429(
    "verification_code_rate_limit_exceeded",
    "Too many verification code requests",
  ),
  signup_rate_limit_exceeded: clerk429(
    "signup_rate_limit_exceeded",
    "Too many sign-ups. Please try again later.",
  ),
};

describe("rate-limit van Clerk: de rate-limit-melding", () => {
  for (const [code, err] of Object.entries(RATE_LIMIT_ERRORS)) {
    it(`${code}: loginErrorMessage geeft de rate-limit-melding`, () => {
      expect(loginErrorMessage(err)).toBe(LOGIN_MESSAGES.rateLimited);
    });

    it(`${code}: "Stuur code" (emailStepResult) toont de rate-limit-melding`, () => {
      expect(emailStepResult(err)).toEqual({
        kind: "error",
        message: LOGIN_MESSAGES.rateLimited,
      });
    });
  }
});
