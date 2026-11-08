import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import { ConvexError } from "convex/values";
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

type Kind = "query" | "mutation" | "action";

/** Wat de helper van een ConvexHttpClient gebruikt (los te vervangen in unit-tests). */
export type Transport = Record<
  Kind,
  (fn: FunctionReference<Kind>, args: Record<string, unknown>) => Promise<unknown>
>;

/** Nep-waarde voor de proef-aanroep; nooit het echte geheim. */
export const PROBE_SECRET = "wp26-proef-nep-geheim-niet-echt";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Het echte geheim gaat alleen mee als vaststaat dat Convex de argumenten
// accepteert. Anders zet Convex' validatiefout alle argumenten in de
// melding, ook het geheim (spec WP26 kernvondst 4, red-team):
//   1. alleen naar een functie in convex/_test.ts; een andere functie kent
//      `testSecret` niet. Faalt vóór er iets verstuurd wordt.
//   2. eerst dezelfde aanroep met een nep-geheim. De gate weigert die met
//      een ConvexError, vóór elk effect. Komt er iets anders terug (een
//      validatiefout, of een antwoord), dan stopt de helper.
async function callWithSecret(
  transport: Transport,
  kind: Kind,
  fn: FunctionReference<Kind>,
  args: object,
): Promise<unknown> {
  const name = getFunctionName(fn);
  if (!name.startsWith("_test:")) {
    throw new Error(
      `makeTestFunctionsClient stuurt het testgeheim alleen naar _test-functies, niet naar ${name}. ` +
        "Gebruik makeConvexClient voor andere functies. Er is niets verstuurd.",
    );
  }
  const secret = integrationTestSecret();
  if (secret === PROBE_SECRET) {
    throw new Error("INTEGRATION_TEST_SECRET is de proefwaarde van de helper. Kies een echt geheim.");
  }

  let probe: { ok: true } | { ok: false; err: unknown };
  try {
    await transport[kind](fn, { ...args, testSecret: PROBE_SECRET });
    probe = { ok: true };
  } catch (err) {
    probe = { ok: false, err };
  }
  if (probe.ok) {
    throw new Error(
      `${name} nam een nep-geheim aan: de gate staat open. Het echte geheim is niet verstuurd.`,
    );
  }
  if (!(probe.err instanceof ConvexError)) {
    throw new Error(
      `${name} weigerde de proef niet via de gate. Het echte geheim is niet verstuurd. ` +
        `Antwoord op de proef: ${messageOf(probe.err)}`,
    );
  }
  return await transport[kind](fn, { ...args, testSecret: secret });
}

/** De drie aanroepen van een ConvexHttpClient, als Transport. */
export function convexTransport(): Transport {
  const client = makeConvexClient();
  return {
    query: (fn, args) => client.query(fn as never, args as never),
    mutation: (fn, args) => client.mutation(fn as never, args as never),
    action: (fn, args) => client.action(fn as never, args as never),
  };
}

/**
 * Client voor de functies in convex/_test.ts: stuurt het geheim mee als
 * `testSecret`, alleen naar `_test:`-functies en pas na een geslaagde proef
 * (zie callWithSecret). Zelfde prod-guard als makeConvexClient.
 */
export function makeTestFunctionsClient(
  transport: Transport = convexTransport(),
): TestFunctionsClient {
  return {
    query: (fn, args) => callWithSecret(transport, "query", fn, args) as never,
    mutation: (fn, args) => callWithSecret(transport, "mutation", fn, args) as never,
    action: (fn, args) => callWithSecret(transport, "action", fn, args) as never,
  };
}
