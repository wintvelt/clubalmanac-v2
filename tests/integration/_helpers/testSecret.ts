import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { makeConvexClient } from "./convexClient";

// WP26 — het testgeheim voor de test-only functies op de dev-deployment.
//
// De functies in convex/_test.ts nemen een argument `testSecret`; de route
// `GET /_test/whoami` de header `X-Test-Secret`. De waarde staat op de
// dev-deployment als env-var INTEGRATION_TEST_SECRET en lokaal in
// `.env.integration` (gitignored) onder dezelfde naam. Nooit in de repo.
//
// Ontbreekt hij, dan faalt de test luid (geen skip): een gate-run zonder
// geheim mag niet groen lijken.
//
// Let op: draai deze tests pas als de WP26-code op dev staat. Daarvoor kent
// de deployment `testSecret` niet, en Convex' validatiefout kan de waarde
// van de argumenten tonen (spec WP26 kernvondst 4).

export const TEST_SECRET_HEADER = "X-Test-Secret";

export function integrationTestSecret(): string {
  const value = process.env.INTEGRATION_TEST_SECRET;
  if (!value || value.length === 0) {
    throw new Error(
      "INTEGRATION_TEST_SECRET ontbreekt. Zet 'm in .env.integration (zie .env.integration.example); " +
        "dezelfde waarde staat op de dev-deployment.",
    );
  }
  return value;
}

export type TestFunctionsClient = {
  query<F extends FunctionReference<"query">>(
    fn: F,
    args: FunctionArgs<F>,
  ): Promise<FunctionReturnType<F>>;
  mutation<F extends FunctionReference<"mutation">>(
    fn: F,
    args: FunctionArgs<F>,
  ): Promise<FunctionReturnType<F>>;
  action<F extends FunctionReference<"action">>(
    fn: F,
    args: FunctionArgs<F>,
  ): Promise<FunctionReturnType<F>>;
};

/**
 * ConvexHttpClient voor de functies in convex/_test.ts: stuurt bij elke
 * aanroep het geheim mee als `testSecret`. Zelfde prod-guard als
 * makeConvexClient.
 */
export function makeTestFunctionsClient(): TestFunctionsClient {
  const client = makeConvexClient();
  const withSecret = (args: object) => ({ ...args, testSecret: integrationTestSecret() });
  return {
    query: (fn, args) => client.query(fn, withSecret(args) as never),
    mutation: (fn, args) => client.mutation(fn, withSecret(args) as never),
    action: (fn, args) => client.action(fn, withSecret(args) as never),
  };
}
