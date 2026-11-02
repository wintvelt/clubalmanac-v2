import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { moduleUses, parse } from "./support/sourceScan";

// WP15a F12, de gekozen route: Clerk laadt offline uit zijn resource-cache.
// Zonder `__experimental_resourceCache` faalt load() van @clerk/clerk-js op
// native bij een netwerkfout (Clerk ziet React Native altijd als online),
// blijft isLoaded false en komt er geen nieuwe poging. Met de cache valt Clerk
// terug op de opgeslagen client en omgeving (status "degraded", wel geladen).

const APP_TSX = fileURLToPath(new URL("../App.tsx", import.meta.url));

// De lokale namen waaronder `resourceCache` uit @clerk/expo/resource-cache is
// geïmporteerd.
function resourceCacheNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (st.moduleSpecifier.text !== "@clerk/expo/resource-cache") continue;
    const nb = st.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        if ((el.propertyName ?? el.name).text === "resourceCache") names.add(el.name.text);
      }
    }
  }
  return names;
}

// De waarde van `__experimental_resourceCache` op elk <ClerkProvider>.
function resourceCacheProps(sf: ts.SourceFile): (ts.Expression | null)[] {
  const out: (ts.Expression | null)[] = [];
  const visit = (n: ts.Node) => {
    const opening = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : undefined;
    if (opening && opening.tagName.getText() === "ClerkProvider") {
      let value: ts.Expression | null = null;
      for (const attr of opening.attributes.properties) {
        if (
          ts.isJsxAttribute(attr) &&
          attr.name.getText() === "__experimental_resourceCache" &&
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

describe("Clerk laadt offline uit de resource-cache (F12)", () => {
  const sf = parse(readFileSync(APP_TSX, "utf8"), "App.tsx");

  it("App.tsx rendert een ClerkProvider", () => {
    expect(resourceCacheProps(sf).length).toBeGreaterThan(0);
  });

  it("App.tsx importeert resourceCache uit @clerk/expo/resource-cache", () => {
    expect(resourceCacheNames(sf).size).toBeGreaterThan(0);
    expect(moduleUses(sf).some((u) => u.module === "@clerk/expo/resource-cache")).toBe(true);
  });

  it("elke ClerkProvider krijgt __experimental_resourceCache={resourceCache}", () => {
    const names = resourceCacheNames(sf);
    for (const value of resourceCacheProps(sf)) {
      expect(value).not.toBeNull();
      expect(value && ts.isIdentifier(value) && names.has(value.text)).toBe(true);
    }
  });
});
