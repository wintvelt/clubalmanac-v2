import {
  getFunctionName,
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  makeTestFunctionsClient,
  PROBE_SECRET,
  type Transport,
} from "../integration/_helpers/testSecret";

// WP26 red-team: de helper van de integratietests mag het echte geheim alleen
// versturen als Convex de argumenten accepteert. Anders zet Convex'
// validatiefout alle argumenten, ook het geheim, in de melding en de dev-logs.
//
//   - Een functie buiten convex/_test.ts: falen vóór er iets verstuurd wordt.
//   - Een _test-functie: eerst een proef met een nep-geheim. Alleen een
//     gate-weigering (ConvexError) laat het echte geheim door. Een
//     validatiefout of een antwoord op de proef: stoppen.
//
// Zonder netwerk: de helper krijgt een nep-transport dat elke aanroep
// opschrijft.

const REAL = "wp26-unit-nep-echt-geheim-abcdef0123456789";
const saved = process.env.INTEGRATION_TEST_SECRET;

beforeEach(() => {
  process.env.INTEGRATION_TEST_SECRET = REAL;
});
afterEach(() => {
  if (saved === undefined) delete process.env.INTEGRATION_TEST_SECRET;
  else process.env.INTEGRATION_TEST_SECRET = saved;
});

type Sent = { kind: string; name: string; args: Record<string, unknown> };

/** Nep-transport: antwoordt op de proef (nep-geheim) met `onProbe`, anders met "ok". */
function fakeTransport(onProbe: () => Promise<unknown>) {
  const sent: Sent[] = [];
  const make =
    (kind: string) =>
    async (fn: FunctionReference<"query" | "mutation" | "action">, args: Record<string, unknown>) => {
      sent.push({ kind, name: getFunctionName(fn), args });
      if (args.testSecret === PROBE_SECRET) return await onProbe();
      return "ok";
    };
  const transport: Transport = {
    query: make("query"),
    mutation: make("mutation"),
    action: make("action"),
  };
  return { transport, sent };
}

const gateRefusal = () => Promise.reject(new ConvexError("Forbidden"));
const validationError = () =>
  Promise.reject(
    new Error(
      `[Request ID: 0] Server Error\nArgumentValidationError: Object contains extra field \`bogus\`. Object: {testSecret: "${PROBE_SECRET}"}`,
    ),
  );

const TEST_QUERY = makeFunctionReference<"query", { subject: string }, unknown>(
  "_test:getUserBySubject",
);
const TEST_MUTATION = makeFunctionReference<"mutation", { subject: string }, unknown>(
  "_test:cleanupUserBySubject",
);
const PROD_QUERY = makeFunctionReference<"query", { subject: string }, unknown>("users:current");
const PROD_MUTATION = makeFunctionReference<"mutation", Record<string, never>, unknown>(
  "users:recordVisit",
);

function realSecretSent(sent: Sent[]): boolean {
  return sent.some((s) => JSON.stringify(s.args).includes(REAL));
}

describe("WP26 testhelper: het geheim gaat alleen naar _test-functies", () => {
  it("een productiefunctie: geweigerd vóór er iets verstuurd wordt", async () => {
    const { transport, sent } = fakeTransport(gateRefusal);
    const client = makeTestFunctionsClient(transport);
    await expect(client.query(PROD_QUERY, { subject: "x" })).rejects.toThrow(/_test/);
    await expect(client.mutation(PROD_MUTATION, {})).rejects.toThrow(/_test/);
    expect(sent).toEqual([]);
  });

  it("de melding bevat het geheim niet", async () => {
    const { transport } = fakeTransport(gateRefusal);
    const err = await makeTestFunctionsClient(transport)
      .query(PROD_QUERY, { subject: "x" })
      .catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(REAL);
  });

  it("een naam die alleen op _test lijkt (geen module _test): geweigerd", async () => {
    const { transport, sent } = fakeTransport(gateRefusal);
    const lookalike = makeFunctionReference<"query", Record<string, never>, unknown>(
      "users:_testHelper",
    );
    await expect(makeTestFunctionsClient(transport).query(lookalike, {})).rejects.toThrow();
    expect(sent).toEqual([]);
  });
});

describe("WP26 testhelper: proef met een nep-geheim", () => {
  it("de gate weigert de proef: daarna één aanroep met het echte geheim", async () => {
    const { transport, sent } = fakeTransport(gateRefusal);
    const result = await makeTestFunctionsClient(transport).query(TEST_QUERY, { subject: "x" });
    expect(result).toBe("ok");
    expect(sent.map((s) => s.args.testSecret)).toEqual([PROBE_SECRET, REAL]);
    expect(sent.every((s) => s.name === "_test:getUserBySubject" && s.args.subject === "x")).toBe(
      true,
    );
  });

  it("ook voor een mutation", async () => {
    const { transport, sent } = fakeTransport(gateRefusal);
    await makeTestFunctionsClient(transport).mutation(TEST_MUTATION, { subject: "x" });
    expect(sent.map((s) => s.kind)).toEqual(["mutation", "mutation"]);
    expect(sent.map((s) => s.args.testSecret)).toEqual([PROBE_SECRET, REAL]);
  });

  it("een validatiefout op de proef: stoppen, het echte geheim gaat niet mee", async () => {
    const { transport, sent } = fakeTransport(validationError);
    await expect(
      makeTestFunctionsClient(transport).query(TEST_QUERY, { subject: "x" }),
    ).rejects.toThrow(/niet verstuurd/);
    expect(sent).toHaveLength(1);
    expect(realSecretSent(sent)).toBe(false);
  });

  it("de proef slaagt (gate open met een nep-geheim): stoppen, het echte geheim gaat niet mee", async () => {
    const { transport, sent } = fakeTransport(async () => "open");
    await expect(
      makeTestFunctionsClient(transport).query(TEST_QUERY, { subject: "x" }),
    ).rejects.toThrow(/niet verstuurd/);
    expect(realSecretSent(sent)).toBe(false);
  });

  it("zonder INTEGRATION_TEST_SECRET: luid falen, niets verstuurd", async () => {
    delete process.env.INTEGRATION_TEST_SECRET;
    const { transport, sent } = fakeTransport(gateRefusal);
    await expect(
      makeTestFunctionsClient(transport).query(TEST_QUERY, { subject: "x" }),
    ).rejects.toThrow(/INTEGRATION_TEST_SECRET/);
    expect(sent).toEqual([]);
  });
});
