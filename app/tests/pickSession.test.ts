import { describe, expect, it } from "vitest";
import { PICK_IDLE, beginPick, endPick, fetchStarted, pickView, stopPick } from "../src/lib/pickSession";

// WP39 fixronde gate 1, besluit 3 (F7, F8): "Stoppen" tijdens "Je keuze
// ophalen…", en één kiezer tegelijk.
//   De kiezer antwoordt pas als iOS elk gekozen item naar de app heeft
//   gekopieerd (uit iCloud: eerst downloaden). Dat is niet te stoppen. Stoppen
//   betekent: het scherm wacht niet meer, en een resultaat dat later toch komt,
//   telt niet (het scherm gooit de kopieën weg). Een nieuwe kiezer kan pas als
//   het vorige verzoek echt klaar is; tot dan zegt het scherm waarom.
// F11 (aanvulling, besluit Wouter): een teller m:ss vanaf het moment dat het
//   ophalen begint (de kiezer is dicht; het scherm meldt dat met
//   fetchStarted). Weg bij stoppen of klaar.
// Spec: docs/work-packages/WP39-toevoegscherm.md §Fixronde gate 1 en §Aanvulling.

function started(state = PICK_IDLE) {
  const begun = beginPick(state);
  expect(begun, "beginPick weigerde terwijl er niets liep").not.toBeNull();
  return begun!;
}

describe("vóór een kiezer", () => {
  it("in rust: geen ophalen, geen wachten, een kiezer mag", () => {
    expect(pickView(PICK_IDLE)).toMatchObject({ fetching: false, waiting: false, canPick: true });
  });
});

describe("kiezen zonder stoppen", () => {
  it("tijdens het verzoek: 'Je keuze ophalen…', geen nieuwe kiezer", () => {
    const { state } = started();
    expect(pickView(state)).toMatchObject({ fetching: true, waiting: false, canPick: false });
  });

  it("een tweede kiezer zolang het eerste verzoek loopt: geweigerd", () => {
    const { state } = started();
    expect(beginPick(state)).toBeNull();
  });

  it("het resultaat komt binnen: het telt, en het scherm is weer in rust", () => {
    const { state, token } = started();
    const end = endPick(state, token);
    expect(end.accept).toBe(true);
    expect(pickView(end.state)).toMatchObject({ fetching: false, waiting: false, canPick: true });
  });

  it("daarna kan een nieuwe kiezer, met een eigen token", () => {
    const first = started();
    const after = endPick(first.state, first.token).state;
    const second = started(after);
    expect(second.token).not.toBe(first.token);
  });
});

describe("Stoppen (besluit 3, F7)", () => {
  it("na stoppen: geen 'Je keuze ophalen…' meer, wel de wachtregel, en nog geen nieuwe kiezer (F8)", () => {
    const { state } = started();
    const stopped = stopPick(state);
    expect(pickView(stopped)).toMatchObject({ fetching: false, waiting: true, canPick: false });
    expect(beginPick(stopped)).toBeNull();
  });

  it("een resultaat dat na stoppen toch komt, telt niet", () => {
    const { state, token } = started();
    const end = endPick(stopPick(state), token);
    expect(end.accept).toBe(false);
  });

  it("pas als het gestopte verzoek klaar is, kan een nieuwe kiezer", () => {
    const { state, token } = started();
    const done = endPick(stopPick(state), token).state;
    expect(pickView(done)).toMatchObject({ fetching: false, waiting: false, canPick: true });
    expect(beginPick(done)).not.toBeNull();
  });

  it("twee keer stoppen is hetzelfde als één keer", () => {
    const { state, token } = started();
    const twice = stopPick(stopPick(state));
    expect(pickView(twice)).toEqual(pickView(stopPick(state)));
    expect(endPick(twice, token).accept).toBe(false);
  });

  it("stoppen zonder lopend verzoek verandert niets", () => {
    expect(pickView(stopPick(PICK_IDLE))).toEqual(pickView(PICK_IDLE));
    expect(beginPick(stopPick(PICK_IDLE))).not.toBeNull();
  });
});

describe("een oud antwoord", () => {
  it("een token van een eerder, al afgerond verzoek telt niet en verandert de lopende niet", () => {
    const first = started();
    const idle = endPick(first.state, first.token).state;
    const second = started(idle);
    const stale = endPick(second.state, first.token);
    expect(stale.accept).toBe(false);
    expect(pickView(stale.state)).toMatchObject({ fetching: true, waiting: false, canPick: false });
    expect(endPick(stale.state, second.token).accept).toBe(true);
  });

  it("de functies veranderen de toestand die erin ging niet", () => {
    const { state, token } = started();
    const before = JSON.stringify(state);
    stopPick(state);
    endPick(state, token);
    beginPick(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("de teller bij het ophalen (F11)", () => {
  const T0 = 1_700_000_000_000;

  it("in rust: geen teller", () => {
    expect(pickView(PICK_IDLE, T0).elapsed).toBeNull();
  });

  it("de kiezer staat nog open (ophalen niet begonnen): geen teller", () => {
    const { state } = started();
    expect(pickView(state, T0 + 5_000).elapsed).toBeNull();
  });

  it("vanaf het begin van het ophalen: m:ss, naar beneden afgerond", () => {
    const { state, token } = started();
    const fetching = fetchStarted(state, token, T0);
    expect(pickView(fetching, T0).elapsed).toBe("0:00");
    expect(pickView(fetching, T0 + 999).elapsed).toBe("0:00");
    expect(pickView(fetching, T0 + 42_000).elapsed).toBe("0:42");
    expect(pickView(fetching, T0 + 61_900).elapsed).toBe("1:01");
    expect(pickView(fetching, T0 + 600_000).elapsed).toBe("10:00");
  });

  it("de tijd van het kiezen telt niet mee", () => {
    const { state, token } = started();
    // 40 s in de kiezer, dan dicht.
    const fetching = fetchStarted(state, token, T0 + 40_000);
    expect(pickView(fetching, T0 + 43_000).elapsed).toBe("0:03");
  });

  it("een klok die terugloopt: nooit een negatieve tijd", () => {
    const { state, token } = started();
    const fetching = fetchStarted(state, token, T0);
    expect(pickView(fetching, T0 - 5_000).elapsed).toBe("0:00");
  });

  it("weg bij stoppen", () => {
    const { state, token } = started();
    const fetching = fetchStarted(state, token, T0);
    expect(pickView(stopPick(fetching), T0 + 10_000).elapsed).toBeNull();
  });

  it("weg als het ophalen klaar is, en een volgend ophalen begint weer bij 0:00", () => {
    const first = started();
    const done = endPick(fetchStarted(first.state, first.token, T0), first.token).state;
    expect(pickView(done, T0 + 10_000).elapsed).toBeNull();
    const second = started(done);
    expect(pickView(second.state, T0 + 20_000).elapsed).toBeNull();
    const again = fetchStarted(second.state, second.token, T0 + 20_000);
    expect(pickView(again, T0 + 21_000).elapsed).toBe("0:01");
  });

  it("fetchStarted met een oud token of na stoppen verandert niets", () => {
    const first = started();
    const idle = endPick(first.state, first.token).state;
    const second = started(idle);
    expect(pickView(fetchStarted(second.state, first.token, T0), T0 + 5_000).elapsed).toBeNull();
    const stopped = stopPick(second.state);
    expect(pickView(fetchStarted(stopped, second.token, T0), T0 + 5_000)).toMatchObject({
      fetching: false,
      waiting: true,
      elapsed: null,
    });
  });

  it("een tweede fetchStarted voor hetzelfde verzoek zet de teller niet terug", () => {
    const { state, token } = started();
    const once = fetchStarted(state, token, T0);
    const twice = fetchStarted(once, token, T0 + 30_000);
    expect(pickView(twice, T0 + 31_000).elapsed).toBe("0:31");
  });
});
