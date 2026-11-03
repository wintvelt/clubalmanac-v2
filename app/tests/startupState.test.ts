import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { SessionState } from "../src/lib/sessionState";
import { deriveStartupState, STARTUP_TIMEOUT_MS, startupRetryDue } from "../src/lib/startupState";
import { isScanned, listFiles, moduleUses, parse } from "./support/sourceScan";

// WP15a F12: een koude start zonder netwerk blijft nooit eindeloos op "Laden…".
// Clerk faalt offline zonder resource-cache in load(), zet zijn status op
// "error" en probeert het niet opnieuw. Ook met de cache kan "laden" blijven
// hangen (Convex bevestigt het token niet). Na een vaste time-out volgt:
// - met een sessie: reconnecting (kop, tabbalk, de melding uit F6–F8);
// - zonder bekende sessie: startupFailed (statusscherm met "Opnieuw").
// Komt de app actief en online terug, dan start de app Clerk opnieuw.
// F16: de poort geeft een vlag "time-out afgelopen", geen duur. Zo hangt de
// beslissing niet van de klok af.

type Input = Parameters<typeof deriveStartupState>[0];

const NOT_LOADING: SessionState[] = [
  "signedOut",
  "convexAuthFailed",
  "noUserRow",
  "reconnecting",
  "ready",
];
const CLERK = ["loading", "ready", "degraded", "error"] as const;
const base: Input = { session: "loading", clerkStatus: "loading", clerkSignedIn: false, loadingTimedOut: false };

describe("deriveStartupState — buiten laden verandert niets", () => {
  it("elke andere toestand blijft zoals hij is, hoe lang ook en wat Clerk ook zegt", () => {
    for (const session of NOT_LOADING)
      for (const clerkStatus of CLERK)
        for (const clerkSignedIn of [true, false])
          for (const loadingTimedOut of [false, true])
            expect(deriveStartupState({ session, clerkStatus, clerkSignedIn, loadingTimedOut })).toBe(session);
  });
});

describe("deriveStartupState — Clerk start niet", () => {
  it("Clerk in error: direct startupFailed, niet eerst wachten", () => {
    for (const loadingTimedOut of [false, true])
      for (const clerkSignedIn of [true, false])
        expect(deriveStartupState({ ...base, clerkStatus: "error", clerkSignedIn, loadingTimedOut })).toBe(
          "startupFailed",
        );
  });

  it("Clerk laadt nog, binnen de time-out: laden", () => {
    expect(deriveStartupState({ ...base, loadingTimedOut: false })).toBe("loading");
  });

  it("Clerk laadt nog, time-out voorbij: startupFailed", () => {
    expect(deriveStartupState({ ...base, loadingTimedOut: true })).toBe("startupFailed");
  });
});

describe("deriveStartupState — Clerk geladen, Convex bevestigt niet", () => {
  it.each(["ready", "degraded"] as const)(
    "Clerk %s en ingelogd, binnen de time-out: laden",
    (clerkStatus) => {
      expect(
        deriveStartupState({ ...base, clerkStatus, clerkSignedIn: true, loadingTimedOut: false }),
      ).toBe("loading");
    },
  );

  it.each(["ready", "degraded"] as const)(
    "Clerk %s en ingelogd, time-out voorbij: reconnecting (kop, tabbalk, melding)",
    (clerkStatus) => {
      expect(
        deriveStartupState({ ...base, clerkStatus, clerkSignedIn: true, loadingTimedOut: true }),
      ).toBe("reconnecting");
    },
  );

  it.each(["ready", "degraded"] as const)(
    "Clerk %s maar uitgelogd, time-out voorbij: startupFailed (geen ingelogde schil zonder sessie)",
    (clerkStatus) => {
      expect(
        deriveStartupState({ ...base, clerkStatus, clerkSignedIn: false, loadingTimedOut: true }),
      ).toBe("startupFailed");
    },
  );
});

describe("deriveStartupState — volledig", () => {
  it("laden duurt nooit langer dan de time-out", () => {
    for (const clerkStatus of CLERK)
      for (const clerkSignedIn of [true, false])
        expect(
          deriveStartupState({ session: "loading", clerkStatus, clerkSignedIn, loadingTimedOut: true }),
        ).not.toBe("loading");
  });

  it("reconnecting alleen met een geladen Clerk die ingelogd zegt", () => {
    for (const clerkStatus of CLERK)
      for (const clerkSignedIn of [true, false])
        for (const loadingTimedOut of [false, true]) {
          const s = deriveStartupState({ session: "loading", clerkStatus, clerkSignedIn, loadingTimedOut });
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

  it("app terug uit de achtergrond, online: ja", () => {
    expect(
      startupRetryDue({ state: "startupFailed", before: { appState: "background", online: true }, now: ON }),
    ).toBe(true);
  });

  // F18 (K8): inactive is het Bedieningspaneel, een melding of de
  // app-wisselaar. Dat is niet "terugkomen", en mag de app niet herladen.
  it.each(["inactive", "unknown"])("van %s naar active, netwerk al aan: nee", (appState) => {
    expect(startupRetryDue({ state: "startupFailed", before: { appState, online: true }, now: ON })).toBe(
      false,
    );
  });

  it.each(["inactive", "unknown"])("van %s naar active, en het netwerk kwam terug: ja", (appState) => {
    for (const online of [false, null])
      expect(startupRetryDue({ state: "startupFailed", before: { appState, online }, now: ON })).toBe(true);
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

// F16 (R4-4): een time-out loopt altijd één keer af, ook als de klok
// verspringt. Wie met een time-out werkt, rekent dus niet met de klok.
describe("time-outs rekenen niet met de klok (F16)", () => {
  const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
  const TIMEOUTS = ["STARTUP_TIMEOUT_MS", "RECONNECT_TIMEOUT_MS"];
  const DEFINED_IN = ["src/lib/startupState.ts", "src/lib/reconnectView.ts"];
  const read = (rel: string) => readFileSync(join(APP_ROOT, rel), "utf8");

  const clockCalls = (sf: ts.SourceFile): string[] => {
    const found: string[] = [];
    const visit = (n: ts.Node) => {
      if (
        ts.isPropertyAccessExpression(n) &&
        ts.isIdentifier(n.expression) &&
        ["Date", "performance"].includes(n.expression.text) &&
        n.name.text === "now"
      )
        found.push(`${n.expression.text}.now`);
      if ((ts.isNewExpression(n) || ts.isCallExpression(n)) && ts.isIdentifier(n.expression) && n.expression.text === "Date")
        found.push("Date()");
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
  };

  const users = listFiles(APP_ROOT)
    .filter(isScanned)
    .filter(
      (f) =>
        DEFINED_IN.includes(f) ||
        moduleUses(parse(read(f), f)).some((u) => u.names.some((n) => TIMEOUTS.includes(n))),
    );

  it("de scan vindt de poort en het scherm", () => {
    expect(users).toContain("src/AuthGate.tsx");
    expect(users.length).toBeGreaterThan(DEFINED_IN.length);
  });

  it("geen Date.now, performance.now of new Date in die bestanden", () => {
    const offenders: Record<string, string[]> = {};
    for (const f of users) {
      const calls = clockCalls(parse(read(f), f));
      if (calls.length > 0) offenders[f] = calls;
    }
    expect(offenders).toEqual({});
  });

  it.each([`Date.now()`, `performance.now()`, `new Date()`, `new Date(x).getTime()`, `const t = Date.now;`])(
    "vangt: %s",
    (text) => {
      expect(clockCalls(parse(text)).length).toBeGreaterThan(0);
    },
  );

  it.each([`setTimeout(cb, STARTUP_TIMEOUT_MS);`, `const now = useNow();`, `x.now()`])("laat toe: %s", (text) => {
    expect(clockCalls(parse(text))).toEqual([]);
  });
});
