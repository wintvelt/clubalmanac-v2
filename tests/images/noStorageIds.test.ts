/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

// WP17a invariant 10 (spec §Aanvullende invarianten, §Inventaris beeld-paden).
//
// Geen publieke query geeft nog een `_storage`-id terug. De client vraagt een
// beeld op met een foto-id of een user-id, en het beeldpad checkt de toegang.
// Een `storageId` in een response zou een tweede sleutel tot het beeld zijn,
// ook anoniem (de invite-landing gaf het profielbeeld-id van de afzender).
//
// Gelezen van de return-validators, zoals de WP23-inventaris
// (tests/readWhitelist/inventory.test.ts): een nieuwe publieke query met een
// beeld-id faalt hier, ook als niemand er een test voor schreef.

type Registered = {
  isQuery?: boolean;
  isPublic?: boolean;
  exportReturns?: () => string;
};

const modules = import.meta.glob<Record<string, unknown>>(
  ["../../convex/**/*.ts", "!../../convex/_generated/**", "!../../convex/**/*.d.ts"],
  { eager: true },
);

// Gegated op INTEGRATION_TEST_ENABLED (alleen dev), zoals in WP23.
const OUT_OF_SCOPE_MODULES = new Set(["_test"]);

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

describe("WP17a invariant 10 — geen beeld-id in een publieke response", () => {
  it("sanity: de inventaris vindt publieke queries, en ziet een _storage-id waar het in de validator staat", () => {
    const pub = publicQueries();
    expect(pub.size).toBeGreaterThan(10);
    // Het patroon zelf: een validator met v.id("_storage") serialiseert zo.
    expect(JSON.stringify({ type: "id", tableName: "_storage" })).toMatch(
      /"tableName":\s*"_storage"/,
    );
  });

  it("geen enkele publieke query heeft een _storage-id in zijn return-validator", () => {
    const offenders: string[] = [];
    for (const [name, fn] of publicQueries()) {
      const raw = fn.exportReturns?.() ?? "";
      if (/"tableName":\s*"_storage"/.test(raw)) offenders.push(name);
    }
    expect(offenders.sort()).toEqual([]);
  });
});
