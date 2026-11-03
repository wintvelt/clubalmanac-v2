import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { clerkRestartDue, loginInProgress } from "../src/lib/startupState";
import { isScanned, listFiles, memberNames, moduleUses, parse } from "./support/sourceScan";

// WP15a F14 (R4-2): geen setActive buiten een inlogactie van de user. De hook
// resumeSession kon na uitloggen de sessie weer activeren. Startte Clerk uit
// de cache en is de user uitgelogd, dan start de app Clerk opnieuw zodra het
// netwerk terugkomt. Clerk volgt daarna de echte client.
//
// De login gebruikt signIn.finalize(), dus setActive staat nergens toe.

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const files = listFiles(APP_ROOT).filter(isScanned);
const read = (rel: string) => readFileSync(join(APP_ROOT, rel), "utf8");

const usesSetActive = (text: string) => memberNames(parse(text)).has("setActive");

describe("geen setActive in de app (F14)", () => {
  it("geen bestand spreekt setActive aan", () => {
    expect(files.filter((f) => memberNames(parse(read(f), f)).has("setActive"))).toEqual([]);
  });

  it.each([
    `clerk.setActive({ session: id });`,
    `useClerk().setActive({ session: id });`,
    `const { setActive } = useClerk();`,
    `const { setActive: activate } = useSignIn();`,
    `clerk["setActive"]({ session: id });`,
  ])("vangt: %s", (text) => {
    expect(usesSetActive(text)).toBe(true);
  });

  it.each([`await signIn.finalize();`, `const active = isSignedIn;`, `setActiveTab(1);`])(
    "laat toe: %s",
    (text) => {
      expect(usesSetActive(text)).toBe(false);
    },
  );
});

describe("clerkRestartDue — Clerk opnieuw starten na een start uit de cache (F14)", () => {
  const ON = { appState: "active", online: true };
  const base = { clerkStatus: "degraded" as const, clerkSignedIn: false, loginInProgress: false, now: ON };

  it("degraded, uitgelogd, netwerk terug terwijl de app actief is: ja", () => {
    for (const online of [false, null])
      expect(clerkRestartDue({ ...base, before: { appState: "active", online } })).toBe(true);
  });

  it("netwerk terug terwijl de app in de achtergrond was, en dan actief: ja", () => {
    for (const appState of ["background", "inactive"])
      for (const online of [false, null])
        expect(clerkRestartDue({ ...base, before: { appState, online } })).toBe(true);
  });

  it("alleen terug uit de achtergrond, netwerk was er al: nee (de codestap blijft staan)", () => {
    for (const appState of ["background", "inactive", "unknown"])
      expect(clerkRestartDue({ ...base, before: { appState, online: true } })).toBe(false);
  });

  it("niets veranderd: nee", () => {
    expect(clerkRestartDue({ ...base, before: ON })).toBe(false);
  });

  it("nu offline, onbekend of niet actief: nee", () => {
    const before = { appState: "active", online: false };
    for (const now of [
      { appState: "active", online: false },
      { appState: "active", online: null },
      { appState: "background", online: true },
      { appState: "inactive", online: true },
    ])
      expect(clerkRestartDue({ ...base, before, now })).toBe(false);
  });

  it("ingelogd: nooit (Clerk werkt de client zelf bij, de stacks blijven staan)", () => {
    expect(
      clerkRestartDue({ ...base, clerkSignedIn: true, before: { appState: "active", online: false } }),
    ).toBe(false);
  });

  it.each(["loading", "ready", "error"] as const)("Clerk %s: nooit", (clerkStatus) => {
    for (const clerkSignedIn of [true, false])
      expect(
        clerkRestartDue({ ...base, clerkStatus, clerkSignedIn, before: { appState: "active", online: false } }),
      ).toBe(false);
  });

  // F17 (R5-1): degraded blijft de hele run staan. Een wissel van wifi naar
  // mobiel in de codestap, of terugkomen uit Mail met het netwerk in een
  // aparte render, mag de codestap niet wissen.
  it("een login loopt (codestap): nooit, wat het netwerk of de app ook doet", () => {
    for (const appState of ["active", "background", "inactive", "unknown"])
      for (const online of [false, null, true])
        expect(
          clerkRestartDue({ ...base, loginInProgress: true, before: { appState, online } }),
        ).toBe(false);
  });
});

// F23 (R6-2): een login loopt vanaf de tik op "Stuur code". Tot het antwoord
// binnen is, staat signIn.status nog op needs_identifier.
describe("loginInProgress (F23)", () => {
  it.each([null, "needs_identifier", "needs_first_factor", "complete"])(
    "een verzoek loopt (status %s): ja",
    (signInStatus) => {
      expect(loginInProgress({ signInStatus, requestRunning: true })).toBe(true);
    },
  );

  it("Clerk wacht op de code, geen verzoek: ja", () => {
    expect(loginInProgress({ signInStatus: "needs_first_factor", requestRunning: false })).toBe(true);
  });

  it.each([null, "needs_identifier", "complete"])("geen verzoek, status %s: nee", (signInStatus) => {
    expect(loginInProgress({ signInStatus, requestRunning: false })).toBe(false);
  });

  it("de poort gebruikt loginInProgress uit src/lib/startupState", () => {
    const sf = parse(read("src/AuthGate.tsx"), "src/AuthGate.tsx");
    const imported = moduleUses(sf).some(
      (u) => /(^|\/)lib\/startupState$/.test(u.module) && u.names.includes("loginInProgress"),
    );
    expect(imported).toBe(true);
  });
});
