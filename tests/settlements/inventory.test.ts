/// <reference types="vite/client" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import schema from "../../convex/schema";
import http from "../../convex/http";

// WP41 §A7 (toegangsdefinitie, work-package-specs.md §Toegangsdefinities),
// §A8 (gedeelde vergelijking in constante tijd) en het schema (§A10).
//   - Elk publiek pad dat een settlements-id aanneemt, staat hier: alleen
//     settlements:get. Een groupId voor dit doel: alleen settlements:listByGroup.
//   - De module settlements heeft geen publieke mutation of action: schrijven
//     gaat alleen via de twee HTTP-routes naar interne functies (invariant 2).
//   - Op /settlements alleen POST en DELETE: geen OPTIONS (geen CORS), geen GET.
// Gelezen van de geëxporteerde functie-objecten, zoals tests/films/inventory.

type Registered = {
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  isPublic?: boolean;
  isInternal?: boolean;
  exportArgs?: () => string;
};

const convexModules = import.meta.glob<Record<string, unknown>>(
  ["../../convex/**/*.ts", "!../../convex/_generated/**", "!../../convex/**/*.d.ts"],
  { eager: true },
);

const OUT_OF_SCOPE_MODULES = new Set(["_test"]);

function allFunctions(): Map<string, Registered> {
  const found = new Map<string, Registered>();
  for (const [path, mod] of Object.entries(convexModules)) {
    const name = path.replace(/^\.\.\/\.\.\/convex\//, "").replace(/\.ts$/, "");
    if (OUT_OF_SCOPE_MODULES.has(name)) continue;
    for (const [exportName, value] of Object.entries(mod)) {
      const fn = value as Registered | null;
      if (fn && (fn.isQuery || fn.isMutation || fn.isAction)) found.set(`${name}:${exportName}`, fn);
    }
  }
  return found;
}

type ArgsJson = {
  type: string;
  value?: Record<string, { fieldType: { type: string; tableName?: string }; optional: boolean }>;
};
const argsOf = (fn: Registered | undefined): ArgsJson => JSON.parse(fn?.exportArgs?.() ?? "null") as ArgsJson;

describe("A7: inventaris van de afrekening-paden", () => {
  it("de module settlements bestaat (sanity)", () => {
    expect(Object.keys(convexModules)).toContain("../../convex/settlements.ts");
  });

  it("de publieke functies van settlements zijn precies get en listByGroup, beide queries", () => {
    const pub = [...allFunctions()].filter(([n, fn]) => n.startsWith("settlements:") && fn.isPublic === true);
    expect(pub.map(([n]) => n).sort()).toEqual(["settlements:get", "settlements:listByGroup"]);
    for (const [, fn] of pub) expect(fn.isQuery).toBe(true);
  });

  it("settlements heeft wel interne functies om te schrijven (de routes roepen die aan)", () => {
    const internalWrites = [...allFunctions()].filter(
      ([n, fn]) => n.startsWith("settlements:") && fn.isInternal === true && fn.isMutation === true,
    );
    expect(internalWrites.length).toBeGreaterThan(0);
  });

  it("get neemt precies { settlementId: v.id('settlements') }", () => {
    const args = argsOf(allFunctions().get("settlements:get"));
    expect(args.type).toBe("object");
    expect(Object.keys(args.value ?? {})).toEqual(["settlementId"]);
    expect(args.value!.settlementId!.fieldType).toEqual({ type: "id", tableName: "settlements" });
    expect(args.value!.settlementId!.optional).toBe(false);
  });

  it("listByGroup neemt precies { groupId: v.id('groups') }", () => {
    const args = argsOf(allFunctions().get("settlements:listByGroup"));
    expect(args.type).toBe("object");
    expect(Object.keys(args.value ?? {})).toEqual(["groupId"]);
    expect(args.value!.groupId!.fieldType).toEqual({ type: "id", tableName: "groups" });
    expect(args.value!.groupId!.optional).toBe(false);
  });

  it("geen ander publiek pad, waar ook in convex/, neemt een settlements-id aan", () => {
    const found = [...allFunctions()]
      .filter(([, fn]) => fn.isPublic === true && /"tableName":"settlements"/.test(fn.exportArgs?.() ?? ""))
      .map(([n]) => n)
      .sort();
    expect(found).toEqual(["settlements:get"]);
  });
});

describe("A4/A5: de HTTP-routes", () => {
  it("op /settlements alleen POST en DELETE", () => {
    const methods = http
      .getRoutes()
      .filter(([path]) => path === "/settlements")
      .map(([, method]) => method)
      .sort();
    expect(methods).toEqual(["DELETE", "POST"]);
  });

  it("geen OPTIONS en geen GET, ook niet via een prefix-route", () => {
    expect(http.lookup("/settlements", "OPTIONS")).toBeNull();
    expect(http.lookup("/settlements", "GET")).toBeNull();
  });
});

type TableJson = {
  tableName: string;
  indexes: Array<{ indexDescriptor: string; fields: string[] }>;
  documentType: { type: string; value: Record<string, { fieldType: { type: string; tableName?: string } }> };
};

function settlementsTable(): TableJson | undefined {
  const exported = JSON.parse((schema as unknown as { export(): string }).export()) as { tables: TableJson[] };
  return exported.tables.find((t) => t.tableName === "settlements");
}

describe("A10: het schema", () => {
  it("de tabel settlements bestaat, met by_group en by_group_key", () => {
    const table = settlementsTable();
    expect(table, "tabel settlements ontbreekt").toBeDefined();
    const idx = Object.fromEntries(table!.indexes.map((i) => [i.indexDescriptor, i.fields]));
    expect(idx.by_group).toEqual(["groupId"]);
    expect(idx.by_group_key).toEqual(["groupId", "key"]);
  });

  it("groupId is een id van groups, key is tekst", () => {
    const doc = settlementsTable()!.documentType;
    expect(doc.value.groupId!.fieldType).toEqual({ type: "id", tableName: "groups" });
    expect(doc.value.key!.fieldType).toEqual({ type: "string" });
  });

  it("de validator is getypt: geen any en geen record, op geen enkel niveau", () => {
    const raw = JSON.stringify(settlementsTable()!.documentType);
    expect(raw).not.toMatch(/"type":"any"/);
    expect(raw).not.toMatch(/"type":"record"/);
  });

  it("er is geen veld voor een intern id van een lid", () => {
    const raw = JSON.stringify(settlementsTable()!.documentType);
    expect(raw).not.toMatch(/lid_?id|memberId|userId/i);
  });
});

// --- A8: één vergelijking in constante tijd ----------------------------------

const CONVEX_DIR = fileURLToPath(new URL("../../convex", import.meta.url));

function sourceFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, rel))) {
    const r = rel ? `${rel}/${entry}` : entry;
    if (r === "_generated") continue;
    if (statSync(join(dir, r)).isDirectory()) out.push(...sourceFiles(dir, r));
    else if (r.endsWith(".ts") && !r.endsWith(".d.ts")) out.push(r);
  }
  return out;
}

describe("A8: de vergelijking in constante tijd staat op één plek", () => {
  const files = sourceFiles(CONVEX_DIR);
  const read = (f: string) => readFileSync(join(CONVEX_DIR, f), "utf8");
  const defines = (src: string) =>
    /function\s+constantTimeEqual\b|constantTimeEqual\s*=\s*(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(src);

  it("constantTimeEqual is alleen in lib/constantTime.ts gedefinieerd", () => {
    expect(files.filter((f) => defines(read(f)))).toEqual(["lib/constantTime.ts"]);
  });

  it("lib/testGate.ts gebruikt hem (WP26 heeft geen eigen kopie meer)", () => {
    expect(read("lib/testGate.ts")).toMatch(/import\s*\{[^}]*\bconstantTimeEqual\b[^}]*\}\s*from\s*["']\.\/constantTime["']/);
  });

  it("de gate van de nieuwe routes gebruikt hem ook", () => {
    const users = files.filter(
      (f) => f !== "lib/constantTime.ts" && f !== "lib/testGate.ts" && /\bconstantTimeEqual\b/.test(read(f)),
    );
    expect(users.length).toBeGreaterThan(0);
  });
});
