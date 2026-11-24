// WP41 §A8: de vergelijking in constante tijd, gedeeld door de gate van de
// test-only functies (WP26, lib/testGate.ts) en de gate van de routes van het
// clubboek (convex/settlements.ts). Eén definitie in convex/.

/**
 * Vergelijkt zonder vroeg te stoppen: de duur hangt alleen af van de lengte
 * van `provided`, niet van waar het eerste verschil zit. Een begin of een
 * verlenging is niet gelijk (het lengteverschil telt mee).
 */
export function constantTimeEqual(provided: string, expected: string): boolean {
  let diff = provided.length ^ expected.length;
  for (let i = 0; i < provided.length; i++) {
    // Voorbij het einde van `expected` geeft charCodeAt NaN; `| 0` maakt dat 0.
    diff |= provided.charCodeAt(i) ^ (expected.charCodeAt(i) | 0);
  }
  return diff === 0;
}
