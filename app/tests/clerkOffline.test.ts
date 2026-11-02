import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isScanned, listFiles, moduleUses, parse } from "./support/sourceScan";

// WP15a F12, de gekozen route: Clerk laadt offline uit zijn resource-cache.
// Zonder `__experimental_resourceCache` faalt load() van @clerk/clerk-js op
// native bij een netwerkfout (Clerk ziet React Native altijd als online),
// blijft isLoaded false en komt er geen nieuwe poging. Met de cache valt Clerk
// terug op de opgeslagen client en omgeving (status "degraded", wel geladen).
//
// F13: de cache en het client-token komen uit één eigen opslag
// (src/auth/clerkStorage), die bij uitloggen alles wist. De opslag van
// @clerk/expo/resource-cache en @clerk/expo/token-cache kan dat niet.

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP_TSX = join(APP_ROOT, "App.tsx");
const CLERK_STORES = ["@clerk/expo/resource-cache", "@clerk/expo/token-cache"];

const files = listFiles(APP_ROOT).filter(isScanned);
const read = (rel: string) => readFileSync(join(APP_ROOT, rel), "utf8");

// De waarde van een prop op elk <ClerkProvider>.
function providerProps(sf: ts.SourceFile, prop: string): (ts.Expression | null)[] {
  const out: (ts.Expression | null)[] = [];
  const visit = (n: ts.Node) => {
    const opening = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : undefined;
    if (opening && opening.tagName.getText() === "ClerkProvider") {
      let value: ts.Expression | null = null;
      for (const attr of opening.attributes.properties) {
        if (
          ts.isJsxAttribute(attr) &&
          attr.name.getText() === prop &&
          attr.initializer &&
          ts.isJsxExpression(attr.initializer) &&
          attr.initializer.expression
        ) {
          value = attr.initializer.expression;
        }
      }
      out.push(value);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

// Roept dit bestand createClerkStorage aan?
function callsCreateClerkStorage(sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      if (name === "createClerkStorage") found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe("Clerk laadt offline uit de resource-cache (F12)", () => {
  const sf = parse(readFileSync(APP_TSX, "utf8"), "App.tsx");

  it("App.tsx rendert een ClerkProvider", () => {
    expect(providerProps(sf, "__experimental_resourceCache").length).toBeGreaterThan(0);
  });

  it.each(["__experimental_resourceCache", "tokenCache"])("elke ClerkProvider krijgt %s", (prop) => {
    for (const value of providerProps(sf, prop)) expect(value).not.toBeNull();
  });
});

describe("één eigen opslag voor Clerk (F13)", () => {
  it("geen bestand gebruikt de opslag van @clerk/expo/resource-cache of /token-cache", () => {
    const offenders = files.filter((f) =>
      moduleUses(parse(read(f), f)).some((u) => CLERK_STORES.includes(u.module)),
    );
    expect(offenders).toEqual([]);
  });

  it("de app maakt de opslag met createClerkStorage uit src/auth/clerkStorage", () => {
    const makers = files.filter((f) => {
      const sf = parse(read(f), f);
      return (
        moduleUses(sf).some((u) => /(^|\/)clerkStorage$/.test(u.module)) &&
        callsCreateClerkStorage(sf)
      );
    });
    expect(makers.length).toBeGreaterThan(0);
  });
});
