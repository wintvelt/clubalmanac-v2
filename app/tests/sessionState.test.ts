import { describe, expect, it } from "vitest";
import { deriveAuthState } from "../src/lib/authState";
import { authRetryDue, deriveSessionState } from "../src/lib/sessionState";

// WP15a F1: één mislukte tokenophaal is geen weigering. Clerk is ingelogd, maar
// Convex heeft (nog) geen token: offline, terug uit de achtergrond, of één fout
// van Clerk. Dan "reconnecting": de navigator blijft, en de app probeert het
// opnieuw. Alleen een echte weigering, met netwerk, geeft het WP13-foutscherm.

type Input = Parameters<typeof deriveSessionState>[0];

const USER = { _id: "users:1", name: "Dev Een", email: "dev1@example.com" };

const READY: Input = {
  clerkLoaded: true,
  clerkSignedIn: true,
  convexAuthLoading: false,
  convexAuthenticated: true,
  currentUser: USER,
  tokenFetchFailed: false,
  online: true,
};

// Clerk ingelogd, Convex klaar en niet geauthenticeerd: wat WP13 convexAuthFailed noemt.
const CONVEX_NO: Input = { ...READY, convexAuthenticated: false };

describe("deriveSessionState — tijdelijk geen token", () => {
  it("tokenophaal mislukt, online: reconnecting (één fout van Clerk)", () => {
    expect(deriveSessionState({ ...CONVEX_NO, tokenFetchFailed: true })).toBe("reconnecting");
  });

  it("tokenophaal mislukt, offline: reconnecting", () => {
    expect(
      deriveSessionState({ ...CONVEX_NO, tokenFetchFailed: true, online: false }),
    ).toBe("reconnecting");
  });

  it("offline, ook als de ophaal niet als mislukt gemeld is: reconnecting", () => {
    expect(deriveSessionState({ ...CONVEX_NO, online: false })).toBe("reconnecting");
  });

  it("netwerk onbekend telt als niet online: reconnecting", () => {
    expect(deriveSessionState({ ...CONVEX_NO, online: null })).toBe("reconnecting");
  });

  it("ook met een gecachte rij van deze sessie (terug uit de achtergrond)", () => {
    expect(
      deriveSessionState({ ...CONVEX_NO, currentUser: USER, tokenFetchFailed: true }),
    ).toBe("reconnecting");
  });

  it("ook met users.current = null: dat is geen 'geen rij' maar 'geen identiteit'", () => {
    expect(
      deriveSessionState({ ...CONVEX_NO, currentUser: null, tokenFetchFailed: true }),
    ).toBe("reconnecting");
  });

  it("koude start offline: nog nooit een rij gezien, toch reconnecting", () => {
    expect(
      deriveSessionState({ ...CONVEX_NO, currentUser: undefined, online: false }),
    ).toBe("reconnecting");
  });
});

describe("deriveSessionState — echte weigering", () => {
  it("token opgehaald, online, Convex zegt nee: convexAuthFailed", () => {
    expect(deriveSessionState(CONVEX_NO)).toBe("convexAuthFailed");
  });

  it("ook met een null-resultaat in de cache", () => {
    expect(deriveSessionState({ ...CONVEX_NO, currentUser: null })).toBe("convexAuthFailed");
  });
});

describe("deriveSessionState — de andere toestanden blijven van WP13", () => {
  it("Clerk uitgelogd wint, ook offline of na een mislukte ophaal", () => {
    for (const online of [true, false, null])
      for (const tokenFetchFailed of [true, false])
        expect(
          deriveSessionState({ ...READY, clerkSignedIn: false, online, tokenFetchFailed }),
        ).toBe("signedOut");
  });

  it("volledig: buiten convexAuthFailed precies wat deriveAuthState zegt", () => {
    const bools = [true, false];
    const users: Input["currentUser"][] = [undefined, null, USER];
    for (const clerkLoaded of bools)
      for (const clerkSignedIn of bools)
        for (const convexAuthLoading of bools)
          for (const convexAuthenticated of bools)
            for (const currentUser of users)
              for (const tokenFetchFailed of bools)
                for (const online of [true, false, null]) {
                  const base = {
                    clerkLoaded,
                    clerkSignedIn,
                    convexAuthLoading,
                    convexAuthenticated,
                    currentUser,
                  };
                  const wp13 = deriveAuthState(base);
                  const state = deriveSessionState({ ...base, tokenFetchFailed, online });
                  if (wp13 !== "convexAuthFailed") {
                    expect(state).toBe(wp13);
                  } else {
                    const temporary = tokenFetchFailed || online !== true;
                    expect(state).toBe(temporary ? "reconnecting" : "convexAuthFailed");
                  }
                }
  });
});

describe("authRetryDue — opnieuw proberen", () => {
  const ON = { appState: "active", online: true };

  it("netwerk terug terwijl de app actief is: ja", () => {
    expect(
      authRetryDue({ state: "reconnecting", before: { appState: "active", online: false }, now: ON }),
    ).toBe(true);
  });

  it("netwerk van onbekend naar online: ja", () => {
    expect(
      authRetryDue({ state: "reconnecting", before: { appState: "active", online: null }, now: ON }),
    ).toBe(true);
  });

  it.each(["background", "inactive", "unknown"])(
    "app van %s naar active, online: ja",
    (appState) => {
      expect(
        authRetryDue({ state: "reconnecting", before: { appState, online: true }, now: ON }),
      ).toBe(true);
    },
  );

  it("niets veranderd (actief en online gebleven): nee, de user tikt op Opnieuw", () => {
    expect(authRetryDue({ state: "reconnecting", before: ON, now: ON })).toBe(false);
  });

  it("nu nog offline of onbekend: nee", () => {
    for (const online of [false, null])
      expect(
        authRetryDue({
          state: "reconnecting",
          before: { appState: "background", online: false },
          now: { appState: "active", online },
        }),
      ).toBe(false);
  });

  it("nu niet actief: nee, ook als het netwerk terug is", () => {
    for (const appState of ["background", "inactive", "unknown"])
      expect(
        authRetryDue({
          state: "reconnecting",
          before: { appState: "background", online: false },
          now: { appState, online: true },
        }),
      ).toBe(false);
  });

  it.each(["loading", "signedOut", "convexAuthFailed", "noUserRow", "ready"] as const)(
    "buiten reconnecting (%s): nooit",
    (state) => {
      expect(
        authRetryDue({ state, before: { appState: "background", online: false }, now: ON }),
      ).toBe(false);
    },
  );
});
