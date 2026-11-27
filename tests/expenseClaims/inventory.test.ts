/// <reference types="vite/client" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import schema from "../../convex/schema";
import http from "../../convex/http";

// WP45 §A10 (toegangsdefinitie, work-package-specs.md §Toegangsdefinities),
// de routes (§A5–A8) en het schema (§A12).
//   - De publieke functies van expenseClaims zijn precies de vijf van §A2,
//     met precies die args; geen memberId, userId of status in de invoer
//     (draft-invariant 1).
//   - Elk publiek pad dat een expenseClaims-id aanneemt, staat hier.
//   - Geen publieke action; schrijven vanuit het clubboek gaat alleen via de
//     routes naar interne functies (draft-invariant 9, 12).
//   - Alleen GET /claims, POST /claims/decision en POST /claims/purge; geen
//     OPTIONS (geen CORS).
//   - De gate gebruikt de gedeelde vergelijking in constante tijd (WP41 §A8).
// Gelezen van de geëxporteerde functie-objecten, zoals tests/settlements/inventory.

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

type Field = { fieldType: { type: string; tableName?: string; value?: unknown }; optional: boolean };
type ArgsJson = { type: string; value?: Record<string, Field> };
const argsOf = (fn: Registered | undefined): ArgsJson => JSON.parse(fn?.exportArgs?.() ?? "null") as ArgsJson;

const CLAIM_ID = { type: "id", tableName: "expenseClaims" };
const GROUP_ID = { type: "id", tableName: "groups" };

describe("§A10: inventaris van de paden van een declaratie", () => {
  it("de module expenseClaims bestaat (sanity)", () => {
    expect(Object.keys(convexModules)).toContain("../../convex/expenseClaims.ts");
  });

  it("de publieke functies zijn precies saveDraft, deleteDraft, submit, withdraw (mutations) en listMine (query)", () => {
    const pub = [...allFunctions()].filter(([n, fn]) => n.startsWith("expenseClaims:") && fn.isPublic === true);
    expect(pub.map(([n]) => n).sort()).toEqual([
      "expenseClaims:deleteDraft",
      "expenseClaims:listMine",
      "expenseClaims:saveDraft",
      "expenseClaims:submit",
      "expenseClaims:withdraw",
    ]);
    const kind = Object.fromEntries(pub.map(([n, fn]) => [n, fn.isQuery ? "query" : fn.isMutation ? "mutation" : "action"]));
    expect(kind).toEqual({
      "expenseClaims:deleteDraft": "mutation",
      "expenseClaims:listMine": "query",
      "expenseClaims:saveDraft": "mutation",
      "expenseClaims:submit": "mutation",
      "expenseClaims:withdraw": "mutation",
    });
  });

  it("expenseClaims heeft interne functies voor de routes (een query en mutations)", () => {
    const internals = [...allFunctions()].filter(([n, fn]) => n.startsWith("expenseClaims:") && fn.isInternal === true);
    expect(internals.some(([, fn]) => fn.isQuery)).toBe(true);
    expect(internals.some(([, fn]) => fn.isMutation)).toBe(true);
  });

  it("saveDraft neemt precies { groupId, claimId?, title, expenseDate, amountCents }", () => {
    const args = argsOf(allFunctions().get("expenseClaims:saveDraft"));
    expect(args.type).toBe("object");
    expect(Object.keys(args.value ?? {}).sort()).toEqual(["amountCents", "claimId", "expenseDate", "groupId", "title"]);
    expect(args.value!.groupId!.fieldType).toEqual(GROUP_ID);
    expect(args.value!.groupId!.optional).toBe(false);
    expect(args.value!.claimId!.fieldType).toEqual(CLAIM_ID);
    expect(args.value!.claimId!.optional).toBe(true);
    for (const k of ["title", "expenseDate", "amountCents"]) expect(args.value![k]!.optional).toBe(false);
  });

  for (const name of ["deleteDraft", "submit", "withdraw"]) {
    it(`${name} neemt precies { claimId: v.id('expenseClaims') }`, () => {
      const args = argsOf(allFunctions().get(`expenseClaims:${name}`));
      expect(Object.keys(args.value ?? {})).toEqual(["claimId"]);
      expect(args.value!.claimId!.fieldType).toEqual(CLAIM_ID);
      expect(args.value!.claimId!.optional).toBe(false);
    });
  }

  it("listMine neemt precies { groupId: v.id('groups') }", () => {
    const args = argsOf(allFunctions().get("expenseClaims:listMine"));
    expect(Object.keys(args.value ?? {})).toEqual(["groupId"]);
    expect(args.value!.groupId!.fieldType).toEqual(GROUP_ID);
  });

  it("draft-invariant 1: geen publieke functie in de module neemt memberId, userId of status aan", () => {
    for (const [n, fn] of allFunctions()) {
      if (!n.startsWith("expenseClaims:") || fn.isPublic !== true) continue;
      const keys = Object.keys(argsOf(fn).value ?? {});
      expect(keys, n).not.toContain("memberId");
      expect(keys, n).not.toContain("userId");
      expect(keys, n).not.toContain("status");
    }
  });

  it("geen ander publiek pad, waar ook in convex/, neemt een expenseClaims-id aan", () => {
    const found = [...allFunctions()]
      .filter(([, fn]) => fn.isPublic === true && /"tableName":"expenseClaims"/.test(fn.exportArgs?.() ?? ""))
      .map(([n]) => n)
      .sort();
    expect(found).toEqual([
      "expenseClaims:deleteDraft",
      "expenseClaims:saveDraft",
      "expenseClaims:submit",
      "expenseClaims:withdraw",
    ]);
  });

  it("geen publieke action, waar ook in convex/, met 'claim' in de naam", () => {
    const actions = [...allFunctions()].filter(([n, fn]) => fn.isPublic === true && fn.isAction && /claim/i.test(n));
    expect(actions.map(([n]) => n)).toEqual([]);
  });
});

describe("§A5–A8: de HTTP-routes", () => {
  const methodsOn = (path: string) =>
    http
      .getRoutes()
      .filter(([p]) => p === path)
      .map(([, m]) => m)
      .sort();

  it("/claims: alleen GET", () => {
    expect(methodsOn("/claims")).toEqual(["GET"]);
  });

  it("/claims/decision en /claims/purge: alleen POST", () => {
    expect(methodsOn("/claims/decision")).toEqual(["POST"]);
    expect(methodsOn("/claims/purge")).toEqual(["POST"]);
  });

  it("geen OPTIONS, ook niet via een prefix-route", () => {
    for (const p of ["/claims", "/claims/decision", "/claims/purge"]) {
      expect(http.lookup(p, "OPTIONS"), p).toBeNull();
    }
  });

  it("geen andere route onder /claims", () => {
    const extra = http
      .getRoutes()
      .map(([p]) => p)
      .filter((p) => p.startsWith("/claims") && !["/claims", "/claims/decision", "/claims/purge"].includes(p));
    expect(extra).toEqual([]);
  });
});

// --- het schema ------------------------------------------------------------------

type TableJson = {
  tableName: string;
  indexes: Array<{ indexDescriptor: string; fields: string[] }>;
  documentType: { type: string; value: Record<string, Field> };
};

function claimsTable(): TableJson | undefined {
  const exported = JSON.parse((schema as unknown as { export(): string }).export()) as { tables: TableJson[] };
  return exported.tables.find((t) => t.tableName === "expenseClaims");
}

describe("§A12: het schema", () => {
  it("de tabel expenseClaims bestaat, met (minstens) de velden van de draft", () => {
    const table = claimsTable();
    expect(table, "tabel expenseClaims ontbreekt").toBeDefined();
    expect(Object.keys(table!.documentType.value)).toEqual(
      expect.arrayContaining([
        "amountCents",
        "decidedAt",
        "expenseDate",
        "groupId",
        "memberId",
        "note",
        "processedCents",
        "revision",
        "status",
        "submittedAt",
        "title",
        "withdrawnAt",
      ]),
    );
  });

  it("groupId is een id van groups, memberId een id van users, beide verplicht", () => {
    const doc = claimsTable()!.documentType;
    expect(doc.value.groupId!.fieldType).toEqual(GROUP_ID);
    expect(doc.value.groupId!.optional).toBe(false);
    expect(doc.value.memberId!.fieldType).toEqual({ type: "id", tableName: "users" });
    expect(doc.value.memberId!.optional).toBe(false);
  });

  it("de validator is getypt: geen any, geen record, geen storage-id", () => {
    const raw = JSON.stringify(claimsTable()!.documentType);
    expect(raw).not.toMatch(/"type":"any"/);
    expect(raw).not.toMatch(/"type":"record"/);
    expect(raw).not.toMatch(/"tableName":"_storage"/);
  });

  it("er is minstens één index op groupId en één op memberId (lijst, grenzen, account weg)", () => {
    const idx = claimsTable()!.indexes;
    expect(idx.some((i) => i.fields[0] === "groupId")).toBe(true);
    expect(idx.some((i) => i.fields[0] === "memberId")).toBe(true);
  });
});

// --- de vergelijking in constante tijd -------------------------------------------

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

describe("draft-invariant 11: constante tijd via de gedeelde helper", () => {
  it("elk bestand dat CLAIMS_SECRET leest, gebruikt constantTimeEqual uit lib/constantTime", () => {
    const read = (f: string) => readFileSync(join(CONVEX_DIR, f), "utf8");
    // Zonder commentaar: een route-beschrijving in http.ts telt niet als lezen.
    const code = (f: string) =>
      read(f)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    const readers = sourceFiles(CONVEX_DIR).filter((f) => /\bCLAIMS_SECRET\b/.test(code(f)));
    expect(readers.length, "geen bestand leest CLAIMS_SECRET").toBeGreaterThan(0);
    for (const f of readers) {
      expect(read(f), f).toMatch(
        /import\s*\{[^}]*\bconstantTimeEqual\b[^}]*\}\s*from\s*["'](\.\/lib|\.\.?)\/constantTime["']/,
      );
    }
  });
});
