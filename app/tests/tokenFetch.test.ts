import { describe, expect, it } from "vitest";
import {
  finishTokenFetch,
  initialTokenFetch,
  startTokenFetch,
  tokenFetchFailed,
} from "../src/lib/tokenFetch";

// WP15a F9: alleen de laatst gestarte tokenophaal telt. Clerk's getToken
// probeert zelf opnieuw met backoff (tot ongeveer 2,5 minuut), dus pogingen
// overlappen. Een late uitkomst van een oude poging mag tokenFetchFailed niet
// op "gelukt" zetten terwijl Convex geen identiteit heeft. Dan zou de app
// "server weigert je sessie" tonen in plaats van "reconnecting".

describe("tokenFetch — één poging", () => {
  it("begint als niet mislukt", () => {
    expect(tokenFetchFailed(initialTokenFetch)).toBe(false);
  });

  it("mislukt → mislukt; gelukt → niet mislukt", () => {
    const a = startTokenFetch(initialTokenFetch);
    expect(tokenFetchFailed(finishTokenFetch(a.state, a.id, false))).toBe(true);
    expect(tokenFetchFailed(finishTokenFetch(a.state, a.id, true))).toBe(false);
  });

  it("een poging die nog loopt, verandert de vorige uitkomst niet", () => {
    const a = startTokenFetch(initialTokenFetch);
    const failed = finishTokenFetch(a.state, a.id, false);
    const b = startTokenFetch(failed);
    expect(tokenFetchFailed(b.state)).toBe(true);
  });
});

describe("tokenFetch — overlappende pogingen (F9)", () => {
  it("elke poging krijgt een eigen id", () => {
    const a = startTokenFetch(initialTokenFetch);
    const b = startTokenFetch(a.state);
    const c = startTokenFetch(b.state);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });

  it("een late 'gelukt' van een oude poging telt niet", () => {
    const a = startTokenFetch(initialTokenFetch);
    const b = startTokenFetch(a.state);
    let s = finishTokenFetch(b.state, b.id, false); // de huidige mislukt
    s = finishTokenFetch(s, a.id, true); // de oude komt laat binnen met een token
    expect(tokenFetchFailed(s)).toBe(true);
  });

  it("een late 'mislukt' van een oude poging telt ook niet", () => {
    const a = startTokenFetch(initialTokenFetch);
    const b = startTokenFetch(a.state);
    let s = finishTokenFetch(b.state, b.id, true);
    s = finishTokenFetch(s, a.id, false);
    expect(tokenFetchFailed(s)).toBe(false);
  });

  it("een oude poging die eerder klaar is dan de nieuwe, telt niet", () => {
    const a = startTokenFetch(initialTokenFetch);
    const failedBefore = finishTokenFetch(a.state, a.id, false);
    const b = startTokenFetch(failedBefore);
    const c = startTokenFetch(b.state);
    // b (niet meer de laatste) is klaar vóór c
    const s = finishTokenFetch(c.state, b.id, true);
    expect(tokenFetchFailed(s)).toBe(true);
    expect(tokenFetchFailed(finishTokenFetch(s, c.id, true))).toBe(false);
  });

  it("dezelfde poging twee keer melden: de eerste melding blijft niet hangen", () => {
    const a = startTokenFetch(initialTokenFetch);
    let s = finishTokenFetch(a.state, a.id, false);
    s = finishTokenFetch(s, a.id, true);
    expect(tokenFetchFailed(s)).toBe(false);
  });

  it("een onbekend id verandert niets", () => {
    const a = startTokenFetch(initialTokenFetch);
    const s = finishTokenFetch(a.state, a.id, false);
    expect(tokenFetchFailed(finishTokenFetch(s, a.id + 1000, true))).toBe(true);
    expect(tokenFetchFailed(finishTokenFetch(s, -1, true))).toBe(true);
  });

  it("de toestand wordt niet ter plekke gewijzigd", () => {
    const a = startTokenFetch(initialTokenFetch);
    finishTokenFetch(a.state, a.id, false);
    expect(tokenFetchFailed(a.state)).toBe(false);
    expect(tokenFetchFailed(initialTokenFetch)).toBe(false);
  });
});
