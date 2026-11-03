import { describe, expect, it } from "vitest";
import { VISIT_PERIOD_MS, shouldRecordVisit } from "../src/lib/visit";
import type { SessionState } from "../src/lib/sessionState";

// WP15b invarianten 5 en 12, A-punt 2: wanneer roept de app recordVisit aan?
// Een bezoek is de overgang naar "actief en ingelogd" (AppState `active` en
// toestand `ready`), ook bij een koude start en na inloggen. De client slaat
// een aanroep over als zijn laatste poging voor deze user minder dan een uur
// geleden is. Een mislukte poging telt ook: zo ontstaat er geen lus. De
// backend throttlet zelf ook (tests/users/recordVisit.test.ts).

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const USER = "user_a";

type Moment = { appState: string; authState: SessionState };
const LIVE: Moment = { appState: "active", authState: "ready" };
const BACKGROUND: Moment = { appState: "background", authState: "ready" };

function decide(over: Partial<Parameters<typeof shouldRecordVisit>[0]> = {}) {
  return shouldRecordVisit({
    previous: BACKGROUND,
    current: LIVE,
    userId: USER,
    now: NOW,
    lastAttempt: null,
    ...over,
  });
}

describe("VISIT_PERIOD_MS", () => {
  it("is een uur, net als in de backend", () => {
    expect(VISIT_PERIOD_MS).toBe(HOUR);
  });
});

describe("shouldRecordVisit — wat telt als bezoek", () => {
  it("terug uit de achtergrond, ingelogd: ja", () => {
    expect(decide()).toBe(true);
  });

  it("terug uit inactive (Bedieningspaneel): ja, als de throttle het toelaat", () => {
    expect(decide({ previous: { appState: "inactive", authState: "ready" } })).toBe(true);
  });

  it("koude start: van laden naar ready terwijl de app actief is: ja", () => {
    expect(decide({ previous: { appState: "active", authState: "loading" } })).toBe(true);
  });

  it("net ingelogd: van signedOut naar ready: ja", () => {
    expect(decide({ previous: { appState: "active", authState: "signedOut" } })).toBe(true);
  });

  it("verbinding terug: van reconnecting naar ready: ja, als de throttle het toelaat", () => {
    expect(decide({ previous: { appState: "active", authState: "reconnecting" } })).toBe(true);
  });

  it("geen overgang: al actief en ready: nee", () => {
    expect(decide({ previous: LIVE })).toBe(false);
  });

  it.each<[string, Moment]>([
    ["achtergrond", { appState: "background", authState: "ready" }],
    ["inactive", { appState: "inactive", authState: "ready" }],
    ["onbekende AppState", { appState: "unknown", authState: "ready" }],
    ["laden", { appState: "active", authState: "loading" }],
    ["uitgelogd", { appState: "active", authState: "signedOut" }],
    ["reconnecting", { appState: "active", authState: "reconnecting" }],
    ["Convex weigert", { appState: "active", authState: "convexAuthFailed" }],
    ["geen rij", { appState: "active", authState: "noUserRow" }],
  ])("nu %s: nee", (_label, current) => {
    expect(decide({ current })).toBe(false);
  });

  it("zonder userId: nee", () => {
    expect(decide({ userId: null })).toBe(false);
  });
});

describe("shouldRecordVisit — throttle in de client", () => {
  it("laatste poging 59 minuten geleden: nee", () => {
    expect(decide({ lastAttempt: { userId: USER, at: NOW - 59 * 60 * 1000 } })).toBe(false);
  });

  it("laatste poging precies een uur geleden: ja", () => {
    expect(decide({ lastAttempt: { userId: USER, at: NOW - HOUR } })).toBe(true);
  });

  it("laatste poging was van een andere user: ja (invariant 12)", () => {
    expect(decide({ lastAttempt: { userId: "user_b", at: NOW - 1000 } })).toBe(true);
  });

  it("laatste poging ligt in de toekomst (klok verzet): ja", () => {
    expect(decide({ lastAttempt: { userId: USER, at: NOW + HOUR } })).toBe(true);
  });

  it("de throttle geldt ook als er geen overgang is: nee", () => {
    expect(decide({ previous: LIVE, lastAttempt: { userId: USER, at: NOW - 2 * HOUR } })).toBe(false);
  });
});

describe("shouldRecordVisit — geen lus", () => {
  it("snel heen en weer tussen achtergrond en actief: één aanroep per uur", () => {
    let lastAttempt: { userId: string; at: number } | null = null;
    let calls = 0;
    let previous: Moment = { appState: "active", authState: "loading" };
    for (let i = 0; i < 120; i++) {
      // Elke 30 seconden een wissel: om en om actief en achtergrond.
      const current = i % 2 === 0 ? LIVE : BACKGROUND;
      const now = NOW + i * 30 * 1000;
      if (shouldRecordVisit({ previous, current, userId: USER, now, lastAttempt })) {
        calls++;
        // Mislukt of gelukt: de poging telt.
        lastAttempt = { userId: USER, at: now };
      }
      previous = current;
    }
    expect(calls).toBe(1);
  });
});
