import type { SessionState } from "./sessionState";

// WP15b invarianten 5 en 12, A-punt 2: roept de app nu users.recordVisit aan?
// Een bezoek is de overgang naar "actief en ingelogd" (AppState `active` en
// toestand `ready`), ook bij een koude start en na inloggen. De client slaat
// een aanroep over als zijn laatste poging voor deze user minder dan een
// periode geleden is. Een mislukte poging telt ook, zo ontstaat er geen lus.
// De backend throttlet zelf ook; dit bespaart alleen aanroepen.

/** Zelfde periode als de backend (convex/lib/constants.ts). */
export const VISIT_PERIOD_MS = 3_600_000;

type Moment = { appState: string; authState: SessionState };

const isLive = (m: Moment) => m.appState === "active" && m.authState === "ready";

export function shouldRecordVisit(input: {
  previous: Moment;
  current: Moment;
  userId: string | null;
  now: number;
  lastAttempt: { userId: string; at: number } | null;
}): boolean {
  const { previous, current, userId, now, lastAttempt } = input;
  if (userId === null || !isLive(current) || isLive(previous)) return false;
  // Een poging voor een andere user telt niet (invariant 12). Een poging in
  // de toekomst (klok van het toestel verzet) telt als lang geleden.
  if (lastAttempt === null || lastAttempt.userId !== userId) return true;
  const since = now - lastAttempt.at;
  return since < 0 || since >= VISIT_PERIOD_MS;
}
