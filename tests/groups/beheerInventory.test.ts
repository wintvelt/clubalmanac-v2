/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

// WP28 — standing rule Toegangsdefinities (work-package-specs.md): een
// inventaristest legt de publieke paden vast die een groep-, album-, lid- of
// uitnodiging-id aannemen. Een nieuw pad faalt hier tot iemand deze lijst
// bewust bijwerkt, en in de spec (§Vraag 3) zegt welke gate het heeft.
//
// Gelezen van de geëxporteerde functie-objecten (zoals WP23/WP24):
// publieke mutations en actions waarvan de args een id van zo'n tabel hebben.
// convex/_test.ts valt erbuiten: achter vlag en testgeheim (WP26).
//
// `groups:addMember` staat er niet meer in (A-keuze 1, bevestigd): een account
// in een groep zetten zonder uitnodiging of instemming is geen publiek pad.

type Registered = {
  isMutation?: boolean;
  isAction?: boolean;
  isPublic?: boolean;
  exportArgs?: () => string;
};

const convexModules = import.meta.glob<Record<string, unknown>>(
  ["../../convex/**/*.ts", "!../../convex/_generated/**", "!../../convex/**/*.d.ts"],
  { eager: true },
);

const OUT_OF_SCOPE_MODULES = new Set(["_test"]);

const PROTECTED_TABLES = ["groups", "albums", "memberships", "users", "invites"];

const EXPECTED = [
  "albums:addPhoto",
  "albums:create",
  "albums:markSeen",
  "albums:remove",
  "albums:removePhoto",
  "albums:update",
  "groups:markAllAlbumsSeen",
  "groups:remove",
  "groups:removeMember",
  "groups:transferFounder",
  "groups:update",
  "groups:updateMemberRole",
  // WP19b A-invariant 7 en 9: accepteren en afwijzen gaan op invite-id (was:
  // token); gate = genodigde op adres (tests/invites/acceptDeclineById.test.ts).
  "invites:accept",
  "invites:create",
  "invites:decline",
  "invites:remove",
].sort();

function publicPathsTakingProtectedIds(): string[] {
  const found: string[] = [];
  for (const [path, mod] of Object.entries(convexModules)) {
    const name = path.replace(/^\.\.\/\.\.\/convex\//, "").replace(/\.ts$/, "");
    if (OUT_OF_SCOPE_MODULES.has(name)) continue;
    for (const [exportName, value] of Object.entries(mod)) {
      const fn = value as Registered | null;
      if (!fn || fn.isPublic !== true) continue;
      if (fn.isMutation !== true && fn.isAction !== true) continue;
      const args = fn.exportArgs?.() ?? "";
      if (PROTECTED_TABLES.some((tbl) => args.includes(`"tableName":"${tbl}"`))) {
        found.push(`${name}:${exportName}`);
      }
    }
  }
  return found.sort();
}

describe("WP28 inventaris: publieke paden met een groep-, album-, lid- of uitnodiging-id", () => {
  it("modules zijn gevonden (sanity: de glob werkt)", () => {
    expect(Object.keys(convexModules).length).toBeGreaterThan(5);
  });

  it("de set is precies de lijst uit de spec (§Vraag 3), met oprichter overdragen erbij en addMember eruit", () => {
    expect(publicPathsTakingProtectedIds()).toEqual(EXPECTED);
  });
});
