import { existsSync, readFileSync } from "node:fs";
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
// Of de guard dezelfde toestand volgt als de poort, ziet de audit.

const APP_DIR = fileURLToPath(new URL("../src/app", import.meta.url));

// Bestanden in src/app die geen scherm zijn.
const NOT_A_ROUTE = /(^|\/)(_layout|\+html|\+native-intent|\+middleware)\.[jt]sx?$|\+api\.[jt]sx?$/;
const ROUTE_EXT = /\.[jt]sx?$/;

function routeFiles(all: string[]): string[] {
  return all.filter((f) => ROUTE_EXT.test(f) && !f.endsWith(".d.ts") && !NOT_A_ROUTE.test(f));
}

// De namen die een _layout binnen een `*.Protected` als `*.Screen` noemt.
function protectedScreenNames(layoutSource: string): Set<string> {
  const names = new Set<string>();
  const tagName = (n: ts.JsxOpeningLikeElement) => n.tagName.getText();
  const visit = (node: ts.Node, inProtected: boolean) => {
    let inside = inProtected;
    if (ts.isJsxElement(node) && /(^|\.)Protected$/.test(tagName(node.openingElement))) {
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
  visit(parse(layoutSource, "_layout.tsx"), false);
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

const realFiles = existsSync(APP_DIR) ? listFiles(APP_DIR) : [];
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

  it("elk pad in PUBLIC_PATHS heeft een routebestand", () => {
    const urls = new Set(routeFiles(realFiles).map(urlOf));
    for (const path of PUBLIC_PATHS) expect(urls.has(path)).toBe(true);
  });
});

// De dekking zelf, op een nagemaakte boom.
describe("detectie van onbeschermde routes", () => {
  const ROOT = `
    export default function L() {
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
