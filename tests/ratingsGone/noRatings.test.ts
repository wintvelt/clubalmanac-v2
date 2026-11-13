/// <reference types="vite/client" />
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import schema from "../../convex/schema";

// WP19a invariant 1 en 2: ratings zijn geschrapt (besluit 1 en 2).
// Spec: docs/work-packages/WP19a-ratings-schrappen.md.
//
// 1. Geen publieke of interne functie neemt of geeft een rating, ook niet als
//    gemiddelde of aantal in een geneste foto-vorm.
// 2. Het schema heeft geen tabel `ratings` en geen rating-velden op een foto.
//
// Daarnaast (risico "geen pad verwijst nog naar de tabel of de velden"): de
// code in convex/ noemt geen rating meer. Commentaar telt niet mee; een
// tabelnaam in een string wel.

type Registered = {
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  isHttp?: boolean;
  isPublic?: boolean;
  isInternal?: boolean;
  exportArgs?: () => string;
  exportReturns?: () => string;
};

const modules = import.meta.glob<Record<string, unknown>>(
  ["../../convex/**/*.ts", "!../../convex/_generated/**", "!../../convex/**/*.d.ts"],
  { eager: true },
);

const moduleName = (path: string) =>
  path.replace(/^\.\.\/\.\.\/convex\//, "").replace(/\.ts$/, "");

function registeredFunctions(): Map<string, Registered> {
  const found = new Map<string, Registered>();
  for (const [path, mod] of Object.entries(modules)) {
    for (const [exportName, value] of Object.entries(mod)) {
      const fn = value as Registered | null;
      if (!fn || typeof fn !== "object" && typeof fn !== "function") continue;
      if (fn.isQuery || fn.isMutation || fn.isAction || fn.isHttp) {
        found.set(`${moduleName(path)}:${exportName}`, fn);
      }
    }
  }
  return found;
}

const CONVEX = join(__dirname, "../../convex");

function convexSources(dir = CONVEX): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "_generated") continue;
      out.push(...convexSources(full));
    } else if (/\.ts$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * De broncode zonder commentaar: geparsed en opnieuw geprint. Een losse
 * scanner leest template-strings verkeerd (zie de sanity-test).
 */
function withoutComments(text: string): string {
  const file = ts.createSourceFile("bron.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return ts.createPrinter({ removeComments: true }).printFile(file);
}

describe("WP19a invariant 2: geen opslag", () => {
  it("het schema heeft geen tabel ratings", () => {
    expect(Object.keys(schema.tables)).not.toContain("ratings");
  });

  it("het schema noemt nergens een rating (ook geen veld op photos)", () => {
    // `export()` staat niet in de publieke typen, wel op het object (Convex gebruikt hem bij de push).
    expect((schema as unknown as { export(): string }).export()).not.toMatch(/rating/i);
  });

  it("de andere tabellen staan er nog (sanity)", () => {
    for (const table of ["users", "photos", "albumPhotos", "features", "featureUpvotes"]) {
      expect(Object.keys(schema.tables)).toContain(table);
    }
  });
});

describe("WP19a invariant 1: geen ingang", () => {
  it("functies zijn gevonden (sanity: de glob werkt)", () => {
    expect(registeredFunctions().size).toBeGreaterThan(20);
  });

  it("er is geen module ratings", () => {
    const names = Object.keys(modules).map(moduleName);
    expect(names).not.toContain("ratings");
  });

  it("geen functie heet naar een rating", () => {
    const hits = [...registeredFunctions().keys()].filter((name) => /rating/i.test(name));
    expect(hits).toEqual([]);
  });

  it("geen functie neemt een rating aan of geeft er een terug, ook niet genest", () => {
    // Dekt de foto-vorm in album, detail, Mijn foto's en covers: die
    // returns-validators bevatten de geneste foto-velden.
    const hits: string[] = [];
    for (const [name, fn] of registeredFunctions()) {
      const args = fn.exportArgs?.() ?? "";
      const returns = fn.exportReturns?.() ?? "";
      if (/rating/i.test(args)) hits.push(`${name} (args)`);
      if (/rating/i.test(returns)) hits.push(`${name} (returns)`);
    }
    expect(hits).toEqual([]);
  });

  it("de code in convex/ verwijst niet meer naar de tabel of de velden", () => {
    const hits = convexSources()
      .filter((file) => /rating/i.test(withoutComments(readFileSync(file, "utf8"))))
      .map((file) => relative(CONVEX, file));
    expect(hits).toEqual([]);
  });

  it("[sanity] de scanner haalt commentaar weg en laat strings staan", () => {
    const stripped = withoutComments('// rating\nconst t = "ratings"; /* ratingCount */');
    expect(stripped).toContain('"ratings"');
    expect(stripped).not.toContain("ratingCount");
    expect(stripped).not.toMatch(/\/\/ rating/);
  });

  it("[sanity] ook na een template-string met een expressie", () => {
    const stripped = withoutComments(
      'const a = `x ${1} y`;\n// rating-comments\nconst b = `${a}`; /* ratingAverage */\nconst c = "ratingCount";',
    );
    expect(stripped).not.toMatch(/rating-comments|ratingAverage/);
    expect(stripped).toContain('"ratingCount"');
  });
});
