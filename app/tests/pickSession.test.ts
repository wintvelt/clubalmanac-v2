import { describe, expect, it } from "vitest";
import { PICK_IDLE, beginPick, endPick, pickView, stopPick } from "../src/lib/pickSession";

// WP39 fixronde gate 1, besluit 3 (F7, F8): "Stoppen" tijdens "Je keuze
// ophalen…", en één kiezer tegelijk.
//   De kiezer antwoordt pas als iOS elk gekozen item naar de app heeft
//   gekopieerd (uit iCloud: eerst downloaden). Dat is niet te stoppen. Stoppen
//   betekent: het scherm wacht niet meer, en een resultaat dat later toch komt,
//   telt niet (het scherm gooit de kopieën weg). Een nieuwe kiezer kan pas als
//   het vorige verzoek echt klaar is; tot dan zegt het scherm waarom.
// Spec: docs/work-packages/WP39-toevoegscherm.md §Fixronde gate 1.

function started(state = PICK_IDLE) {
  const begun = beginPick(state);
  expect(begun, "beginPick weigerde terwijl er niets liep").not.toBeNull();
  return begun!;
}

describe("vóór een kiezer", () => {
  it("in rust: geen ophalen, geen wachten, een kiezer mag", () => {
    expect(pickView(PICK_IDLE)).toEqual({ fetching: false, waiting: false, canPick: true });
  });
});

describe("kiezen zonder stoppen", () => {
  it("tijdens het verzoek: 'Je keuze ophalen…', geen nieuwe kiezer", () => {
    const { state } = started();
    expect(pickView(state)).toEqual({ fetching: true, waiting: false, canPick: false });
  });

  it("een tweede kiezer zolang het eerste verzoek loopt: geweigerd", () => {
    const { state } = started();
    expect(beginPick(state)).toBeNull();
  });

  it("het resultaat komt binnen: het telt, en het scherm is weer in rust", () => {
    const { state, token } = started();
    const end = endPick(state, token);
    expect(end.accept).toBe(true);
    expect(pickView(end.state)).toEqual({ fetching: false, waiting: false, canPick: true });
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
    expect(pickView(stopped)).toEqual({ fetching: false, waiting: true, canPick: false });
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
    expect(pickView(done)).toEqual({ fetching: false, waiting: false, canPick: true });
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
    expect(pickView(stale.state)).toEqual({ fetching: true, waiting: false, canPick: false });
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
