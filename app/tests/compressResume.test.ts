import { describe, expect, it } from "vitest";
import { COMPRESS_AUTO_RETRIES, afterCompressFailure, leftForeground } from "../src/lib/compressResume";
import { videoRetryable } from "../src/lib/videos";

// WP38b besluit 25: verkleinen dat stopt omdat de app de voorgrond verliet,
// probeert het opnieuw zodra de app terug is. Ook voor gewone filmpjes (WP37).
//   - De spike (uitkomst 11): iOS stopt het verkleinen als de app de voorgrond
//     verlaat; het lid kreeg dan "verkleinen lukte niet".
//   - Was de app tijdens het verkleinen niet steeds `active` (achtergrond of
//     inactief), dan is een mislukking geen fout van het filmpje: wachten tot
//     de app weer `active` is en opnieuw, met dezelfde upload-id, zonder
//     melding. Hooguit COMPRESS_AUTO_RETRIES keer achter elkaar; daarna de
//     gewone melding met "opnieuw proberen" (WP37).
//   - Bleef de app voor, dan is het de gewone mislukking, zoals nu.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38b, 38b-13.

describe("leftForeground: was de app tijdens het verkleinen niet steeds voor?", () => {
  it("alleen active: nee", () => {
    expect(leftForeground(["active"])).toBe(false);
    expect(leftForeground(["active", "active"])).toBe(false);
  });

  it("naar de achtergrond of inactief (ook even), ook als hij nu weer voor is: ja", () => {
    expect(leftForeground(["active", "background", "active"])).toBe(true);
    expect(leftForeground(["active", "inactive", "active"])).toBe(true);
    expect(leftForeground(["background"])).toBe(true);
  });

  it("niets gezien: nee", () => {
    expect(leftForeground([])).toBe(false);
  });
});

describe("afterCompressFailure (besluit 25)", () => {
  it("drie automatische pogingen", () => {
    expect(COMPRESS_AUTO_RETRIES).toBe(3);
  });

  it("app verliet de voorgrond: opnieuw zodra hij weer actief is", () => {
    expect(afterCompressFailure({ leftForeground: true, autoRetries: 0 })).toBe("opnieuw_als_actief");
    expect(afterCompressFailure({ leftForeground: true, autoRetries: COMPRESS_AUTO_RETRIES - 1 })).toBe("opnieuw_als_actief");
  });

  it("na drie automatische pogingen: de gewone melding", () => {
    expect(afterCompressFailure({ leftForeground: true, autoRetries: COMPRESS_AUTO_RETRIES })).toBe("mislukt");
  });

  it("de app bleef voor: de gewone melding, meteen", () => {
    expect(afterCompressFailure({ leftForeground: false, autoRetries: 0 })).toBe("mislukt");
  });

  it("de gewone melding blijft opnieuw te proberen (WP37)", () => {
    expect(videoRetryable("comprimeren")).toBe(true);
  });
});
