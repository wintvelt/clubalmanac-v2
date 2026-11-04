// WP16 invariant 12 en fix-cyclus 1 (S1): Home kiest één keer per sessie.
// De keuze leeft buiten Mijn groepen, want dat scherm mount opnieuw na
// "reconnecting" (Screen toont dan een eigen toestand) en na "Opnieuw" in de
// foutgrens. Zonder dit geheugen sprong Home daarna alsnog naar de laatst
// bezochte groep.
//
// De sleutel is de Clerk-sessie, net als de poort (App.tsx mount de
// Convex-provider opnieuw per `sessionId`). Na uitloggen en inloggen, ook als
// een andere user, is er een nieuwe sessie en dus een nieuwe keuze. Een koude
// start begint met een leeg geheugen: ook dan kiest Home opnieuw.

export type HomeDecisionStore = {
  isDecided(sessionKey: string | null): boolean;
  markDecided(sessionKey: string | null): void;
};

export function createHomeDecisionStore(): HomeDecisionStore {
  // Eén sessie tegelijk: een nieuwe sessie vervangt de vorige.
  let decidedFor: string | null = null;
  return {
    isDecided: (sessionKey) => sessionKey !== null && decidedFor === sessionKey,
    markDecided: (sessionKey) => {
      if (sessionKey !== null) decidedFor = sessionKey;
    },
  };
}

// Zonder user of sessie is er niets te kiezen: de sleutel is dan null.
export function homeSessionKey(userId: string | null | undefined, sessionId: string | null | undefined): string | null {
  return userId && sessionId ? `${userId}:${sessionId}` : null;
}

// Het geheugen van deze app-start.
export const homeDecisions = createHomeDecisionStore();
