import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// WP15a invariant 6: één toegangspad voor live Convex-data. Alleen het
// toegangspad mag een live hook of een watch van Convex gebruiken; elk ander
// bestand gaat erdoorheen. Een feature-WP die dit omzeilt, laat deze test falen.
//
// Gemeten op de broncode van app/, niet op de werking: of de hook de
// beslissing ook volgt, zien audit, red-team en het Convex-dashboard.

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ACCESS_PATH = "src/data/useLiveQuery.ts";

const SKIP_DIRS = new Set(["node_modules", "tests", "ios", "android", ".expo", ".tsbuild", "dist"]);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...sourceFiles(full));
    } else if (SOURCE_EXT.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file: string) => relative(APP_ROOT, file).split(sep).join("/");

// Live hooks van Convex. Eenmalig lezen (useConvex().query) is geen live query.
const LIVE_HOOKS = /\b(useQuery|useQueries|usePaginatedQuery|usePreloadedQuery)\b/;
// Pakketten waar zulke hooks uit kunnen komen.
const CONVEX_MODULE = /^(convex(\/.*)?|convex-helpers(\/.*)?|@convex-dev\/.+)$/;
// Pakketten die je met `import * as x` alsnog een live hook geven.
const HOOK_MODULE = /^(convex\/react(-clerk)?|convex-helpers\/react(\/.*)?|@convex-dev\/react-query)$/;
// Een abonnement buiten de hooks om, via de client.
const CLIENT_WATCH = /\.(watchQuery|onUpdate)\s*\(/;

type Import = { clause: string; module: string; typeOnly: boolean };

function importsOf(text: string): Import[] {
  const out: Import[] = [];
  const fromRe = /\b(import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;
  for (const m of text.matchAll(fromRe)) {
    out.push({ clause: m[3] ?? "", module: m[4] ?? "", typeOnly: Boolean(m[2]) });
  }
  // require("convex/react") en import("convex/react"): de hele module.
  const dynRe = /\b(require|import)\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of text.matchAll(dynRe)) {
    out.push({ clause: "*", module: m[2] ?? "", typeOnly: false });
  }
  return out;
}

function violations(text: string): string[] {
  const found: string[] = [];
  for (const imp of importsOf(text)) {
    if (imp.typeOnly || !CONVEX_MODULE.test(imp.module)) continue;
    if (LIVE_HOOKS.test(imp.clause)) {
      found.push(`live hook uit ${imp.module}`);
    } else if (HOOK_MODULE.test(imp.module) && /\*/.test(imp.clause)) {
      found.push(`hele module ${imp.module}`);
    }
  }
  if (CLIENT_WATCH.test(text)) found.push("watchQuery/onUpdate op de client");
  return found;
}

const files = sourceFiles(APP_ROOT);

describe("één toegangspad voor live data (invariant 6)", () => {
  it("de scan ziet de app-broncode", () => {
    const names = files.map(rel);
    expect(names).toContain("App.tsx");
    expect(names).toContain("src/AuthGate.tsx");
    expect(names.some((n) => n.startsWith("tests/"))).toBe(false);
  });

  it(`het toegangspad ${ACCESS_PATH} bestaat`, () => {
    expect(existsSync(join(APP_ROOT, ACCESS_PATH))).toBe(true);
  });

  it("het toegangspad gebruikt de beslissing uit src/lib/liveQuery", () => {
    const file = join(APP_ROOT, ACCESS_PATH);
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    const modules = importsOf(text).filter((i) => !i.typeOnly).map((i) => i.module);
    expect(modules.some((m) => /(^|\/)lib\/liveQuery$/.test(m))).toBe(true);
  });

  it("geen ander bestand gebruikt een live Convex-hook of een watch", () => {
    const offenders: Record<string, string[]> = {};
    for (const file of files) {
      if (rel(file) === ACCESS_PATH) continue;
      const v = violations(readFileSync(file, "utf8"));
      if (v.length > 0) offenders[rel(file)] = v;
    }
    expect(offenders).toEqual({});
  });
});

// De detectie zelf: vangt hij de omwegen die een feature-WP zou kunnen nemen?
describe("detectie van omwegen", () => {
  const detect = (text: string) => violations(text).length > 0;

  it.each([
    `import { useQuery } from "convex/react";`,
    `import { useMutation, useQuery as q } from "convex/react";`,
    `import {\n  useConvexAuth,\n  usePaginatedQuery,\n} from "convex/react";`,
    `import * as convex from "convex/react";`,
    `const r = require("convex/react");`,
    `const r = await import("convex/react");`,
    `export { useQuery } from "convex/react";`,
    `import { useQuery } from "convex-helpers/react/cache";`,
    `import { useQueries } from 'convex/react';`,
    `const w = useConvex().watchQuery(api.users.current, {});`,
    `client.onUpdate(api.users.current, {}, cb);`,
  ])("vangt: %s", (text) => {
    expect(detect(text)).toBe(true);
  });

  it.each([
    `import { useConvexAuth, useMutation, useAction } from "convex/react";`,
    `import { ConvexProviderWithClerk } from "convex/react-clerk";`,
    `import type { FunctionReference } from "convex/server";`,
    `import * as v from "convex/values";`,
    `import { api } from "../convexApi";`,
    `const user = await useConvex().query(api.users.current, {});`,
  ])("laat toe: %s", (text) => {
    expect(detect(text)).toBe(false);
  });
});
