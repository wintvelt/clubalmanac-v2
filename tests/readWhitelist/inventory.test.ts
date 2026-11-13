/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

// WP23 — invarianten 7 en 8 (spec §Aanvullende invarianten).
//
// 7: de set publieke queries in convex/ ligt vast. Een nieuwe publieke query
//    faalt hier tot iemand deze lijst bewust bijwerkt (en dus nadenkt over
//    auth + whitelist). convex/_test.ts valt erbuiten: achter vlag en
//    testgeheim (WP26, tests/testGate/), bewust buiten scope.
// 8: elke publieke query declareert een return-validator zonder `any`, zodat
//    Convex een response met een veld buiten de whitelist weigert (een spread
//    of een nieuw schema-veld faalt luid in plaats van stil te lekken).
//
// Gelezen van de geëxporteerde functie-objecten: convex-test maakt zelf geen
// onderscheid tussen publieke en interne functies.

type Registered = {
  isQuery?: boolean;
  isPublic?: boolean;
  exportReturns?: () => string;
};

const modules = import.meta.glob<Record<string, unknown>>(
  ["../../convex/**/*.ts", "!../../convex/_generated/**", "!../../convex/**/*.d.ts"],
  { eager: true },
);

const OUT_OF_SCOPE_MODULES = new Set(["_test"]);

const EXPECTED_PUBLIC_QUERIES = [
  "albums:getById",
  "albums:getWithCover",
  "albums:getWithGroup",
  "albums:listByGroup",
  "albums:listByGroupWithUnread",
  // WP17c A-invariant 9: "in welke albums" in het foto-detail.
  "albums:listForPhoto",
  // WP17d A-invariant 1: de kaart van een album (A-keuze 1: afgerond voor anderen).
  "albums:listLocations",
  "albums:listPhotos",
  "features:getById",
  "features:hasUpvoted",
  "features:list",
  "groups:getById",
  "groups:getWithCover",
  "groups:listMembers",
  "groups:listMine",
  // WP19b: getByToken weg (A-invariant 5); ontvangen uitnodigingen
  // (A-invariant 6) en de open uitnodigingen van een groep (A-invariant 12).
  "invites:listForGroup",
  "invites:listMine",
  "invites:listReceived",
  "photos:getById",
  // WP17d A-invariant 2: de exacte plek van een eigen foto, alleen de eigenaar.
  "photos:getLocation",
  "photos:getWithOwner",
  "photos:listAllFlagged",
  "photos:listByOwner",
  // WP17c invariant 1, 2: Mijn foto's, bladerend.
  "photos:listMine",
  "photos:listMyFlagged",
  // WP19a: ratings:listForPhoto is weg (ratings geschrapt).
  "smoke:ping",
  "users:current",
  "users:getById",
  // WP15b: eigen live query voor Profiel (invariant 7), vorm ownProfile.
  "users:profile",
  // WP19b A-invariant 3: waarom er (nog) geen account is.
  "users:signupState",
].sort();

function publicQueries(): Map<string, Registered> {
  const found = new Map<string, Registered>();
  for (const [path, mod] of Object.entries(modules)) {
    const name = path.replace(/^\.\.\/\.\.\/convex\//, "").replace(/\.ts$/, "");
    if (OUT_OF_SCOPE_MODULES.has(name)) continue;
    for (const [exportName, value] of Object.entries(mod)) {
      const fn = value as Registered | null;
      if (fn && fn.isQuery === true && fn.isPublic === true) {
        found.set(`${name}:${exportName}`, fn);
      }
    }
  }
  return found;
}

describe("WP23 inventaris publieke queries (invariant 7)", () => {
  it("modules zijn gevonden (sanity: de glob werkt)", () => {
    expect(Object.keys(modules).length).toBeGreaterThan(5);
  });

  it("de set publieke queries is precies de lijst uit de spec", () => {
    expect([...publicQueries().keys()].sort()).toEqual(EXPECTED_PUBLIC_QUERIES);
  });

  it("[A-keuze 7] invites.listPendingForEmail en hasPendingForEmail zijn geen publieke query", () => {
    const pub = publicQueries();
    expect(pub.has("invites:listPendingForEmail")).toBe(false);
    expect(pub.has("invites:hasPendingForEmail")).toBe(false);
  });
});

describe("WP23 return-validator per publieke query (invariant 8, A-keuze 11)", () => {
  for (const name of EXPECTED_PUBLIC_QUERIES) {
    it(`${name} declareert een return-validator zonder any of record`, () => {
      const fn = publicQueries().get(name);
      expect(fn, `${name} is geen publieke query`).toBeDefined();
      const raw = fn!.exportReturns?.() ?? "null";
      const returns: unknown = JSON.parse(raw);
      expect(returns, `${name} heeft geen returns-validator`).not.toBeNull();
      expect(raw, `${name} gebruikt v.any() in returns`).not.toMatch(
        /"type":\s*"any"/,
      );
      // Audit-ronde 1: geen open-key-validators. Een v.record laat elke key
      // door en ondergraaft de whitelist net zo goed als v.any.
      expect(raw, `${name} gebruikt v.record() in returns`).not.toMatch(
        /"type":\s*"record"/,
      );
    });
  }
});
