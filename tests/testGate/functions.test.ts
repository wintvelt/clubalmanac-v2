import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import { modules } from "../_helpers/modules";
import {
  call,
  ENV_FLAG,
  ENV_SECRET,
  FAKE_SECRET,
  OPEN_ENV,
  outcome,
  RECIPES,
  setDeploymentEnv,
  snapshot,
  VALIDATION_ERROR,
  WRONG_SECRET,
  type DeploymentEnv,
  type Outcome,
  type Recipe,
} from "./_recipes";

// WP26 — de _test-functies achter een geheim (spec §Invarianten 1–3,
// A-invarianten 6–8, A-keuze 1).
//
// Per publieke functie in convex/_test.ts (recepten in _recipes.ts):
//   - met vlag, geheim op de deployment en het juiste testSecret: werkt;
//   - zonder of met een fout testSecret: geweigerd, door de gate (niet door
//     argumentvalidatie), en ontbrekend = fout (invariant 1);
//   - vlag uit, of geen geheim op de deployment: geweigerd, ook met een
//     geheim in de aanroep (invariant 2);
//   - het geheim (en de waarde van de aanroeper) staat niet in een
//     weigering, een response of een log (invariant 3, A-invariant 8);
//   - een weigering laat niets achter (A-invariant 6).

const savedEnv: Record<string, string | undefined> = {};
let logs: string[] = [];

beforeEach(() => {
  savedEnv[ENV_FLAG] = process.env[ENV_FLAG];
  savedEnv[ENV_SECRET] = process.env[ENV_SECRET];
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of [ENV_FLAG, ENV_SECRET]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

async function run(
  recipe: Recipe,
  env: DeploymentEnv,
  secret: string | undefined,
): Promise<{ result: Outcome; before: string; after: string }> {
  const t = convexTest(schema, modules);
  // Fixtures aanmaken buiten de gate om (t.run), daarna pas de env zetten.
  const args = await recipe.args(t);
  const before = await snapshot(t);
  setDeploymentEnv(env);
  const result = await outcome(call(t, recipe, args, secret));
  const after = await snapshot(t);
  return { result, before, after };
}

function expectGateRefusal(o: Outcome, label: string): asserts o is Extract<Outcome, { ok: false }> {
  expect(o.ok, `${label}: had geweigerd moeten worden`).toBe(false);
  if (o.ok) return;
  expect(o.message, `${label}: weigering komt van argumentvalidatie, niet van de gate`).not.toMatch(
    VALIDATION_ERROR,
  );
}

function expectNoSecretIn(text: string, label: string): void {
  expect(text.includes(FAKE_SECRET), `${label} bevat het geheim van de deployment`).toBe(false);
  expect(text.includes(WRONG_SECRET), `${label} bevat het geheim uit de aanroep`).toBe(false);
}

for (const recipe of RECIPES) {
  describe(`_test:${recipe.name}`, () => {
    it("met vlag, geheim op de deployment en het juiste testSecret: werkt (controle)", async () => {
      const { result } = await run(recipe, OPEN_ENV, FAKE_SECRET);
      expect(result.ok, result.ok ? "" : result.message).toBe(true);
    });

    describe("invariant 1: zonder geheim geen toegang", () => {
      it("zonder testSecret: geweigerd door de gate", async () => {
        const { result } = await run(recipe, OPEN_ENV, undefined);
        expectGateRefusal(result, "zonder testSecret");
      });

      it("met een fout testSecret: geweigerd door de gate", async () => {
        const { result } = await run(recipe, OPEN_ENV, WRONG_SECRET);
        expectGateRefusal(result, "fout testSecret");
      });

      it("ontbrekend en fout geheim geven hetzelfde antwoord", async () => {
        const missing = (await run(recipe, OPEN_ENV, undefined)).result;
        const wrong = (await run(recipe, OPEN_ENV, WRONG_SECRET)).result;
        expectGateRefusal(missing, "zonder testSecret");
        expectGateRefusal(wrong, "fout testSecret");
        expect(wrong.message).toBe(missing.message);
        expect(JSON.stringify(wrong.data)).toBe(JSON.stringify(missing.data));
      });
    });

    describe("A-invariant 7: alleen het exacte geheim", () => {
      const variants: Array<[string, string]> = [
        ["leeg", ""],
        ["een teken minder", FAKE_SECRET.slice(0, -1)],
        ["een teken meer", `${FAKE_SECRET}x`],
        ["prefix", FAKE_SECRET.slice(0, 8)],
        ["hoofdletters", FAKE_SECRET.toUpperCase()],
        ["witruimte eromheen", ` ${FAKE_SECRET} `],
      ];
      for (const [label, value] of variants) {
        it(`${label}: geweigerd door de gate`, async () => {
          const { result } = await run(recipe, OPEN_ENV, value);
          expectGateRefusal(result, label);
        });
      }
    });

    describe("invariant 2: prod, nooit", () => {
      it("vlag niet gezet, geheim op de deployment, juist testSecret: geweigerd", async () => {
        const { result } = await run(recipe, { secret: FAKE_SECRET }, FAKE_SECRET);
        expectGateRefusal(result, "vlag niet gezet");
      });

      it("vlag niet \"true\", juist testSecret: geweigerd", async () => {
        const { result } = await run(recipe, { flag: "false", secret: FAKE_SECRET }, FAKE_SECRET);
        expectGateRefusal(result, "vlag false");
      });

      it("vlag aan, geen geheim op de deployment, geen testSecret: geweigerd", async () => {
        const { result } = await run(recipe, { flag: "true" }, undefined);
        expectGateRefusal(result, "geen geheim aan beide kanten");
      });

      it("vlag aan, geen geheim op de deployment, leeg testSecret: geweigerd", async () => {
        const { result } = await run(recipe, { flag: "true" }, "");
        expectGateRefusal(result, "geen geheim op deployment, leeg in aanroep");
      });

      it("vlag aan, geen geheim op de deployment, willekeurig testSecret: geweigerd", async () => {
        const { result } = await run(recipe, { flag: "true" }, FAKE_SECRET);
        expectGateRefusal(result, "geen geheim op deployment");
      });

      it("vlag aan, leeg geheim op de deployment, leeg testSecret: geweigerd", async () => {
        const { result } = await run(recipe, { flag: "true", secret: "" }, "");
        expectGateRefusal(result, "leeg aan beide kanten");
      });

      it("niets gezet, geen testSecret: geweigerd", async () => {
        const { result } = await run(recipe, {}, undefined);
        expectGateRefusal(result, "niets gezet");
      });
    });

    describe("invariant 3 en A-invariant 8: het geheim lekt niet", () => {
      it("niet in de weigering (fout geheim, geen geheim, vlag uit)", async () => {
        for (const [env, secret, label] of [
          [OPEN_ENV, WRONG_SECRET, "fout geheim"],
          [OPEN_ENV, undefined, "geen geheim"],
          [{ secret: FAKE_SECRET }, WRONG_SECRET, "vlag uit"],
        ] as const) {
          const { result } = await run(recipe, env, secret);
          expectGateRefusal(result, label);
          expectNoSecretIn(`${result.message} ${JSON.stringify(result.data)}`, `weigering (${label})`);
        }
      });

      it("niet in de response bij een geslaagde aanroep", async () => {
        const { result } = await run(recipe, OPEN_ENV, FAKE_SECRET);
        expect(result.ok, result.ok ? "" : result.message).toBe(true);
        if (result.ok) expectNoSecretIn(JSON.stringify(result.value) ?? "", "response");
      });

      it("niet in een log, geslaagd of geweigerd", async () => {
        await run(recipe, OPEN_ENV, FAKE_SECRET);
        await run(recipe, OPEN_ENV, WRONG_SECRET);
        await run(recipe, { secret: FAKE_SECRET }, WRONG_SECRET);
        expectNoSecretIn(logs.join("\n"), "log");
      });
    });

    describe("A-invariant 6: een weigering laat niets achter", () => {
      for (const [label, env, secret] of [
        ["fout geheim", OPEN_ENV, WRONG_SECRET],
        ["geen geheim", OPEN_ENV, undefined],
        ["vlag uit", { secret: FAKE_SECRET }, FAKE_SECRET],
      ] as const) {
        it(`${label}: geen rij en geen storage-object aangemaakt, gewist of gewijzigd`, async () => {
          const { result, before, after } = await run(recipe, env, secret);
          expectGateRefusal(result, label);
          expect(after).toBe(before);
        });
      }
    });

    describe("A-keuze 1: één weigering voor alles", () => {
      it("vlag uit, geen geheim op de deployment, geen of fout testSecret: hetzelfde antwoord", async () => {
        const reference = (await run(recipe, OPEN_ENV, undefined)).result;
        expectGateRefusal(reference, "referentie (geen testSecret)");
        const cases: Array<[string, DeploymentEnv, string | undefined]> = [
          ["fout geheim", OPEN_ENV, WRONG_SECRET],
          ["vlag uit", { secret: FAKE_SECRET }, FAKE_SECRET],
          ["geen geheim op de deployment", { flag: "true" }, FAKE_SECRET],
          ["niets gezet", {}, undefined],
        ];
        for (const [label, env, secret] of cases) {
          const { result } = await run(recipe, env, secret);
          expectGateRefusal(result, label);
          expect(result.message, label).toBe(reference.message);
          expect(JSON.stringify(result.data), label).toBe(JSON.stringify(reference.data));
        }
      });

      it("de weigering noemt geen env-var", async () => {
        const { result } = await run(recipe, OPEN_ENV, undefined);
        expectGateRefusal(result, "geen testSecret");
        expect(result.message).not.toContain(ENV_FLAG);
        expect(result.message).not.toContain(ENV_SECRET);
      });
    });
  });
}
