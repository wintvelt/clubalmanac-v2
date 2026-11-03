import { describe, expect, it } from "vitest";
import { authRetryDue, rememberSinceUp, type Conditions } from "../src/lib/sessionState";
import { clerkRestartDue, startupRetryDue } from "../src/lib/startupState";

// WP15a F22 (R6-1): de poort vergelijkt met wat er gebeurde sinds de app voor
// het laatst actief én online was, niet met de vorige render. Anders mist hij
// een netwerk dat terugkwam terwijl de app "inactive" was (vliegtuigmodus
// uit via het Bedieningspaneel). F18 blijft: een "inactive" zonder
// netwerkwissel geeft geen poging.

const c = (appState: string, online: boolean | null): Conditions => ({ appState, online });

// Zo roept de poort de regels aan: met het geheugen als `before`, de
// allereerste meting overgeslagen (geen lus na herladen), en daarna het
// geheugen bijgewerkt. Telt hoe vaak de regel afgaat.
function drive(seq: Conditions[], rule: (before: Conditions, now: Conditions) => boolean): number {
  let memo = seq[0]!;
  let fired = 0;
  for (const now of seq) {
    if (memo.online !== null && rule(memo, now)) fired++;
    memo = rememberSinceUp(memo, now);
  }
  return fired;
}

const startup = (before: Conditions, now: Conditions) =>
  startupRetryDue({ state: "startupFailed", before, now });
const restart = (loginInProgress: boolean) => (before: Conditions, now: Conditions) =>
  clerkRestartDue({ clerkStatus: "degraded", clerkSignedIn: false, loginInProgress, before, now });
const reconnect = (before: Conditions, now: Conditions) =>
  authRetryDue({ state: "reconnecting", before, now });

describe("rememberSinceUp", () => {
  it("actief en online: het geheugen begint opnieuw", () => {
    for (const memo of [c("active", false), c("background", null), c("inactive", true)])
      expect(rememberSinceUp(memo, c("active", true))).toEqual(c("active", true));
  });

  it("netwerk weg blijft weg, ook als het terugkomt terwijl de app inactive is", () => {
    expect(rememberSinceUp(c("active", false), c("inactive", true)).online).toBe(false);
    expect(rememberSinceUp(c("inactive", false), c("inactive", true)).online).toBe(false);
    expect(rememberSinceUp(c("background", false), c("background", true)).online).toBe(false);
  });

  it("netwerk dat aan bleef, blijft aan", () => {
    expect(rememberSinceUp(c("active", true), c("inactive", true))).toEqual(c("inactive", true));
  });

  it("na een bekende meting wordt online niet meer null: onbekend telt als weg", () => {
    expect(rememberSinceUp(c("active", true), c("active", null)).online).toBe(false);
    expect(rememberSinceUp(c("inactive", false), c("inactive", null)).online).toBe(false);
  });

  it("de allereerste meting neemt het geheugen over", () => {
    expect(rememberSinceUp(c("active", null), c("active", false)).online).toBe(false);
    expect(rememberSinceUp(c("unknown", null), c("inactive", true)).online).toBe(true);
    expect(rememberSinceUp(c("active", null), c("active", null)).online).toBeNull();
  });

  it("background blijft staan tot de app weer actief en online is", () => {
    expect(rememberSinceUp(c("background", true), c("inactive", true)).appState).toBe("background");
    expect(rememberSinceUp(c("inactive", true), c("background", true)).appState).toBe("background");
    expect(rememberSinceUp(c("background", false), c("active", false)).appState).toBe("background");
  });

  it("zonder background volgt appState de laatste meting", () => {
    expect(rememberSinceUp(c("active", false), c("inactive", false)).appState).toBe("inactive");
    expect(rememberSinceUp(c("inactive", false), c("active", false)).appState).toBe("active");
  });
});

describe("startupFailed: wanneer de app herlaadt (F22, F18)", () => {
  it("F22: offline, Bedieningspaneel open, vliegtuigmodus uit, paneel dicht: één keer", () => {
    expect(
      drive([c("active", false), c("inactive", false), c("inactive", true), c("active", true)], startup),
    ).toBe(1);
  });

  it("F18: Bedieningspaneel open en dicht met het netwerk aan: nooit", () => {
    expect(
      drive(
        [c("active", true), c("inactive", true), c("active", true), c("inactive", true), c("active", true)],
        startup,
      ),
    ).toBe(0);
  });

  it("netwerk terug terwijl de app actief is: één keer, ook bij meer renders daarna", () => {
    expect(drive([c("active", false), c("active", true), c("active", true), c("active", true)], startup)).toBe(1);
  });

  it("netwerk kwam en ging weer terwijl het paneel open was: pas als het echt terug is", () => {
    const seq = [c("active", false), c("inactive", true), c("inactive", false), c("active", false)];
    expect(drive(seq, startup)).toBe(0);
    expect(drive([...seq, c("active", true)], startup)).toBe(1);
  });

  it("terug uit de achtergrond via inactive: één keer", () => {
    expect(
      drive([c("active", true), c("background", true), c("inactive", true), c("active", true)], startup),
    ).toBe(1);
  });

  it("een nieuwe start met netwerk: nooit (geen lus na herladen)", () => {
    expect(drive([c("active", null), c("active", true), c("active", true)], startup)).toBe(0);
    expect(drive([c("unknown", null), c("active", null), c("active", true)], startup)).toBe(0);
  });

  it("een nieuwe start offline, daarna netwerk: één keer", () => {
    expect(drive([c("active", null), c("active", false), c("active", true)], startup)).toBe(1);
  });

  it("netwerk weg en terug, dan even onbekend en weer terug: twee keer", () => {
    expect(drive([c("active", false), c("active", true), c("active", null), c("active", true)], startup)).toBe(
      2,
    );
  });
});

describe("degraded en uitgelogd: wanneer Clerk herstart (F22, F14, F17)", () => {
  it("F22: netwerk aan via het Bedieningspaneel: één keer", () => {
    expect(
      drive([c("active", false), c("inactive", false), c("inactive", true), c("active", true)], restart(false)),
    ).toBe(1);
  });

  it("naar Mail en terug met het netwerk aan: nooit", () => {
    expect(
      drive([c("active", true), c("background", true), c("inactive", true), c("active", true)], restart(false)),
    ).toBe(0);
  });

  it("Bedieningspaneel open en dicht met het netwerk aan: nooit", () => {
    expect(drive([c("active", true), c("inactive", true), c("active", true)], restart(false))).toBe(0);
  });

  it("een login loopt: nooit", () => {
    expect(
      drive([c("active", false), c("inactive", false), c("inactive", true), c("active", true)], restart(true)),
    ).toBe(0);
  });
});

describe("reconnecting: wanneer de app een nieuw token vraagt (F22)", () => {
  it("netwerk aan via het Bedieningspaneel: één keer", () => {
    expect(
      drive([c("active", false), c("inactive", false), c("inactive", true), c("active", true)], reconnect),
    ).toBe(1);
  });
});
