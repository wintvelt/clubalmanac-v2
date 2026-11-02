import { readdirSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import ts from "typescript";

// Hulp voor de scanners van WP15a (invariant 6, F2–F4, F10, F11). Leest broncode via de
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

// Alle bestanden onder `root`, als pad vanaf `root`. `skipAtRoot` geldt alleen
// voor mappen direct in `root`; de routetest leest src/app volledig (F11).
export function listFiles(
  root: string,
  skipAtRoot: ReadonlySet<string> = ROOT_SKIP,
  dir = root,
): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(root, full).split(sep).join("/");
    if (statSync(full).isDirectory()) {
      if (!skipAtRoot.has(rel)) out.push(...listFiles(root, skipAtRoot, full));
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

// --- Invariant 6, F3 + F10: live Convex-data buiten het toegangspad ----------

// F10: een allowlist voor de convex-familie. Buiten het toegangspad mag code
// alleen deze waarden importeren; type-imports mogen altijd. Al het andere uit
// convex, convex-helpers of @convex-dev is verboden: andere namen, andere
// modules (convex/browser, convex/dist/…), namespace, require, import(…).
// Iets nieuws nodig? Zet het hier bewust bij.
export const CONVEX_ALLOWLIST: Record<string, readonly string[]> = {
  "convex/react": [
    "ConvexReactClient",
    "ConvexProviderWithAuth",
    "useConvexAuth",
    "useMutation",
    "useAction",
  ],
  "convex/react-clerk": ["ConvexProviderWithClerk"],
  "convex/server": ["anyApi", "getFunctionName"],
  "convex/values": ["ConvexError"],
};
const CONVEX_FAMILY = /^(convex(\/.*)?|convex-helpers(\/.*)?|@convex-dev(\/.*)?)$/;
// Een pakket rechtstreeks uit node_modules halen omzeilt elke lijst.
const VIA_NODE_MODULES = /(^|\/)node_modules\//;

// Leden van de Convex-client die een abonnement openen of de sync-laag geven.
// Een denylist: zonder typecheck weet de scan niet welk object het is. De
// allowlist hierboven houdt de client zelf al grotendeels buiten bereik
// (useConvex staat er niet op). Eenmalig lezen (`query`) en
// `connectionState` / `subscribeToConnectionState` blijven toegestaan.
export const CLIENT_WATCH_MEMBERS = [
  "watchQuery",
  "watchPaginatedQuery",
  "prewarmQuery",
  "paginatedQueryClient",
  "sync",
  "onUpdate",
  "subscribe",
];
const CLIENT_WATCH_PATTERN = /^onPaginatedUpdate|_experimental$/;

export function liveDataViolations(text: string, fileName?: string): string[] {
  const sf = parse(text, fileName);
  const found: string[] = [];
  for (const use of moduleUses(sf)) {
    if (VIA_NODE_MODULES.test(use.module)) {
      found.push(`pad via node_modules: ${use.module}`);
      continue;
    }
    if (!CONVEX_FAMILY.test(use.module)) continue;
    const allowed = CONVEX_ALLOWLIST[use.module];
    if (!allowed) {
      found.push(`module ${use.module} staat niet op de allowlist`);
    } else if (use.whole || use.bare || use.kind === "require") {
      found.push(`hele module ${use.module}`);
    } else {
      const extra = use.names.filter((n) => !allowed.includes(n));
      if (extra.length > 0) found.push(`${extra.join(", ")} uit ${use.module}`);
    }
  }
  const members = memberNames(sf);
  for (const m of members) {
    if (CLIENT_WATCH_MEMBERS.includes(m) || CLIENT_WATCH_PATTERN.test(m)) found.push(`client-lid ${m}`);
  }
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
