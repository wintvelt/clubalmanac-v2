// WP39 fixronde gate 1, besluit 3 (F7, F8) en F11: het verzoek aan de kiezer,
// als pure toestand. Geen React, geen native modules.
//
// De kiezer antwoordt pas als iOS elk gekozen item naar de app heeft
// gekopieerd, en dat is niet te stoppen. "Stoppen" betekent: het scherm wacht
// niet meer, en een resultaat dat later toch komt, telt niet. Gate ronde 2
// (F8): na stoppen kan meteen een nieuwe kiezer; een gestopt verzoek blokkeert
// niets, ook niet als zijn resultaat later binnenkomt naast een nieuwer
// verzoek. "Eén kiezer tegelijk" geldt alleen voor het verzoek waar het scherm
// nog op wacht. De teller loopt vanaf
// het moment dat het scherm meldt dat het ophalen begon (de kiezer is dicht,
// besluit 10).

type Request = {
  token: number;
  /** Wanneer het ophalen begon (ms), of null zolang de kiezer nog open is. */
  fetchStartedAt: number | null;
};

export type PickSession = {
  readonly lastToken: number;
  /** Het verzoek waar het scherm op wacht; een gestopt verzoek staat hier niet meer. */
  readonly current: Readonly<Request> | null;
};

export const PICK_IDLE: PickSession = { lastToken: 0, current: null };

export type PickView = {
  /** "Je keuze ophalen…" met "Stoppen". */
  fetching: boolean;
  /** Gate ronde 2: geen wachtregel meer na stoppen. */
  waiting?: never;
  /** Een kiezer mag openen. */
  canPick: boolean;
  /** De teller als m:ss, of null. */
  elapsed: string | null;
};

/** Een nieuw verzoek, of null zolang het scherm nog op een verzoek wacht. */
export function beginPick(state: PickSession): { state: PickSession; token: number } | null {
  if (state.current !== null) return null;
  const token = state.lastToken + 1;
  return { state: { lastToken: token, current: { token, fetchStartedAt: null } }, token };
}

/** "Stoppen": het scherm wacht niet meer op dit verzoek; zijn antwoord telt niet meer. */
export function stopPick(state: PickSession): PickSession {
  if (state.current === null) return state;
  return { ...state, current: null };
}

/** De kiezer is dicht: het ophalen van dit verzoek begon op `now`. */
export function fetchStarted(state: PickSession, token: number, now: number): PickSession {
  const c = state.current;
  if (c === null || c.token !== token || c.fetchStartedAt !== null) return state;
  return { ...state, current: { ...c, fetchStartedAt: now } };
}

/**
 * Het verzoek met dit token is klaar (resultaat of weigering). `accept`: het
 * resultaat telt. Een gestopt of oud verzoek telt niet en laat het lopende
 * verzoek staan.
 */
export function endPick(state: PickSession, token: number): { state: PickSession; accept: boolean } {
  const c = state.current;
  if (c === null || c.token !== token) return { state, accept: false };
  return { state: { ...state, current: null }, accept: true };
}

function clock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function pickView(state: PickSession, now?: number): PickView {
  const c = state.current;
  return {
    fetching: c !== null,
    canPick: c === null,
    elapsed: c !== null && c.fetchStartedAt !== null && now !== undefined ? clock(now - c.fetchStartedAt) : null,
  };
}
