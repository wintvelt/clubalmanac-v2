import { ConvexError, v } from "convex/values";

// WP26: de gate voor test-only functies (convex/_test.ts en `/_test/*` in
// convex/http.ts).
//
// Open alleen als op de deployment `INTEGRATION_TEST_ENABLED === "true"` én
// `INTEGRATION_TEST_SECRET` niet leeg is, en de aanroeper exact dat geheim
// meestuurt (argument `testSecret`, of header `X-Test-Secret`). Op prod staan
// beide env-vars niet, dus daar is de gate altijd dicht.
//
// Eén weigering voor elke oorzaak (vlag uit, geen geheim op de deployment,
// geen of fout geheim in de aanroep), zonder de naam of stand van een
// env-var. Het geheim (beide waarden) komt nooit in een foutmelding, een
// response of een log.

export const TEST_SECRET_HEADER = "X-Test-Secret";

/** Spread in de args van elke publieke test-only functie. */
export const testSecretArg = { testSecret: v.optional(v.string()) };

const REFUSAL = "Forbidden";

/**
 * Vergelijkt zonder vroeg te stoppen: de duur hangt alleen af van de lengte
 * van `provided`, niet van waar het eerste verschil zit.
 */
function constantTimeEqual(provided: string, expected: string): boolean {
  let diff = provided.length ^ expected.length;
  for (let i = 0; i < provided.length; i++) {
    // Voorbij het einde van `expected` geeft charCodeAt NaN; `| 0` maakt dat 0.
    diff |= provided.charCodeAt(i) ^ (expected.charCodeAt(i) | 0);
  }
  return diff === 0;
}

export function testGateOpen(provided: string | null | undefined): boolean {
  const flagOn = process.env.INTEGRATION_TEST_ENABLED === "true";
  const expected = process.env.INTEGRATION_TEST_SECRET ?? "";
  const given = provided ?? "";
  const equal = constantTimeEqual(given, expected);
  return flagOn && expected.length > 0 && given.length > 0 && equal;
}

/** Gooit de ene weigering als de gate dicht is. Eerste regel van elke handler. */
export function assertTestGate(provided: string | null | undefined): void {
  if (!testGateOpen(provided)) throw new ConvexError(REFUSAL);
}

/** Vlag-check voor interne test-functies (geen geheim: niet van buiten aan te roepen). */
export function assertTestFlag(): void {
  if (process.env.INTEGRATION_TEST_ENABLED !== "true") {
    throw new ConvexError(REFUSAL);
  }
}

/** De weigering van `/_test/*`-routes: hetzelfde antwoord voor elke oorzaak. */
export function testGateRefusalResponse(): Response {
  return Response.json({ error: REFUSAL }, { status: 403 });
}
