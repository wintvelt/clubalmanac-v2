import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACCESS_PATH,
  accessPathViolations,
  isScanned,
  listFiles,
  liveDataViolations,
  moduleUses,
  parse,
} from "./support/sourceScan";

// WP15a invariant 6, F2, F3, F6 + F10: één toegangspad voor live Convex-data. Alleen het
// toegangspad mag een live hook of een watch van Convex gebruiken; elk ander
// bestand gaat erdoorheen. Buiten focus om loopt alleen de query van de poort,
// en alleen de poort mag die route gebruiken. Een feature-WP die dit omzeilt,
// laat deze test falen.
//
// Gemeten op de broncode van app/, niet op de werking: of de hook de
// beslissing ook volgt, zien audit, red-team en het Convex-dashboard.

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const GATE = "src/AuthGate.tsx";

const files = listFiles(APP_ROOT).filter(isScanned);
const read = (rel: string) => readFileSync(join(APP_ROOT, rel), "utf8");

describe("één toegangspad voor live data (invariant 6)", () => {
  it("de scan ziet de app-broncode, niet de tests in de wortel", () => {
    expect(files).toContain("App.tsx");
    expect(files).toContain(GATE);
    expect(files).toContain(ACCESS_PATH);
    expect(files.some((n) => n.startsWith("tests/"))).toBe(false);
  });

  it("het toegangspad gebruikt de beslissing uit src/lib/liveQuery", () => {
    const text = existsSync(join(APP_ROOT, ACCESS_PATH)) ? read(ACCESS_PATH) : "";
    const modules = moduleUses(parse(text)).map((u) => u.module);
    expect(modules.some((m) => /(^|\/)lib\/liveQuery$/.test(m))).toBe(true);
  });

  it("geen ander bestand gebruikt een live Convex-hook of een watch", () => {
    const offenders: Record<string, string[]> = {};
    for (const file of files) {
      if (file === ACCESS_PATH) continue;
      const v = liveDataViolations(read(file), file);
      if (v.length > 0) offenders[file] = v;
    }
    expect(offenders).toEqual({});
  });

  it("alleen de poort importeert iets anders dan useLiveQuery uit het toegangspad (F2)", () => {
    const offenders: Record<string, string[]> = {};
    for (const file of files) {
      if (file === ACCESS_PATH || file === GATE) continue;
      const v = accessPathViolations(read(file), file);
      if (v.length > 0) offenders[file] = v;
    }
    expect(offenders).toEqual({});
  });
});

describe("welke bestanden de scan leest (F3)", () => {
  it.each([
    "src/feature/tests/Scherm.tsx",
    "src/dist/x.ts",
    "src/app/(tabs)/tests/index.tsx",
    "src/lib/node_modules.ts",
    "App.tsx",
  ])("leest %s", (rel) => {
    expect(isScanned(rel)).toBe(true);
  });

  it.each([
    "tests/liveQuery.test.ts",
    "node_modules/convex/dist/esm/react/client.js",
    "dist/index.js",
    "ios/Pods/x.js",
    "src/types.d.ts",
    "src/README.md",
  ])("slaat over: %s", (rel) => {
    expect(isScanned(rel)).toBe(false);
  });
});

// De detectie zelf: vangt hij de omwegen die een feature-WP zou kunnen nemen?
// De eerste reeks is de tabel van de red-team (F3).
describe("detectie van omwegen (F3)", () => {
  const detect = (text: string) => liveDataViolations(text).length > 0;

  it.each([
    // al gevangen vóór F3
    `import { useQuery } from "convex/react";`,
    `import { useMutation, useQuery as q } from "convex/react";`,
    `import {\n  useConvexAuth,\n  usePaginatedQuery,\n} from "convex/react";`,
    `import * as convex from "convex/react";`,
    `const r = require("convex/react");`,
    `const r = await import("convex/react");`,
    `export { useQuery } from "convex/react";`,
    `export * from "convex/react";`,
    `import { useQuery } from "convex-helpers/react/cache";`,
    `import { useQueries } from 'convex/react';`,
    `const w = useConvex().watchQuery(api.users.current, {});`,
    `client.onUpdate(api.users.current, {}, cb);`,
    // F3, red-team
    `useConvex().prewarmQuery({ query: api.users.current, args: {} });`,
    `useConvex().sync.subscribe(api.users.current, {});`,
    `client["watchQuery"](api.users.current, {});`,
    `w.onUpdate.call(w, cb);`,
    `import { useQuery } from "@tanstack/react-query";\nimport { convexQuery } from "@convex-dev/react-query";\nuseQuery(convexQuery(api.users.current, {}));`,
    `import { useSessionQuery } from "convex-helpers/react/sessions";`,
    `import {useQuery}from"convex/react"`,
    `import{useQuery}from'convex/react'`,
    `import { useMutation, /* ; */ useQuery } from "convex/react";`,
    `import {\n  useMutation, // eerst dit; dan\n  useQuery,\n} from "convex/react";`,
    // varianten op dezelfde omwegen
    `const { watchQuery } = useConvex();`,
    `const { sync } = useConvex();`,
    `const c = useConvex(); c.paginatedQueryClient;`,
    `client.watchPaginatedQuery(api.photos.list, {}, { initialNumItems: 10 });`,
    `import "@convex-dev/react-query";`,
    `import { ConvexQueryClient } from "@convex-dev/react-query";`,
    `import x = require("convex/react");`,
    `export { useQuery as useLive } from "convex/react";`,
    // F10, red-team R2: wat een denylist mist
    `import { useQuery_experimental } from "convex/react";`,
    `import { usePaginatedQuery_experimental } from "convex/react";`,
    `import { BaseConvexClient } from "convex/browser";\nnew BaseConvexClient(url, cb).subscribe("users:current", {});`,
    `import { ConvexClient } from "convex/browser";\nnew ConvexClient(url).onPaginatedUpdate_experimental(q, {}, cb);`,
    `require("convex/dist/cjs/react/index.js").useQuery(api.users.current, {});`,
    // F10: alles buiten de allowlist
    `import { useConvex } from "convex/react";`,
    `import { ConvexProvider } from "convex/react";`,
    `import { anyApi as a, makeFunctionReference } from "convex/server";`,
    `import * as v from "convex/values";`,
    `import { v } from "convex/values";`,
    `import convex from "convex";`,
    `import { something } from "convex";`,
    `import { ConvexHttpClient } from "convex/browser";`,
    `import { useQuery } from "convex/dist/esm/react/index.js";`,
    `import { x } from "convex-helpers";`,
    `import { x } from "@convex-dev/anything";`,
    `import "convex/react";`,
    `const m = require("convex/server");`,
    `const m = await import("convex/values");`,
    `export * from "convex/server";`,
    `import { useQuery } from "../../node_modules/convex/dist/esm/react/index.js";`,
    `import { useQuery } from "node_modules/convex/react";`,
    `client.onPaginatedUpdate(q, {}, cb);`,
    `client.watchQuery_experimental(q, {});`,
  ])("vangt: %s", (text) => {
    expect(detect(text)).toBe(true);
  });

  it.each([
    `import { useConvexAuth, useMutation, useAction } from "convex/react";`,
    `import { ConvexProviderWithClerk } from "convex/react-clerk";`,
    `import { ConvexReactClient } from "convex/react";`,
    `import type { FunctionReference } from "convex/server";`,
    `import type { OptionalRestArgsOrSkip } from "convex/react";`,
    `import { type OptionalRestArgsOrSkip, useMutation } from "convex/react";`,
    `import { api } from "../convexApi";`,
    // F10: de allowlist
    `import { ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";`,
    `import { useConvexAuth, useMutation, useAction, ConvexReactClient } from "convex/react";`,
    `import { anyApi } from "convex/server";`,
    `import { getFunctionName, type FunctionReference } from "convex/server";`,
    `import { ConvexError } from "convex/values";`,
    `import type { BaseConvexClient } from "convex/browser";`,
    `import { type ConvexClient } from "convex/browser";`,
    `import type { Doc } from "../../../convex/_generated/dataModel";`,
    `import { api } from "../../convex/_generated/api";`,
    `import { useQuery } from "@tanstack/react-query";`,
    `const user = await useConvex().query(api.users.current, {});`,
    `const s = useConvex().connectionState();`,
    `useConvex().subscribeToConnectionState(cb);`,
    `// useQuery uit convex/react mag hier niet\nconst x = 1;`,
    `const label = "useQuery";`,
  ])("laat toe: %s", (text) => {
    expect(detect(text)).toBe(false);
  });
});

// F6: wie de melding van "reconnecting" toont, toont ook Uitloggen. Anders zit
// de user vast bij een blijvende tokenfout met netwerk.
describe("reconnecting heeft altijd Uitloggen (F6)", () => {
  const users = files.filter((f) =>
    moduleUses(parse(read(f), f)).some(
      (u) => /(^|\/)lib\/reconnectView$/.test(u.module) && (u.whole || u.names.includes("reconnectView")),
    ),
  );

  it("de melding komt uit src/lib/reconnectView", () => {
    expect(users.length).toBeGreaterThan(0);
  });

  it("elk bestand dat reconnectView gebruikt, rendert SignOutButton", () => {
    const missing = users.filter((f) => {
      const sf = parse(read(f), f);
      const imported = moduleUses(sf).some(
        (u) => /(^|\/)auth\/SignOutButton$/.test(u.module) && u.names.includes("SignOutButton"),
      );
      return !imported || !/<SignOutButton\b/.test(read(f));
    });
    expect(missing).toEqual([]);
  });
});

describe("detectie: wie importeert wat uit het toegangspad (F2)", () => {
  it.each([
    [`import { useSessionQuery } from "../data/useLiveQuery";`, "src/screens/X.tsx"],
    [`import { useLiveQuery, useSessionQuery } from "../../data/useLiveQuery";`, "src/app/(tabs)/x.tsx"],
    [`import * as live from "../data/useLiveQuery";`, "src/screens/X.tsx"],
    [`import { useSessionQuery as q } from "./useLiveQuery";`, "src/data/other.ts"],
    [`export * from "../data/useLiveQuery";`, "src/screens/index.ts"],
    [`import { useSessionQuery } from "@/data/useLiveQuery";`, "src/screens/X.tsx"],
  ])("vangt: %s (in %s)", (text, from) => {
    expect(accessPathViolations(text, from).length).toBeGreaterThan(0);
  });

  it.each([
    [`import { useLiveQuery } from "../data/useLiveQuery";`, "src/screens/X.tsx"],
    [`import { useLiveQuery as live } from "../../../data/useLiveQuery";`, "src/app/(tabs)/profiel/index.tsx"],
    [`import { useSessionQuery } from "../other/useLiveQuery";`, "src/screens/X.tsx"],
  ])("laat toe: %s (in %s)", (text, from) => {
    expect(accessPathViolations(text, from)).toEqual([]);
  });
});
