import { describe, expect, it } from "vitest";
import type { AuthState } from "../src/lib/authState";
import { screenQueryIsLive, sessionQueryIsLive } from "../src/lib/liveQuery";

// WP15a invarianten 5, 12, 13 + 14: loopt een live query, ja of nee?
// Live alleen voor het scherm in beeld, zolang de app actief is, en alleen
// met een geldige sessie. Alles wat niet expliciet "ja" is, is "nee".

const AUTH_STATES: AuthState[] = [
  "loading",
  "signedOut",
  "convexAuthFailed",
  "noUserRow",
  "ready",
];

// De waarden van React Native AppState, plus een die er (nog) niet is.
const APP_STATES = ["active", "background", "inactive", "unknown", "extension"];
const NOT_ACTIVE = ["background", "inactive", "unknown", "extension", "", "Active", "iets-nieuws"];

describe("screenQueryIsLive — het scherm in beeld", () => {
  it("live: focus, app actief, sessie ready", () => {
    expect(
      screenQueryIsLive({ focused: true, appState: "active", authState: "ready" }),
    ).toBe(true);
  });

  it("niet live zonder focus (andere tab, onderliggend stack-scherm, scherm onder een modaal)", () => {
    expect(
      screenQueryIsLive({ focused: false, appState: "active", authState: "ready" }),
    ).toBe(false);
  });

  it.each(NOT_ACTIVE)("niet live bij AppState %j, ook met focus en sessie", (appState) => {
    expect(screenQueryIsLive({ focused: true, appState, authState: "ready" })).toBe(false);
  });

  it.each(AUTH_STATES.filter((s) => s !== "ready"))(
    "niet live bij auth %s, ook met focus en app actief",
    (authState) => {
      expect(screenQueryIsLive({ focused: true, appState: "active", authState })).toBe(false);
    },
  );

  it("terug uit de achtergrond: weer live zonder iets anders te veranderen", () => {
    const base = { focused: true, authState: "ready" as const };
    expect(screenQueryIsLive({ ...base, appState: "background" })).toBe(false);
    expect(screenQueryIsLive({ ...base, appState: "active" })).toBe(true);
  });

  it("volledig: live precies bij focus × active × ready", () => {
    for (const focused of [true, false])
      for (const appState of APP_STATES)
        for (const authState of AUTH_STATES) {
          const expected = focused && appState === "active" && authState === "ready";
          expect(screenQueryIsLive({ focused, appState, authState })).toBe(expected);
        }
  });
});

describe("sessionQueryIsLive — de query achter de auth-poort (users.current)", () => {
  type Input = Parameters<typeof sessionQueryIsLive>[0];

  const LIVE: Input = {
    appState: "active",
    clerkLoaded: true,
    clerkSignedIn: true,
    convexAuthLoading: false,
    convexAuthenticated: true,
  };

  it("live: app actief, Clerk ingelogd, Convex akkoord", () => {
    expect(sessionQueryIsLive(LIVE)).toBe(true);
  });

  it.each(NOT_ACTIVE)("niet live bij AppState %j: ook deze query pauzeert", (appState) => {
    expect(sessionQueryIsLive({ ...LIVE, appState })).toBe(false);
  });

  it("niet live zolang Clerk niet geladen is", () => {
    expect(sessionQueryIsLive({ ...LIVE, clerkLoaded: false })).toBe(false);
  });

  it("niet live als Clerk uitgelogd is, ook als Convex nog akkoord zegt", () => {
    expect(sessionQueryIsLive({ ...LIVE, clerkSignedIn: false })).toBe(false);
  });

  it("niet live zolang Convex het token nog controleert", () => {
    expect(sessionQueryIsLive({ ...LIVE, convexAuthLoading: true })).toBe(false);
  });

  it("niet live als Convex het token weigert", () => {
    expect(sessionQueryIsLive({ ...LIVE, convexAuthenticated: false })).toBe(false);
  });

  it("volledig: live precies als alles klopt", () => {
    const bools = [true, false];
    for (const appState of APP_STATES)
      for (const clerkLoaded of bools)
        for (const clerkSignedIn of bools)
          for (const convexAuthLoading of bools)
            for (const convexAuthenticated of bools) {
              const expected =
                appState === "active" &&
                clerkLoaded &&
                clerkSignedIn &&
                !convexAuthLoading &&
                convexAuthenticated;
              expect(
                sessionQueryIsLive({
                  appState,
                  clerkLoaded,
                  clerkSignedIn,
                  convexAuthLoading,
                  convexAuthenticated,
                }),
              ).toBe(expected);
            }
  });
});
