/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

// WP21 — A-invariant 12 (toegangsdefinitie, work-package-specs.md
// §Toegangsdefinities) en A-invariant 10 (alleen bekende films).
//   - Elk publiek pad dat een film-id aanneemt, staat hier.
//   - De module films heeft precies deze publieke functies; geen publieke
//     mutation (de lijst vullen gaat intern, replaceAll).
//   - De link-actions nemen alleen een film-id aan, geen sleutel of pad.
// Gelezen van de geëxporteerde functie-objecten, zoals
// tests/readWhitelist/inventory.test.ts.

type Registered = {
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  isPublic?: boolean;
  isInternal?: boolean;
  exportArgs?: () => string;
};

const modules = import.meta.glob<Record<string, unknown>>(
  ["../../convex/**/*.ts", "!../../convex/_generated/**", "!../../convex/**/*.d.ts"],
  { eager: true },
);

const OUT_OF_SCOPE_MODULES = new Set(["_test"]);

function allFunctions(): Map<string, Registered> {
  const found = new Map<string, Registered>();
  for (const [path, mod] of Object.entries(modules)) {
    const name = path.replace(/^\.\.\/\.\.\/convex\//, "").replace(/\.ts$/, "");
    if (OUT_OF_SCOPE_MODULES.has(name)) continue;
    for (const [exportName, value] of Object.entries(mod)) {
      const fn = value as Registered | null;
      if (fn && (fn.isQuery || fn.isMutation || fn.isAction)) found.set(`${name}:${exportName}`, fn);
    }
  }
  return found;
}

const EXPECTED_PUBLIC_FILM_PATHS = ["films:coverUrl", "films:list", "films:videoUrl"];
const EXPECTED_PUBLIC_FILM_ID_PATHS = ["films:coverUrl", "films:videoUrl"];

describe("A-invariant 12: inventaris film-paden", () => {
  it("de module films bestaat (sanity)", () => {
    expect(Object.keys(modules)).toContain("../../convex/films.ts");
  });

  it("de publieke functies van films zijn precies list, videoUrl, coverUrl", () => {
    const pub = [...allFunctions()]
      .filter(([name, fn]) => name.startsWith("films:") && fn.isPublic === true)
      .map(([name]) => name)
      .sort();
    expect(pub).toEqual(EXPECTED_PUBLIC_FILM_PATHS);
  });

  it("list is een query, videoUrl en coverUrl zijn actions", () => {
    const fns = allFunctions();
    expect(fns.get("films:list")?.isQuery).toBe(true);
    expect(fns.get("films:videoUrl")?.isAction).toBe(true);
    expect(fns.get("films:coverUrl")?.isAction).toBe(true);
  });

  it("replaceAll en checkLinks zijn intern", () => {
    const fns = allFunctions();
    expect(fns.get("films:replaceAll")?.isInternal).toBe(true);
    expect(fns.get("films:replaceAll")?.isMutation).toBe(true);
    expect(fns.get("films:checkLinks")?.isInternal).toBe(true);
    expect(fns.get("films:checkLinks")?.isAction).toBe(true);
  });

  it("geen publieke mutation of action buiten deze twee neemt een film-id aan", () => {
    const found = [...allFunctions()]
      .filter(([, fn]) => fn.isPublic === true && /"tableName":"films"/.test(fn.exportArgs?.() ?? ""))
      .map(([name]) => name)
      .sort();
    expect(found).toEqual(EXPECTED_PUBLIC_FILM_ID_PATHS);
  });
});

describe("A-invariant 10: de link-actions nemen alleen een film-id aan", () => {
  for (const name of EXPECTED_PUBLIC_FILM_ID_PATHS) {
    it(`${name}: argumenten zijn precies { filmId: v.id("films") }`, () => {
      const fn = allFunctions().get(name);
      expect(fn, `${name} ontbreekt`).toBeDefined();
      const args = JSON.parse(fn!.exportArgs?.() ?? "null") as {
        type: string;
        value?: Record<string, { fieldType: { type: string; tableName?: string }; optional: boolean }>;
      };
      expect(args.type).toBe("object");
      expect(Object.keys(args.value ?? {})).toEqual(["filmId"]);
      expect(args.value!.filmId!.fieldType).toEqual({ type: "id", tableName: "films" });
      expect(args.value!.filmId!.optional).toBe(false);
    });
  }

  it("films:list neemt geen argumenten", () => {
    const fn = allFunctions().get("films:list");
    const args = JSON.parse(fn?.exportArgs?.() ?? "null") as { type: string; value?: Record<string, unknown> };
    expect(args.type).toBe("object");
    expect(Object.keys(args.value ?? {})).toEqual([]);
  });
});
