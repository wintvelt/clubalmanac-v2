import { describe, expect, it } from "vitest";
import type { SessionState } from "../src/lib/sessionState";
import { deriveStartupState, STARTUP_TIMEOUT_MS, startupRetryDue } from "../src/lib/startupState";

// WP15a F12: een koude start zonder netwerk blijft nooit eindeloos op "Laden…".
// Clerk faalt offline zonder resource-cache in load(), zet zijn status op
// "error" en probeert het niet opnieuw. Ook met de cache kan "laden" blijven
// hangen (Convex bevestigt het token niet). Na een vaste time-out volgt:
// - met een sessie: reconnecting (kop, tabbalk, de melding uit F6–F8);
// - zonder bekende sessie: startupFailed (statusscherm met "Opnieuw").
// Komt de app actief en online terug, dan start de app Clerk opnieuw.

type Input = Parameters<typeof deriveStartupState>[0];

const NOT_LOADING: SessionState[] = [
  "signedOut",
  "convexAuthFailed",
  "noUserRow",
  "reconnecting",
  "ready",
];
const CLERK = ["loading", "ready", "degraded", "error"] as const;
const LATE = STARTUP_TIMEOUT_MS;
const EARLY = STARTUP_TIMEOUT_MS - 1;

const base: Input = { session: "loading", clerkStatus: "loading", clerkSignedIn: false, loadingForMs: 0 };

describe("deriveStartupState — buiten laden verandert niets", () => {
  it("elke andere toestand blijft zoals hij is, hoe lang ook en wat Clerk ook zegt", () => {
    for (const session of NOT_LOADING)
      for (const clerkStatus of CLERK)
        for (const clerkSignedIn of [true, false])
          for (const loadingForMs of [0, LATE, 3_600_000])
            expect(deriveStartupState({ session, clerkStatus, clerkSignedIn, loadingForMs })).toBe(session);
  });
});

describe("deriveStartupState — Clerk start niet", () => {
  it("Clerk in error: direct startupFailed, niet eerst wachten", () => {
    for (const loadingForMs of [0, 1, EARLY, LATE])
      for (const clerkSignedIn of [true, false])
        expect(deriveStartupState({ ...base, clerkStatus: "error", clerkSignedIn, loadingForMs })).toBe(
          "startupFailed",
        );
  });

  it("Clerk laadt nog, binnen de time-out: laden", () => {
    for (const loadingForMs of [0, 1, EARLY])
      expect(deriveStartupState({ ...base, loadingForMs })).toBe("loading");
  });

  it("Clerk laadt nog, time-out voorbij: startupFailed", () => {
    for (const loadingForMs of [LATE, LATE + 1, 3_600_000])
      expect(deriveStartupState({ ...base, loadingForMs })).toBe("startupFailed");
  });
});

describe("deriveStartupState — Clerk geladen, Convex bevestigt niet", () => {
  it.each(["ready", "degraded"] as const)(
    "Clerk %s en ingelogd, binnen de time-out: laden",
    (clerkStatus) => {
      expect(
        deriveStartupState({ ...base, clerkStatus, clerkSignedIn: true, loadingForMs: EARLY }),
      ).toBe("loading");
    },
  );

  it.each(["ready", "degraded"] as const)(
    "Clerk %s en ingelogd, time-out voorbij: reconnecting (kop, tabbalk, melding)",
    (clerkStatus) => {
      expect(
        deriveStartupState({ ...base, clerkStatus, clerkSignedIn: true, loadingForMs: LATE }),
      ).toBe("reconnecting");
    },
  );

  it.each(["ready", "degraded"] as const)(
    "Clerk %s maar uitgelogd, time-out voorbij: startupFailed (geen ingelogde schil zonder sessie)",
    (clerkStatus) => {
      expect(
        deriveStartupState({ ...base, clerkStatus, clerkSignedIn: false, loadingForMs: LATE }),
      ).toBe("startupFailed");
    },
  );
});

describe("deriveStartupState — volledig", () => {
  it("laden duurt nooit langer dan de time-out", () => {
    for (const clerkStatus of CLERK)
      for (const clerkSignedIn of [true, false])
        expect(
          deriveStartupState({ session: "loading", clerkStatus, clerkSignedIn, loadingForMs: LATE }),
        ).not.toBe("loading");
  });

  it("reconnecting alleen met een geladen Clerk die ingelogd zegt", () => {
    for (const clerkStatus of CLERK)
      for (const clerkSignedIn of [true, false])
        for (const loadingForMs of [0, EARLY, LATE]) {
          const s = deriveStartupState({ session: "loading", clerkStatus, clerkSignedIn, loadingForMs });
          if (s === "reconnecting") {
            expect(["ready", "degraded"]).toContain(clerkStatus);
            expect(clerkSignedIn).toBe(true);
          }
        }
  });

  it("de time-out is vast, en ligt tussen 5 en 30 seconden", () => {
    expect(Number.isFinite(STARTUP_TIMEOUT_MS)).toBe(true);
    expect(STARTUP_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(STARTUP_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("startupRetryDue — Clerk opnieuw starten", () => {
  const ON = { appState: "active", online: true };

  it("netwerk terug terwijl de app actief is: ja", () => {
    for (const online of [false, null])
      expect(
        startupRetryDue({ state: "startupFailed", before: { appState: "active", online }, now: ON }),
      ).toBe(true);
  });

  it.each(["background", "inactive", "unknown"])("app van %s naar active, online: ja", (appState) => {
    expect(startupRetryDue({ state: "startupFailed", before: { appState, online: true }, now: ON })).toBe(
      true,
    );
  });

  it("niets veranderd: nee, de user tikt op Opnieuw", () => {
    expect(startupRetryDue({ state: "startupFailed", before: ON, now: ON })).toBe(false);
  });

  it("nu offline, onbekend of niet actief: nee", () => {
    const before = { appState: "background", online: false };
    for (const now of [
      { appState: "active", online: false },
      { appState: "active", online: null },
      { appState: "background", online: true },
      { appState: "inactive", online: true },
    ])
      expect(startupRetryDue({ state: "startupFailed", before, now })).toBe(false);
  });

  it.each(["loading", ...NOT_LOADING] as const)("buiten startupFailed (%s): nooit", (state) => {
    expect(
      startupRetryDue({ state, before: { appState: "background", online: false }, now: ON }),
    ).toBe(false);
  });
});
