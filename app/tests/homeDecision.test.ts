import { describe, expect, it } from "vitest";
import { createHomeDecisionStore, homeSessionKey } from "../src/lib/homeDecision";

// WP16 invariant 12, fix-cyclus 1 (S1): Home kiest één keer per sessie. De
// keuze overleeft een remount van Mijn groepen (na "reconnecting", na
// "Opnieuw" in de foutgrens), want het geheugen staat buiten het scherm.
// Een nieuwe sessie (uitloggen en inloggen, ook als een ander) kiest opnieuw.

describe("homeSessionKey", () => {
  it("user en sessie samen", () => {
    expect(homeSessionKey("user_a", "sess_1")).toBe("user_a:sess_1");
  });

  it.each([
    [null, "sess_1"],
    ["user_a", null],
    [undefined, undefined],
    ["", "sess_1"],
  ])("zonder user of sessie (%s, %s): geen sleutel", (userId, sessionId) => {
    expect(homeSessionKey(userId, sessionId)).toBeNull();
  });
});

describe("createHomeDecisionStore", () => {
  const A1 = homeSessionKey("user_a", "sess_1");
  const A2 = homeSessionKey("user_a", "sess_2");
  const B3 = homeSessionKey("user_b", "sess_3");

  it("een nieuwe sessie heeft nog niet gekozen", () => {
    expect(createHomeDecisionStore().isDecided(A1)).toBe(false);
  });

  it("na de keuze blijft hij gekozen, ook bij een tweede mount van het scherm", () => {
    const store = createHomeDecisionStore();
    store.markDecided(A1);
    // Een remount leest hetzelfde geheugen: elke vraag geeft hetzelfde antwoord.
    expect(store.isDecided(A1)).toBe(true);
    expect(store.isDecided(A1)).toBe(true);
  });

  it("uitloggen en inloggen als dezelfde user: een nieuwe sessie kiest opnieuw", () => {
    const store = createHomeDecisionStore();
    store.markDecided(A1);
    expect(store.isDecided(A2)).toBe(false);
  });

  it("inloggen als een andere user: kiest opnieuw, en de vorige sessie telt niet meer", () => {
    const store = createHomeDecisionStore();
    store.markDecided(A1);
    expect(store.isDecided(B3)).toBe(false);
    store.markDecided(B3);
    expect(store.isDecided(B3)).toBe(true);
    expect(store.isDecided(A1)).toBe(false);
  });

  it("zonder sleutel: nooit gekozen, en markeren doet niets", () => {
    const store = createHomeDecisionStore();
    store.markDecided(null);
    expect(store.isDecided(null)).toBe(false);
    store.markDecided(A1);
    store.markDecided(null);
    expect(store.isDecided(A1)).toBe(true);
  });

  it("een koude start begint leeg", () => {
    const first = createHomeDecisionStore();
    first.markDecided(A1);
    expect(createHomeDecisionStore().isDecided(A1)).toBe(false);
  });
});
