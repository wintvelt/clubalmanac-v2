import { describe, expect, it } from "vitest";
import * as testModule from "../../convex/_test";
import http from "../../convex/http";
import { HTTP_TEST_ROUTES, RECIPES } from "./_recipes";

// WP26 invariant 4: elke functie, ook een nieuwe.
//
// Gelezen van de geëxporteerde functie-objecten (zoals WP23
// tests/readWhitelist/inventory.test.ts): convex-test zelf maakt geen
// onderscheid tussen publiek en intern.
//
//   - Elke publieke export van convex/_test.ts declareert het argument
//     `testSecret` (string). Een nieuwe functie zonder dat argument maakt
//     deze test rood.
//   - Elke publieke export heeft een recept in _recipes.ts, zodat
//     functions.test.ts zijn gate echt beproeft. Een nieuwe functie zonder
//     recept maakt deze test rood: voeg een recept toe, dan pinnen
//     invariant 1–3 hem.
//   - Elke http-route onder /_test staat in HTTP_TEST_ROUTES en wordt in
//     whoami.test.ts beproefd (A-keuze 2).

type Registered = {
  isPublic?: boolean;
  isInternal?: boolean;
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  exportArgs?: () => string;
};

function publicExports(): Map<string, Registered> {
  const found = new Map<string, Registered>();
  for (const [name, value] of Object.entries(testModule)) {
    const fn = value as Registered | null;
    if (fn && fn.isPublic === true) found.set(name, fn);
  }
  return found;
}

type ArgsJson = {
  type: string;
  value?: Record<string, { fieldType: { type: string }; optional: boolean }>;
};

describe("WP26 invariant 4: elke publieke _test-functie heeft de gate", () => {
  it("sanity: _test.ts heeft publieke exports en de lezer herkent ze", () => {
    expect(publicExports().size).toBeGreaterThan(0);
  });

  it("elke publieke export heeft een recept, en elk recept is een publieke export", () => {
    const exported = [...publicExports().keys()].sort();
    const recipes = RECIPES.map((r) => r.name).sort();
    expect(exported, "publieke _test-functie zonder recept in tests/testGate/_recipes.ts").toEqual(
      recipes,
    );
  });

  for (const [name, fn] of publicExports()) {
    it(`_test:${name} declareert het argument testSecret (string, optioneel)`, () => {
      const raw = fn.exportArgs?.() ?? "null";
      const args = JSON.parse(raw) as ArgsJson | null;
      expect(args?.type, `${name}: args moeten een object-validator zijn`).toBe("object");
      const field = args?.value?.testSecret;
      expect(field, `${name}: geen testSecret-argument`).toBeDefined();
      expect(field?.fieldType.type).toBe("string");
      // Optioneel: anders geeft een ontbrekend geheim een andere fout dan een
      // fout geheim (invariant 1, spec §vraag 1).
      expect(field?.optional).toBe(true);
    });
  }

  it("elke http-route onder /_test staat in de gate-tests", () => {
    const testRoutes = http
      .getRoutes()
      .map(([path, method]) => `${method} ${path}`)
      .filter((r) => r.includes(" /_test"))
      .sort();
    expect(testRoutes).toEqual([...HTTP_TEST_ROUTES].sort());
  });
});
