import { describe, expect, it } from "vitest";
import { deriveAuthState } from "../src/lib/authState";

// WP13 invarianten 4, 10 + 13: welke toestand toont de app?
// Vijf toestanden: loading / signedOut / convexAuthFailed / noUserRow / ready.
// `currentUser` volgt de useQuery-conventie: undefined = laadt, null = geen rij.

type Input = Parameters<typeof deriveAuthState>[0];

const USER = { _id: "users:1", name: "Dev Een", email: "dev1@example.com" };

// Volledig ingelogd, rij gevonden. Elke test wijzigt alleen wat hij bekijkt.
const READY: Input = {
  clerkLoaded: true,
  clerkSignedIn: true,
  convexAuthLoading: false,
  convexAuthenticated: true,
  currentUser: USER,
};

describe("deriveAuthState — de vijf toestanden", () => {
  it("ready: Clerk ingelogd, Convex akkoord, rij gevonden", () => {
    expect(deriveAuthState(READY)).toBe("ready");
  });

  it("noUserRow: ingelogd, maar users.current geeft null", () => {
    expect(deriveAuthState({ ...READY, currentUser: null })).toBe("noUserRow");
  });

  it("signedOut: Clerk geladen, niet ingelogd", () => {
    expect(
      deriveAuthState({
        clerkLoaded: true,
        clerkSignedIn: false,
        convexAuthLoading: false,
        convexAuthenticated: false,
        currentUser: undefined,
      }),
    ).toBe("signedOut");
  });

  it("convexAuthFailed: Clerk ingelogd, Convex klaar maar weigert het token", () => {
    expect(
      deriveAuthState({
        ...READY,
        convexAuthLoading: false,
        convexAuthenticated: false,
        currentUser: undefined,
      }),
    ).toBe("convexAuthFailed");
  });

  it("convexAuthFailed ook als er (nog) een null-resultaat in de cache staat", () => {
    // Zonder identiteit geeft users.current null. Dat mag niet als
    // "ingelogd zonder rij" verschijnen: de oorzaak is het token.
    expect(
      deriveAuthState({
        ...READY,
        convexAuthLoading: false,
        convexAuthenticated: false,
        currentUser: null,
      }),
    ).toBe("convexAuthFailed");
  });
});

describe("deriveAuthState — laden", () => {
  it("loading zolang Clerk niet geladen is", () => {
    expect(
      deriveAuthState({
        clerkLoaded: false,
        clerkSignedIn: false,
        convexAuthLoading: true,
        convexAuthenticated: false,
        currentUser: undefined,
      }),
    ).toBe("loading");
  });

  it("loading zolang Clerk niet geladen is, ook als Convex al iets zegt", () => {
    expect(deriveAuthState({ ...READY, clerkLoaded: false })).toBe("loading");
  });

  it("loading: Clerk ingelogd, Convex controleert het token nog", () => {
    expect(
      deriveAuthState({
        ...READY,
        convexAuthLoading: true,
        convexAuthenticated: false,
        currentUser: undefined,
      }),
    ).toBe("loading");
  });

  it("loading: Convex akkoord, users.current nog onderweg", () => {
    expect(deriveAuthState({ ...READY, currentUser: undefined })).toBe(
      "loading",
    );
  });
});

describe("deriveAuthState — geen data van de vorige user (invariant 13)", () => {
  it("Clerk uitgelogd wint van een gecachte rij en een Convex-ja", () => {
    expect(deriveAuthState({ ...READY, clerkSignedIn: false })).toBe(
      "signedOut",
    );
  });

  it("Clerk uitgelogd wint ook terwijl Convex nog bezig is", () => {
    expect(
      deriveAuthState({
        ...READY,
        clerkSignedIn: false,
        convexAuthLoading: true,
      }),
    ).toBe("signedOut");
  });

  it("nooit ready zonder bevestiging van Convex, ook met gecachte rij", () => {
    expect(
      deriveAuthState({ ...READY, convexAuthLoading: true }),
    ).not.toBe("ready");
    expect(
      deriveAuthState({ ...READY, convexAuthenticated: false }),
    ).not.toBe("ready");
  });
});

describe("deriveAuthState — volledig", () => {
  it("geeft voor elke combinatie een van de vijf toestanden", () => {
    const allowed = new Set([
      "loading",
      "signedOut",
      "convexAuthFailed",
      "noUserRow",
      "ready",
    ]);
    const bools = [true, false];
    const users: Input["currentUser"][] = [undefined, null, USER];
    for (const clerkLoaded of bools)
      for (const clerkSignedIn of bools)
        for (const convexAuthLoading of bools)
          for (const convexAuthenticated of bools)
            for (const currentUser of users) {
              const state = deriveAuthState({
                clerkLoaded,
                clerkSignedIn,
                convexAuthLoading,
                convexAuthenticated,
                currentUser,
              });
              expect(allowed.has(state)).toBe(true);
              // ready vereist alles: niets anders mag ready opleveren.
              if (state === "ready") {
                expect(clerkLoaded && clerkSignedIn).toBe(true);
                expect(!convexAuthLoading && convexAuthenticated).toBe(true);
                expect(currentUser).toBe(USER);
              }
            }
  });
});
