import { describe, expect, it } from "vitest";
import { loginErrorMessage } from "../src/lib/loginErrors";

// WP13 invariant 17 + acceptance-gate 4: leesbare foutmelding bij code-login.
// - Elke oorzaak een eigen melding: onbekend adres, verkeerde code, verlopen
//   code, te veel pogingen op de code, geblokkeerd account, rate-limit.
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
  UNKNOWN_ACCOUNT,
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

  it("onbekend adres wordt gemeld, anders dan een verkeerde code", () => {
    expect(loginErrorMessage(UNKNOWN_ACCOUNT)).not.toBe(
      loginErrorMessage(WRONG_CODE),
    );
  });

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
