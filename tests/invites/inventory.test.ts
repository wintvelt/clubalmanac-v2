/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

// WP19b A-invariant 5 en 9 (en de standing rule "Toegangsdefinities" in
// docs/conventions/work-package-specs.md):
// - 5: geen publieke query, mutation of action neemt een token aan of geeft er
//   een terug. `invites.getByToken` bestaat niet meer.
// - 9: de publieke paden die een invite-id aannemen liggen vast: accept,
//   decline, remove. Elk heeft een gate (tests/invites/acceptDeclineById,
//   listForGroup). Het beeldpad /beeld/uitnodiging/<id> staat in
//   tests/images/inviteCover.test.ts.
//
// Gelezen van de geëxporteerde functie-objecten, zoals
// tests/readWhitelist/inventory.test.ts. convex/_test.ts valt erbuiten
// (WP26-gate).

type Registered = {
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  isPublic?: boolean;
  exportArgs?: () => string;
  exportReturns?: () => string;
};

const modules = import.meta.glob<Record<string, unknown>>(
  ["../../convex/**/*.ts", "!../../convex/_generated/**", "!../../convex/**/*.d.ts"],
  { eager: true },
);

function publicFunctions(): Map<string, Registered> {
  const found = new Map<string, Registered>();
  for (const [path, mod] of Object.entries(modules)) {
    const name = path.replace(/^\.\.\/\.\.\/convex\//, "").replace(/\.ts$/, "");
    if (name === "_test") continue;
    for (const [exportName, value] of Object.entries(mod)) {
      const fn = value as Registered | null;
      if (fn && fn.isPublic === true && (fn.isQuery || fn.isMutation || fn.isAction)) {
        found.set(`${name}:${exportName}`, fn);
      }
    }
  }
  return found;
}

describe("A-invariant 5 — geen token op een publiek pad", () => {
  it("de glob vindt de modules (sanity)", () => {
    expect(publicFunctions().size).toBeGreaterThan(20);
  });

  it("geen publieke functie heeft een argument of returnveld 'token'", () => {
    const offenders: string[] = [];
    for (const [name, fn] of publicFunctions()) {
      const args = fn.exportArgs?.() ?? "";
      const returns = fn.exportReturns?.() ?? "";
      if (/"token"\s*:/.test(args)) offenders.push(`${name} (args)`);
      if (/"token"\s*:/.test(returns)) offenders.push(`${name} (returns)`);
    }
    expect(offenders).toEqual([]);
  });

  it("invites.getByToken bestaat niet meer", () => {
    expect(publicFunctions().has("invites:getByToken")).toBe(false);
  });

  it("invites.create, accept en decline declareren een returns-validator (geen stille token-return)", () => {
    const fns = publicFunctions();
    for (const name of ["invites:create", "invites:accept", "invites:decline"]) {
      const raw = fns.get(name)?.exportReturns?.() ?? "null";
      expect(JSON.parse(raw), `${name} heeft geen returns-validator`).not.toBeNull();
    }
  });
});

describe("A-invariant 9 — publieke paden met een invite-id", () => {
  it("precies accept, decline en remove", () => {
    const withInviteId: string[] = [];
    for (const [name, fn] of publicFunctions()) {
      if (/"tableName"\s*:\s*"invites"/.test(fn.exportArgs?.() ?? "")) withInviteId.push(name);
    }
    expect(withInviteId.sort()).toEqual(["invites:accept", "invites:decline", "invites:remove"]);
  });
});
