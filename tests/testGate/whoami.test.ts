import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import {
  ENV_FLAG,
  ENV_SECRET,
  FAKE_SECRET,
  OPEN_ENV,
  SECRET_HEADER,
  setDeploymentEnv,
  WRONG_SECRET,
  type DeploymentEnv,
} from "./_recipes";

// WP26 A-keuze 2: `GET /_test/whoami` (convex/http.ts) krijgt dezelfde gate
// als de functies in _test.ts, met het geheim in de header X-Test-Secret.
//
//   - De gate komt vóór de JWT-check: zonder (juist) geheim één antwoord,
//     met of zonder identity, en hetzelfde als vlag uit of geen geheim op
//     de deployment (A-keuze 1). Nooit 200.
//   - Met het juiste geheim blijft het gedrag van WP4: 401 zonder identity,
//     200 met de eigen identity.
//   - Het geheim staat niet in status, body of headers van het antwoord.
//
// Valt A-keuze 2 weg, dan vervalt dit bestand (en HTTP_TEST_ROUTES in
// _recipes.ts wordt weer gewoon de inventaris).

const PATH = "/_test/whoami";
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv[ENV_FLAG] = process.env[ENV_FLAG];
  savedEnv[ENV_SECRET] = process.env[ENV_SECRET];
});

afterEach(() => {
  for (const key of [ENV_FLAG, ENV_SECRET]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

type Answer = { status: number; body: string; headers: string };

async function whoami(
  env: DeploymentEnv,
  secret: string | undefined,
  identity: boolean,
): Promise<Answer> {
  const t = convexTest(schema, modules);
  await registerUser(t, "user_wp26_whoami", "wp26_whoami@x.test", "WP26");
  setDeploymentEnv(env);
  const client = identity ? withUser(t, "user_wp26_whoami", "wp26_whoami@x.test") : t;
  const headers: Record<string, string> = {};
  if (secret !== undefined) headers[SECRET_HEADER] = secret;
  const res = await client.fetch(PATH, { method: "GET", headers });
  const all: string[] = [];
  res.headers.forEach((v, k) => all.push(`${k}: ${v}`));
  return { status: res.status, body: await res.text(), headers: all.join("\n") };
}

function expectNoSecret(a: Answer, label: string) {
  const text = `${a.body}\n${a.headers}`;
  expect(text.includes(FAKE_SECRET), `${label}: geheim van de deployment in het antwoord`).toBe(false);
  expect(text.includes(WRONG_SECRET), `${label}: geheim uit de aanroep in het antwoord`).toBe(false);
}

describe("WP26 A-keuze 2: /_test/whoami achter het geheim", () => {
  it("met het juiste geheim en een identity: 200 met de eigen identity (controle)", async () => {
    const a = await whoami(OPEN_ENV, FAKE_SECRET, true);
    expect(a.status).toBe(200);
    const body = JSON.parse(a.body) as { subject?: string; webmaster?: boolean };
    expect(body.subject).toBe("user_wp26_whoami");
    expect(body.webmaster).toBe(false);
    expectNoSecret(a, "200");
  });

  it("met het juiste geheim, zonder identity: 401 zoals in WP4", async () => {
    const a = await whoami(OPEN_ENV, FAKE_SECRET, false);
    expect(a.status).toBe(401);
  });

  it("zonder geheim, met een identity: geweigerd, nooit 200", async () => {
    const a = await whoami(OPEN_ENV, undefined, true);
    expect(a.status).not.toBe(200);
    expect(a.body).not.toContain("user_wp26_whoami");
  });

  it("de gate komt vóór de login: zonder geheim hetzelfde antwoord met en zonder identity", async () => {
    const reference = await whoami(OPEN_ENV, undefined, true);
    expect(reference.status).not.toBe(200);
    const anon = await whoami(OPEN_ENV, undefined, false);
    expect({ status: anon.status, body: anon.body }).toEqual({
      status: reference.status,
      body: reference.body,
    });
  });

  it("één weigering: fout geheim, varianten, vlag uit, geen geheim op de deployment", async () => {
    const reference = await whoami(OPEN_ENV, undefined, true);
    expect(reference.status).not.toBe(200);
    expectNoSecret(reference, "referentie");
    const cases: Array<[string, DeploymentEnv, string | undefined, boolean]> = [
      ["fout geheim, identity", OPEN_ENV, WRONG_SECRET, true],
      ["fout geheim, anoniem", OPEN_ENV, WRONG_SECRET, false],
      ["leeg geheim", OPEN_ENV, "", true],
      ["een teken minder", OPEN_ENV, FAKE_SECRET.slice(0, -1), true],
      ["een teken meer", OPEN_ENV, `${FAKE_SECRET}x`, true],
      ["hoofdletters", OPEN_ENV, FAKE_SECRET.toUpperCase(), true],
      ["vlag uit, juist geheim", { secret: FAKE_SECRET }, FAKE_SECRET, true],
      ["geen geheim op de deployment, geen header", { flag: "true" }, undefined, true],
      ["geen geheim op de deployment, lege header", { flag: "true" }, "", true],
      ["leeg aan beide kanten", { flag: "true", secret: "" }, "", true],
      ["niets gezet", {}, undefined, true],
    ];
    for (const [label, env, secret, identity] of cases) {
      const a = await whoami(env, secret, identity);
      expect({ status: a.status, body: a.body }, label).toEqual({
        status: reference.status,
        body: reference.body,
      });
      expectNoSecret(a, label);
    }
  });

  it("de weigering noemt geen env-var", async () => {
    const a = await whoami({ secret: FAKE_SECRET }, FAKE_SECRET, true);
    expect(a.status).not.toBe(200);
    expect(a.body).not.toContain(ENV_FLAG);
    expect(a.body).not.toContain(ENV_SECRET);
  });
});
