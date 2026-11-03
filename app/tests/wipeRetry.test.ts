import { describe, expect, it } from "vitest";
import { wipeRetryShown } from "../src/lib/wipeRetry";

// WP15a F20 (R5-3): "Opnieuw wissen" na een mislukte wis mag geen lopende
// login raken. Een login doet resume() vóór zijn eerste verzoek; een wis
// daarna wist het client-token van die poging. Dus alleen in de e-mailstap,
// en alleen als er geen verzoek loopt. Melding en knop staan er samen.

describe("wipeRetryShown (F20)", () => {
  it("wis mislukt, e-mailstap, geen verzoek: ja", () => {
    expect(wipeRetryShown({ wipeFailed: true, step: "email", busy: false })).toBe(true);
  });

  it("in de codestap: nooit", () => {
    for (const busy of [true, false])
      expect(wipeRetryShown({ wipeFailed: true, step: "code", busy })).toBe(false);
  });

  it("een verzoek loopt in de e-mailstap: nee", () => {
    expect(wipeRetryShown({ wipeFailed: true, step: "email", busy: true })).toBe(false);
  });

  it("de wis lukte: nooit", () => {
    for (const step of ["email", "code"] as const)
      for (const busy of [true, false]) expect(wipeRetryShown({ wipeFailed: false, step, busy })).toBe(false);
  });
});
