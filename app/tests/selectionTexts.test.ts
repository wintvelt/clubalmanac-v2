import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isScanned, listFiles, parse } from "./support/sourceScan";

// WP40 besluit 1 en 2, A1, A2, antwoord 4: de selectiestand haalt zijn titel
// en knoppen uit de pure logica (`src/lib/selectionBar.ts`, getest in
// `selectionBar.test.ts`), in beide schermen. De uitlegregel "Tik op foto's om
// ze te kiezen" is weg, en de schermen bouwen "3 geselecteerd" niet meer zelf.
// Een bronscan (de TypeScript-parser): alleen strings en aanroepen in de code,
// geen commentaar.
// Spec: docs/work-packages/WP40-selectiebalk.md §Testcontract.

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const LIB = "lib/selectionBar.ts";

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

function source(rel: string): ts.SourceFile {
  return parse(readFileSync(join(SRC, rel), "utf8"), rel.split("/").pop());
}

/** Letterlijke strings, delen van templates en JSX-tekst. */
function strings(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    else if (ts.isJsxText(n)) out.push(n.text);
  });
  return out;
}

/** Namen van functies die het bestand aanroept (`f(…)` en `x.f(…)`). */
function calls(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  walk(sf, (n) => {
    if (!ts.isCallExpression(n)) return;
    const e = n.expression;
    if (ts.isIdentifier(e)) out.add(e.text);
    else if (ts.isPropertyAccessExpression(e)) out.add(e.name.text);
  });
  return out;
}

/** De bestanden onder src die dit bestand met een relatief pad importeert. */
function localImports(rel: string): string[] {
  const out: string[] = [];
  walk(source(rel), (n) => {
    if (!ts.isImportDeclaration(n) || !ts.isStringLiteral(n.moduleSpecifier)) return;
    const spec = n.moduleSpecifier.text;
    if (!spec.startsWith(".")) return;
    const base = posix.normalize(posix.join(posix.dirname(rel), spec));
    for (const candidate of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
      if (existsSync(join(SRC, candidate))) {
        out.push(candidate);
        break;
      }
    }
  });
  return out;
}

const FILES = listFiles(SRC).filter(isScanned);

describe("de uitlegregel en de zelfgebouwde teller zijn weg (besluit 2, A1)", () => {
  it("nergens in de app nog 'Tik op foto's om ze te kiezen'", () => {
    const hits = FILES.filter((f) => strings(source(f)).some((s) => s.includes("Tik op foto's om ze te kiezen")));
    expect(hits).toEqual([]);
  });

  // Het toevoegscherm (WP39) heeft een eigen teller; die hoort hier niet bij.
  it.each(["screens/AlbumScreen.tsx", "screens/MyPhotosScreen.tsx", "screens/PhotoMenu.tsx"])(
    "%s bouwt 'geselecteerd' niet zelf; dat komt uit de pure logica",
    (rel) => {
      expect(strings(source(rel)).filter((s) => s.includes("geselecteerd"))).toEqual([]);
    },
  );
});

describe("beide schermen gebruiken de pure logica (antwoord 4, A2)", () => {
  it("de logica bestaat", () => {
    expect(existsSync(join(SRC, LIB))).toBe(true);
  });

  it.each(["screens/AlbumScreen.tsx", "screens/MyPhotosScreen.tsx"])(
    "%s roept selectionHeader en selectionButtons aan, zelf of via een gedeelde component",
    (screen) => {
      const reach = [screen, ...localImports(screen)].filter((f) => f !== LIB);
      const used = new Set(reach.flatMap((f) => [...calls(source(f))]));
      expect(used.has("selectionHeader"), "selectionHeader").toBe(true);
      expect(used.has("selectionButtons"), "selectionButtons").toBe(true);
    },
  );

  it("de pure logica importeert geen React of native modules", () => {
    expect(existsSync(join(SRC, LIB))).toBe(true);
    const imports: string[] = [];
    walk(source(LIB), (n) => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && !n.importClause?.isTypeOnly) {
        imports.push(n.moduleSpecifier.text);
      }
    });
    expect(imports.filter((m) => !m.startsWith("./"))).toEqual([]);
  });
});

// Zodat een verkeerd pad de test niet stil laat slagen.
it("de scan ziet de schermen", () => {
  expect(FILES).toContain("screens/AlbumScreen.tsx");
  expect(FILES).toContain("screens/MyPhotosScreen.tsx");
  expect(dirname(join(SRC, LIB))).toBe(join(SRC, "lib"));
});
