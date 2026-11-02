import { readdirSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import ts from "typescript";

// Hulp voor de scanners van WP15a (invariant 6, F2–F4). Leest broncode via de
// TypeScript-parser, niet met regexes: spaties, commentaar en puntkomma's maken
// dan niet uit (F3).

export function parse(text: string, fileName = "bron.tsx"): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

// --- Welke bestanden ---------------------------------------------------------

// Alleen in de wortel van app/ overslaan. Een map `tests` of `dist` dieper in
// de broncode telt mee (F3).
const ROOT_SKIP = new Set(["node_modules", "tests", "ios", "android", ".expo", ".tsbuild", "dist"]);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

export function isScanned(relPath: string): boolean {
  const first = relPath.split("/")[0] ?? "";
  if (ROOT_SKIP.has(first)) return false;
  return SOURCE_EXT.test(relPath) && !relPath.endsWith(".d.ts");
}

export function listFiles(root: string, dir = root): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(root, full).split(sep).join("/");
    if (statSync(full).isDirectory()) {
      if (!ROOT_SKIP.has(rel)) out.push(...listFiles(root, full));
    } else {
      out.push(rel);
    }
  }
  return out;
}

// --- Modules die een bestand gebruikt ------------------------------------------

export type ModuleUse = {
  module: string;
  // Geïmporteerde of geëxporteerde namen (de oorspronkelijke naam, niet de alias).
  names: string[];
  // De hele module: `* as x`, `export *`, `require(…)`, `import(…)`.
  whole: boolean;
  // Een import zonder bindingen: `import "x"`.
  bare: boolean;
  kind: "import" | "export" | "require";
};

function specifier(node: ts.Expression | undefined): string | undefined {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

export function moduleUses(sf: ts.SourceFile): ModuleUse[] {
  const out: ModuleUse[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const module = specifier(node.moduleSpecifier);
      const clause = node.importClause;
      if (module !== undefined && !clause) {
        out.push({ module, names: [], whole: false, bare: true, kind: "import" });
      } else if (module !== undefined && clause && !clause.isTypeOnly) {
        const names: string[] = [];
        let whole = false;
        if (clause.name) names.push("default");
        const nb = clause.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) whole = true;
        if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) {
            if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text);
          }
        }
        if (whole || names.length > 0) {
          out.push({ module, names, whole, bare: false, kind: "import" });
        }
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const module = specifier(node.moduleSpecifier);
      if (module !== undefined) {
        const ec = node.exportClause;
        const names: string[] = [];
        if (ec && ts.isNamedExports(ec)) {
          for (const el of ec.elements) {
            if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text);
          }
        }
        const whole = !ec || ts.isNamespaceExport(ec);
        if (whole || names.length > 0) {
          out.push({ module, names, whole, bare: false, kind: "export" });
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const module = specifier(node.moduleReference.expression);
      if (module !== undefined) out.push({ module, names: [], whole: true, bare: false, kind: "require" });
    } else if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const module = specifier(node.arguments[0]);
      if ((isRequire || isDynamic) && module !== undefined) {
        out.push({ module, names: [], whole: true, bare: false, kind: "require" });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// --- Leden die een bestand aanspreekt -------------------------------------------

// Namen waarmee code een lid aanspreekt: `x.naam`, `x["naam"]`,
// `const { naam } = x`, en elke string met precies die naam.
export function memberNames(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)) out.add(node.name.text);
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      out.add(node.argumentExpression.text);
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) out.add(key.text);
    }
    if (ts.isStringLiteralLike(node)) out.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// --- Invariant 6 + F3: live Convex-data buiten het toegangspad -----------------

const LIVE_HOOKS = new Set(["useQuery", "useQueries", "usePaginatedQuery", "usePreloadedQuery"]);
// Pakketten waar live hooks uit kunnen komen.
const CONVEX_FAMILY = /^(convex(\/.*)?|convex-helpers(\/.*)?|@convex-dev\/.+)$/;
// Pakketten die bij `* as x` of `require` alsnog een live hook geven.
const CONVEX_HOOK_MODULE = /^convex\/react(-clerk)?$/;
// Pakketten die alleen bestaan om live Convex-data in React te krijgen: elke
// import is een omweg (F3: useSessionQuery uit convex-helpers, convexQuery
// voor TanStack Query).
const BANNED_MODULE = /^(convex-helpers\/react(\/.*)?|@convex-dev\/react-query)$/;
// Leden van de Convex-client die een abonnement openen of de sync-laag geven.
// Eenmalig lezen (`query`) en `connectionState` blijven toegestaan.
export const CLIENT_WATCH_MEMBERS = [
  "watchQuery",
  "watchPaginatedQuery",
  "prewarmQuery",
  "paginatedQueryClient",
  "sync",
  "onUpdate",
];

export function liveDataViolations(text: string, fileName?: string): string[] {
  const sf = parse(text, fileName);
  const found: string[] = [];
  for (const use of moduleUses(sf)) {
    if (BANNED_MODULE.test(use.module)) {
      found.push(`import uit ${use.module}`);
    } else if (CONVEX_FAMILY.test(use.module)) {
      const hooks = use.names.filter((n) => LIVE_HOOKS.has(n));
      if (hooks.length > 0) found.push(`${hooks.join(", ")} uit ${use.module}`);
      else if (use.whole && CONVEX_HOOK_MODULE.test(use.module)) found.push(`hele module ${use.module}`);
    }
  }
  const members = memberNames(sf);
  for (const m of CLIENT_WATCH_MEMBERS) if (members.has(m)) found.push(`client-lid ${m}`);
  return found;
}

// --- F2: wie mag wat uit het toegangspad importeren ----------------------------

export const ACCESS_PATH = "src/data/useLiveQuery.ts";
const ACCESS_PATH_NO_EXT = ACCESS_PATH.replace(/\.tsx?$/, "");

// Wijst deze module-specifier, vanuit dit bestand, naar het toegangspad?
export function isAccessPath(spec: string, fromRel: string): boolean {
  if (spec.startsWith(".")) {
    const resolved = posix.normalize(posix.join(posix.dirname(fromRel), spec));
    return resolved.replace(/\.(ts|tsx|js)$/, "").replace(/\/index$/, "") === ACCESS_PATH_NO_EXT;
  }
  return /(^|\/)data\/useLiveQuery(\.(ts|tsx|js))?$/.test(spec);
}

// Alles behalve `useLiveQuery` uit het toegangspad, of de hele module.
export function accessPathViolations(text: string, fromRel: string): string[] {
  const found: string[] = [];
  for (const use of moduleUses(parse(text, fromRel))) {
    if (!isAccessPath(use.module, fromRel)) continue;
    if (use.whole) found.push("hele toegangspad-module");
    for (const n of use.names) if (n !== "useLiveQuery") found.push(n);
  }
  return found;
}
