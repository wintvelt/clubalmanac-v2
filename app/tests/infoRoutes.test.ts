import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { INFO_PAGES, infoPath } from "../src/lib/infoPages";
import { PUBLIC_PATHS, routeAccess } from "../src/lib/routeAccess";
import type { GateState } from "../src/lib/startupState";
import { listFiles, moduleUses, parse } from "./support/sourceScan";

// WP15b invarianten 4, 7 en 11, A-punt 4 en §Routes. Info is ingelogd en
// uitgelogd hetzelfde: per pagina één scherm op twee routes, `/info/<slug>`
// (publiek, alleen uitgelogd) en `/instellingen/<slug>` (ingelogd). De
// Info-schermen lezen geen user-gegevens, ook niet via wat ze importeren.
// Profiel heeft een eigen live query, users.profile, via useLiveQuery.

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const APP_DIR = join(SRC, "app");
const SLUGS = ["over", "privacy", "voorwaarden"];

// --- INFO_PAGES en infoPath -------------------------------------------------

describe("INFO_PAGES", () => {
  it("zijn over, privacy en voorwaarden", () => {
    expect(INFO_PAGES.map((p) => p.slug).sort()).toEqual([...SLUGS].sort());
  });

  it("elke pagina heeft een titel", () => {
    for (const page of INFO_PAGES) expect(page.title.trim().length).toBeGreaterThan(0);
  });
});

describe("infoPath", () => {
  it.each(SLUGS)("%s: ingelogd onder /instellingen, uitgelogd onder /info", (slug) => {
    expect(infoPath(slug, true)).toBe(`/instellingen/${slug}`);
    expect(infoPath(slug, false)).toBe(`/info/${slug}`);
  });
});

// --- PUBLIC_PATHS en routeAccess -----------------------------------------------

const SIGNED_OUT_INFO = ["/info", ...SLUGS.map((s) => `/info/${s}`)];
const SIGNED_IN_INFO = SLUGS.map((s) => `/instellingen/${s}`);

describe("PUBLIC_PATHS (invariant 4)", () => {
  it("is /inloggen plus de Info-paden voor wie uitgelogd is", () => {
    expect([...PUBLIC_PATHS].sort()).toEqual(["/inloggen", ...SIGNED_OUT_INFO].sort());
  });

  it("de ingelogde Info-paden zijn niet publiek", () => {
    for (const path of SIGNED_IN_INFO) expect(PUBLIC_PATHS.has(path)).toBe(false);
  });
});

describe("routeAccess — Info uitgelogd", () => {
  it.each(SIGNED_OUT_INFO)("%s: uitgelogd tonen", (path) => {
    expect(routeAccess(path, "signedOut")).toBe("show");
    expect(routeAccess(`${path}/`, "signedOut")).toBe("show");
  });

  it.each(SIGNED_OUT_INFO)("%s: ingelogd naar Home, zoals /inloggen", (path) => {
    expect(routeAccess(path, "ready")).toBe("home");
    expect(routeAccess(path, "reconnecting")).toBe("home");
  });

  it.each(SIGNED_OUT_INFO)("%s: laden wachten, en de statusschermen blijven", (path) => {
    const cases: [GateState, string][] = [
      ["loading", "wait"],
      ["convexAuthFailed", "convexAuthFailed"],
      ["noUserRow", "noUserRow"],
      ["startupFailed", "startupFailed"],
    ];
    for (const [state, expected] of cases) expect(routeAccess(path, state)).toBe(expected);
  });

  it.each(["/info/bestaat-niet", "/info-x", "/infox", "/info/privacy/extra"])(
    "%s is niet publiek",
    (path) => {
      expect(routeAccess(path, "signedOut")).toBe("login");
    },
  );
});

describe("routeAccess — Info ingelogd", () => {
  it.each(SIGNED_IN_INFO)("%s: ingelogd tonen, uitgelogd het inlogscherm", (path) => {
    expect(routeAccess(path, "ready")).toBe("show");
    expect(routeAccess(path, "signedOut")).toBe("login");
  });
});

// --- Routebestanden ---------------------------------------------------------------

const ROUTE_EXT = /\.[jt]sx?$/;
const NOT_A_ROUTE = /(^|\/)(_layout|\+html|\+native-intent|\+middleware)\.[jt]sx?$|\+api\.[jt]sx?$/;

// Het URL-pad van een routebestand: groepen `(x)` en `index` tellen niet mee.
function urlOf(route: string): string | null {
  const segments = route.replace(ROUTE_EXT, "").split("/");
  if (segments.some((s) => s.startsWith("+"))) return null;
  const kept = segments.filter((s) => !/^\(.+\)$/.test(s));
  if (kept[kept.length - 1] === "index") kept.pop();
  return "/" + kept.join("/");
}

const routeFiles = (existsSync(APP_DIR) ? listFiles(APP_DIR, new Set()) : []).filter(
  (f) => ROUTE_EXT.test(f) && !f.endsWith(".d.ts") && !NOT_A_ROUTE.test(f),
);

function routeFileFor(url: string): string | undefined {
  const matches = routeFiles.filter((f) => urlOf(f) === url);
  return matches.length === 1 ? join(APP_DIR, matches[0]!) : undefined;
}

describe("routebestanden voor Info", () => {
  it.each([...SIGNED_OUT_INFO, ...SIGNED_IN_INFO])("%s heeft precies één routebestand", (url) => {
    expect(routeFileFor(url), url).toBeDefined();
  });
});

// --- Wat een scherm importeert ----------------------------------------------------

const RESOLVE_EXT = [".tsx", ".ts", ".jsx", ".js"];

function resolveLocal(fromFile: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const base = normalize(join(dirname(fromFile), spec));
  const candidates = [
    base,
    ...RESOLVE_EXT.map((e) => base + e),
    ...RESOLVE_EXT.map((e) => join(base, "index" + e)),
  ];
  return candidates.find((c) => existsSync(c) && ROUTE_EXT.test(c));
}

// Alle eigen bestanden die `start` (transitief) importeert, `start` zelf ook.
function closure(start: string): string[] {
  const seen = new Set<string>();
  const todo = [start];
  while (todo.length > 0) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const sf = parse(readFileSync(file, "utf8"), file);
    for (const use of moduleUses(sf)) {
      const next = resolveLocal(file, use.module);
      if (next) todo.push(next);
    }
  }
  return [...seen];
}

const rel = (file: string) => relative(SRC, file).split(sep).join("/");

// Gebruikt dit bestand iets waarmee een scherm user-gegevens krijgt?
const CLERK_USER_HOOKS = new Set(["useUser", "useSession", "useSessionList", "useOrganization"]);
const LIVE_HOOKS = new Set(["useLiveQuery", "useSessionQuery"]);

function userDataUses(file: string): string[] {
  const sf = parse(readFileSync(file, "utf8"), file);
  const out: string[] = [];
  for (const use of moduleUses(sf)) {
    if (/(^|\/)convexApi$/.test(use.module)) out.push(`importeert ${use.module}`);
    if (use.module === "convex/react") out.push("importeert convex/react");
    if (/(^|\/)useLiveQuery$/.test(use.module)) out.push(`importeert ${use.module}`);
    if (use.module.startsWith("@clerk/")) {
      if (use.whole) out.push(`importeert heel ${use.module}`);
      for (const n of use.names) if (CLERK_USER_HOOKS.has(n)) out.push(`${n} uit ${use.module}`);
    }
  }
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && LIVE_HOOKS.has(n.text)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...new Set(out)];
}

describe("Info-schermen lezen geen user-gegevens (invariant 11)", () => {
  const starts = [...SIGNED_OUT_INFO, ...SIGNED_IN_INFO].map(routeFileFor);

  it("alle Info-routebestanden zijn gevonden", () => {
    expect(starts.filter(Boolean)).toHaveLength(SIGNED_OUT_INFO.length + SIGNED_IN_INFO.length);
  });

  it("geen live query, geen api, geen Clerk-user, ook niet in wat ze importeren", () => {
    const found: string[] = [];
    for (const start of starts) {
      if (!start) continue;
      for (const file of closure(start)) {
        for (const v of userDataUses(file)) found.push(`${rel(start)} → ${rel(file)}: ${v}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("de scan ziet een live query als die er wel is (zelftest)", () => {
    const authGate = join(SRC, "AuthGate.tsx");
    expect(closure(authGate).flatMap(userDataUses).length).toBeGreaterThan(0);
  });

  it("Screen (met useAuthState) is toegestaan: geen melding voor de componenten", () => {
    expect(userDataUses(join(SRC, "components", "Screen.tsx"))).toEqual([]);
  });
});

// --- Profiel: een eigen live query (invariant 7) ------------------------------------

function liveQueryArgs(file: string, hook: string): string[] {
  const sf = parse(readFileSync(file, "utf8"), file);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === hook) {
      const first = n.arguments[0];
      if (first) out.push(first.getText(sf).replace(/\s+/g, ""));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("Profiel heeft een eigen live query (invariant 7)", () => {
  it("de route /profiel gebruikt useLiveQuery met api.users.profile", () => {
    const start = routeFileFor("/profiel");
    expect(start).toBeDefined();
    const args = closure(start!).flatMap((f) => liveQueryArgs(f, "useLiveQuery"));
    expect(args).toContain("api.users.profile");
  });

  it("de route /profiel gebruikt users.current niet als live query", () => {
    const start = routeFileFor("/profiel");
    expect(start).toBeDefined();
    const args = closure(start!).flatMap((f) => liveQueryArgs(f, "useLiveQuery"));
    expect(args).not.toContain("api.users.current");
  });

  it("api.users.profile gaat nergens via useSessionQuery (dan zou hij buiten focus lopen)", () => {
    const all = listFiles(SRC, new Set())
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts"))
      .map((f) => join(SRC, f));
    const args = all.flatMap((f) => liveQueryArgs(f, "useSessionQuery"));
    expect(args).not.toContain("api.users.profile");
  });
});
