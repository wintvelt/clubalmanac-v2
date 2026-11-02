import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { PUBLIC_PATHS } from "../src/lib/routeAccess";
import { listFiles, parse } from "./support/sourceScan";

// WP15a F4 (invarianten 4 en 7): Expo Router registreert elk bestand in
// src/app, ook als geen guard het noemt. Elk routebestand is daarom gedekt
// door een `*.Protected` in een _layout boven hem, of zijn pad staat in
// PUBLIC_PATHS. Een nieuwe route die niemand afschermt, laat deze test falen.
//
// F11: een Protected dekt alleen als zijn guard de sessie-toestand volgt:
// `useAuthState()` zelf, of een variabele die daarvan is afgeleid, in dezelfde
// _layout. `guard={true}` dekt niet. Of de guard de júiste toestanden opent,
// ziet de audit. Elk bestand onder src/app telt mee, ook in `dist/` of `tests/`.

const APP_DIR = fileURLToPath(new URL("../src/app", import.meta.url));

// Bestanden in src/app die geen scherm zijn.
const NOT_A_ROUTE = /(^|\/)(_layout|\+html|\+native-intent|\+middleware)\.[jt]sx?$|\+api\.[jt]sx?$/;
const ROUTE_EXT = /\.[jt]sx?$/;

function routeFiles(all: string[]): string[] {
  return all.filter((f) => ROUTE_EXT.test(f) && !f.endsWith(".d.ts") && !NOT_A_ROUTE.test(f));
}

// Komt `node` (of iets erin) aan useAuthState() of een afgeleide variabele?
function refersToSession(node: ts.Node, derived: Set<string>): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "useAuthState") {
      found = true;
    } else if (ts.isIdentifier(n) && derived.has(n.text)) {
      found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

// Variabelen in deze _layout die van useAuthState() zijn afgeleid, ook via
// tussenstappen (`const state = useAuthState(); const inApp = state === …`).
function sessionDerivedNames(sf: ts.SourceFile): Set<string> {
  const decls: ts.VariableDeclaration[] = [];
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.initializer) decls.push(n);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const derived = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of decls) {
      if (!d.initializer || !refersToSession(d.initializer, derived)) continue;
      const names: string[] = [];
      const bind = (b: ts.BindingName) => {
        if (ts.isIdentifier(b)) names.push(b.text);
        else for (const el of b.elements) if (!ts.isOmittedExpression(el)) bind(el.name);
      };
      bind(d.name);
      for (const n of names) {
        if (!derived.has(n)) {
          derived.add(n);
          grew = true;
        }
      }
    }
  }
  return derived;
}

// Volgt deze guard de sessie-toestand? Geen vaste waarde erin (true/false).
function guardFollowsSession(opening: ts.JsxOpeningElement, derived: Set<string>): boolean {
  for (const attr of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || attr.name.getText() !== "guard") continue;
    const init = attr.initializer;
    if (!init || !ts.isJsxExpression(init) || !init.expression) return false;
    let literal = false;
    const visit = (n: ts.Node) => {
      if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword) literal = true;
      ts.forEachChild(n, visit);
    };
    visit(init.expression);
    return !literal && refersToSession(init.expression, derived);
  }
  return false;
}

// De namen die een _layout als `*.Screen` noemt binnen een `*.Protected`
// waarvan de guard de sessie-toestand volgt.
function protectedScreenNames(layoutSource: string): Set<string> {
  const names = new Set<string>();
  const sf = parse(layoutSource, "_layout.tsx");
  const derived = sessionDerivedNames(sf);
  const tagName = (n: ts.JsxOpeningLikeElement) => n.tagName.getText();
  const visit = (node: ts.Node, inProtected: boolean) => {
    let inside = inProtected;
    if (
      ts.isJsxElement(node) &&
      /(^|\.)Protected$/.test(tagName(node.openingElement)) &&
      guardFollowsSession(node.openingElement, derived)
    ) {
      inside = true;
    }
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : undefined;
    if (inside && opening && /(^|\.)Screen$/.test(tagName(opening))) {
      for (const attr of opening.attributes.properties) {
        if (
          ts.isJsxAttribute(attr) &&
          attr.name.getText() === "name" &&
          attr.initializer &&
          ts.isStringLiteral(attr.initializer)
        ) {
          names.add(attr.initializer.text);
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(sf, false);
  return names;
}

// Het URL-pad van een routebestand: groepen `(x)` en `index` tellen niet mee.
// `null` voor een bestand zonder eigen pad (+not-found).
function urlOf(route: string): string | null {
  const segments = route.replace(ROUTE_EXT, "").split("/");
  if (segments.some((s) => s.startsWith("+"))) return null;
  const kept = segments.filter((s) => !/^\(.+\)$/.test(s));
  if (kept[kept.length - 1] === "index") kept.pop();
  return "/" + kept.join("/");
}

// Routebestanden die geen Protected dekt en die ook niet publiek zijn.
function uncoveredRoutes(
  all: string[],
  layoutSource: (dir: string) => string | undefined,
  publicPaths: Iterable<string>,
): string[] {
  const pub = new Set(publicPaths);
  const cache = new Map<string, Set<string>>();
  const protectedIn = (dir: string) => {
    if (!cache.has(dir)) {
      const src = layoutSource(dir);
      cache.set(dir, src === undefined ? new Set() : protectedScreenNames(src));
    }
    return cache.get(dir)!;
  };
  const out: string[] = [];
  for (const route of routeFiles(all)) {
    const segments = route.replace(ROUTE_EXT, "").split("/");
    let covered = false;
    // Elke map boven de route (de wortel eerst) kan hem met een _layout dekken.
    for (let k = 0; k < segments.length && !covered; k++) {
      const dir = segments.slice(0, k).join("/");
      const rest = segments.slice(k).join("/");
      for (const name of protectedIn(dir)) {
        if (rest === name || rest.startsWith(name + "/")) covered = true;
      }
    }
    const url = urlOf(route);
    if (!covered && (url === null || !pub.has(url))) out.push(route);
  }
  return out;
}

// Niets overslaan: ook src/app/dist/ en src/app/tests/ zijn routes (F11).
const realFiles = existsSync(APP_DIR) ? listFiles(APP_DIR, new Set()) : [];
const realLayout = (dir: string) => {
  for (const ext of ["tsx", "ts", "jsx", "js"]) {
    const file = join(APP_DIR, dir, `_layout.${ext}`);
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  return undefined;
};

describe("elk routebestand is afgeschermd of publiek (F4)", () => {
  it("de scan ziet de routes van 15a", () => {
    const urls = routeFiles(realFiles).map(urlOf);
    for (const url of ["/", "/mijn-fotos", "/profiel", "/instellingen", "/instellingen/over", "/toevoegen", "/inloggen"]) {
      expect(urls).toContain(url);
    }
  });

  it("geen routebestand buiten een Protected, tenzij zijn pad in PUBLIC_PATHS staat", () => {
    expect(uncoveredRoutes(realFiles, realLayout, PUBLIC_PATHS)).toEqual([]);
  });

  it("ook bestanden in dist/ en tests/ onder src/app tellen mee (F11)", () => {
    // Een nagemaakte src/app in .tsbuild/ (gitignored), zelfde lijstfunctie.
    const dir = fileURLToPath(new URL(`../.tsbuild/route-fixture-${process.pid}`, import.meta.url));
    try {
      for (const f of ["dist/x.tsx", "tests/y.tsx", "a/dist/z.tsx"]) {
        mkdirSync(join(dir, posix.dirname(f)), { recursive: true });
        writeFileSync(join(dir, f), "export default function X() { return null; }\n");
      }
      expect(listFiles(dir, new Set()).sort()).toEqual(["a/dist/z.tsx", "dist/x.tsx", "tests/y.tsx"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("elk pad in PUBLIC_PATHS heeft een routebestand", () => {
    const urls = new Set(routeFiles(realFiles).map(urlOf));
    for (const path of PUBLIC_PATHS) expect(urls.has(path)).toBe(true);
  });
});

// De dekking zelf, op een nagemaakte boom.
describe("detectie van onbeschermde routes", () => {
  const ROOT = `
    export default function L() {
      const state = useAuthState();
      const ready = state === "ready" || state === "reconnecting";
      return (
        <Stack>
          <Stack.Protected guard={ready}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="toevoegen" options={{ presentation: "modal" }} />
            <Stack.Screen name="+not-found" />
          </Stack.Protected>
          <Stack.Protected guard={!ready}>
            <Stack.Screen name="inloggen" />
          </Stack.Protected>
        </Stack>
      );
    }`;
  const TABS = `export default function T() { return <Tabs />; }`;
  const BASE = [
    "_layout.tsx",
    "+not-found.tsx",
    "inloggen.tsx",
    "toevoegen.tsx",
    "(tabs)/_layout.tsx",
    "(tabs)/(home)/index.tsx",
    "(tabs)/instellingen/_layout.tsx",
    "(tabs)/instellingen/index.tsx",
    "(tabs)/instellingen/over.tsx",
  ];
  const layouts = (root: string) => (dir: string) =>
    dir === "" ? root : dir.endsWith("(tabs)") || dir.includes("instellingen") ? TABS : undefined;

  it("de boom van 15a: alles gedekt", () => {
    expect(uncoveredRoutes(BASE, layouts(ROOT), ["/inloggen"])).toEqual([]);
  });

  it("een nieuw bestand in de wortel dat niemand noemt: onbeschermd", () => {
    expect(uncoveredRoutes([...BASE, "geheim.tsx"], layouts(ROOT), ["/inloggen"])).toEqual([
      "geheim.tsx",
    ]);
  });

  it("een nieuwe groep in de wortel: onbeschermd", () => {
    expect(
      uncoveredRoutes([...BASE, "(extra)/x.tsx", "(extra)/_layout.tsx"], layouts(ROOT), ["/inloggen"]),
    ).toEqual(["(extra)/x.tsx"]);
  });

  it("een nieuw bestand binnen een afgeschermde groep: gedekt", () => {
    expect(
      uncoveredRoutes([...BASE, "(tabs)/instellingen/geheim.tsx"], layouts(ROOT), ["/inloggen"]),
    ).toEqual([]);
  });

  it("een Screen buiten Protected telt niet als gedekt", () => {
    const open = ROOT.replace(
      `<Stack.Protected guard={!ready}>`,
      `<Stack.Screen name="publiek" />\n<Stack.Protected guard={!ready}>`,
    );
    expect(uncoveredRoutes([...BASE, "publiek.tsx"], layouts(open), ["/inloggen"])).toEqual([
      "publiek.tsx",
    ]);
  });

  it("een onbeschermd bestand mag als zijn pad in PUBLIC_PATHS staat", () => {
    expect(
      uncoveredRoutes([...BASE, "info.tsx"], layouts(ROOT), ["/inloggen", "/info"]),
    ).toEqual([]);
  });

  it("+not-found buiten Protected: onbeschermd (heeft geen eigen pad)", () => {
    const open = ROOT.replace(`<Stack.Screen name="+not-found" />`, "");
    expect(uncoveredRoutes(BASE, layouts(open), ["/inloggen"])).toEqual(["+not-found.tsx"]);
  });

  // F11: een guard die de sessie-toestand niet volgt, dekt niets.
  it.each([
    [`guard={true}`, `<Stack.Protected guard={true}>`],
    [`guard={false}`, `<Stack.Protected guard={false}>`],
    [`guard={ready || true}`, `<Stack.Protected guard={ready || true}>`],
    [`een losse vlag`, `<Stack.Protected guard={open}>`],
    [`zonder guard`, `<Stack.Protected>`],
  ])("%s dekt niet", (_label, tag) => {
    const open = ROOT.replace(`<Stack.Protected guard={ready}>`, tag).replace(
      "const ready",
      "const open = true;\n      const ready",
    );
    expect([...uncoveredRoutes(BASE, layouts(open), ["/inloggen"])].sort()).toEqual([
      "(tabs)/(home)/index.tsx",
      "(tabs)/instellingen/index.tsx",
      "(tabs)/instellingen/over.tsx",
      "+not-found.tsx",
      "toevoegen.tsx",
    ].sort());
  });

  it.each([
    [`guard={useAuthState() === "ready"}`],
    [`guard={state === "ready"}`],
    [`guard={!ready}`],
  ])("%s dekt wel", (attr) => {
    const tag = `<Stack.Protected ${attr}>`;
    const open = ROOT.replace(`<Stack.Protected guard={ready}>`, tag);
    expect(uncoveredRoutes(BASE, layouts(open), ["/inloggen"])).toEqual([]);
  });

  it("afgeleid via destructuring telt ook", () => {
    const open = ROOT.replace(
      "const ready = state",
      "const { ok: ready } = { ok: state",
    ).replace(`=== "reconnecting";`, `=== "reconnecting" };`);
    expect(uncoveredRoutes(BASE, layouts(open), ["/inloggen"])).toEqual([]);
  });

  it("urlOf: groepen en index tellen niet mee", () => {
    expect(urlOf("(tabs)/(home)/index.tsx")).toBe("/");
    expect(urlOf("(tabs)/instellingen/over.tsx")).toBe("/instellingen/over");
    expect(urlOf("inloggen.tsx")).toBe("/inloggen");
    expect(urlOf("+not-found.tsx")).toBeNull();
  });

  it("geen route: _layout, +html, api-routes", () => {
    expect(routeFiles(["_layout.tsx", "+html.tsx", "x/_layout.ts", "hello+api.ts", "a.tsx"])).toEqual([
      "a.tsx",
    ]);
  });
});
