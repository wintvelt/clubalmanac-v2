import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { screenQueryIsLive, sessionQueryIsLive } from "../src/lib/liveQuery";
import type { SessionState } from "../src/lib/sessionState";

// WP15a invarianten 5, 12, 13 + 14, en F1 + F2: loopt een live query, ja of nee?
// Live alleen voor het scherm in beeld, zolang de app actief is, en alleen
// met een geldige sessie. Alles wat niet expliciet "ja" is, is "nee".

const AUTH_STATES: SessionState[] = [
  "loading",
  "signedOut",
  "convexAuthFailed",
  "noUserRow",
  "reconnecting",
  "ready",
];

// De waarden van React Native AppState, plus een die er (nog) niet is.
const APP_STATES = ["active", "background", "inactive", "unknown", "extension"];
const NOT_ACTIVE = ["background", "inactive", "unknown", "extension", "", "Active", "iets-nieuws"];

describe("screenQueryIsLive — het scherm in beeld", () => {
  it("live: focus, app actief, sessie ready", () => {
    expect(
      screenQueryIsLive({ focused: true, appState: "active", authState: "ready" }),
    ).toBe(true);
  });

  it("niet live zonder focus (andere tab, onderliggend stack-scherm, scherm onder een modaal)", () => {
    expect(
      screenQueryIsLive({ focused: false, appState: "active", authState: "ready" }),
    ).toBe(false);
  });

  it.each(NOT_ACTIVE)("niet live bij AppState %j, ook met focus en sessie", (appState) => {
    expect(screenQueryIsLive({ focused: true, appState, authState: "ready" })).toBe(false);
  });

  it.each(AUTH_STATES.filter((s) => s !== "ready"))(
    "niet live bij auth %s, ook met focus en app actief",
    (authState) => {
      expect(screenQueryIsLive({ focused: true, appState: "active", authState })).toBe(false);
    },
  );

  it("reconnecting (F1): niet live, Convex heeft dan geen identiteit", () => {
    expect(
      screenQueryIsLive({ focused: true, appState: "active", authState: "reconnecting" }),
    ).toBe(false);
  });

  it("terug uit de achtergrond: weer live zonder iets anders te veranderen", () => {
    const base = { focused: true, authState: "ready" as const };
    expect(screenQueryIsLive({ ...base, appState: "background" })).toBe(false);
    expect(screenQueryIsLive({ ...base, appState: "active" })).toBe(true);
  });

  it("volledig: live precies bij focus × active × ready", () => {
    for (const focused of [true, false])
      for (const appState of APP_STATES)
        for (const authState of AUTH_STATES) {
          const expected = focused && appState === "active" && authState === "ready";
          expect(screenQueryIsLive({ focused, appState, authState })).toBe(expected);
        }
  });
});

describe("sessionQueryIsLive — de query achter de auth-poort (users.current)", () => {
  type Input = Parameters<typeof sessionQueryIsLive>[0];

  // De functienaam zoals getFunctionName(api.users.current) hem geeft.
  const LIVE: Input = {
    query: "users:current",
    appState: "active",
    clerkLoaded: true,
    clerkSignedIn: true,
    convexAuthLoading: false,
    convexAuthenticated: true,
  };

  it("live: app actief, Clerk ingelogd, Convex akkoord", () => {
    expect(sessionQueryIsLive(LIVE)).toBe(true);
  });

  it.each(NOT_ACTIVE)("niet live bij AppState %j: ook deze query pauzeert", (appState) => {
    expect(sessionQueryIsLive({ ...LIVE, appState })).toBe(false);
  });

  it("niet live zolang Clerk niet geladen is", () => {
    expect(sessionQueryIsLive({ ...LIVE, clerkLoaded: false })).toBe(false);
  });

  it("niet live als Clerk uitgelogd is, ook als Convex nog akkoord zegt", () => {
    expect(sessionQueryIsLive({ ...LIVE, clerkSignedIn: false })).toBe(false);
  });

  it("niet live zolang Convex het token nog controleert", () => {
    expect(sessionQueryIsLive({ ...LIVE, convexAuthLoading: true })).toBe(false);
  });

  it("niet live als Convex het token weigert", () => {
    expect(sessionQueryIsLive({ ...LIVE, convexAuthenticated: false })).toBe(false);
  });

  // F2: buiten focus om mag alleen users.current lopen. Een scherm dat de
  // sessie-route gebruikt met een andere query, krijgt nooit live data.
  it.each([
    "groups:list",
    "users:currentX",
    "xusers:current",
    "users/current",
    "users:current:extra",
    "",
  ])("andere query %j: nooit live, ook als de rest klopt", (query) => {
    expect(sessionQueryIsLive({ ...LIVE, query })).toBe(false);
  });

  it("volledig: live precies als alles klopt", () => {
    const bools = [true, false];
    for (const query of ["users:current", "groups:list"])
      for (const appState of APP_STATES)
        for (const clerkLoaded of bools)
          for (const clerkSignedIn of bools)
            for (const convexAuthLoading of bools)
              for (const convexAuthenticated of bools) {
                const expected =
                  query === "users:current" &&
                  appState === "active" &&
                  clerkLoaded &&
                  clerkSignedIn &&
                  !convexAuthLoading &&
                  convexAuthenticated;
                expect(
                  sessionQueryIsLive({
                    query,
                    appState,
                    clerkLoaded,
                    clerkSignedIn,
                    convexAuthLoading,
                    convexAuthenticated,
                  }),
                ).toBe(expected);
              }
  });
});

// WP19b fix-cyclus 1, S5 (A-invariant 21; besluit 3: bewuste afwijking op
// WP15a F2). Buiten focus om lopen precies twee queries: users.current en
// users.signupState. Een derde laat deze test falen, ook als hij later in de
// backend bijkomt. Gemeten tegen elke publieke query in convex/, plus de
// aanroepen in de poort.
describe("sessionQueryIsLive — precies twee sessie-queries (WP19b S5)", () => {
  const SESSION = ["users:current", "users:signupState"];
  const LIVE = {
    appState: "active",
    clerkLoaded: true,
    clerkSignedIn: true,
    convexAuthLoading: false,
    convexAuthenticated: true,
  };
  const CONVEX = fileURLToPath(new URL("../../convex", import.meta.url));

  function publicQueries(dir: string, prefix = ""): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith("_") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...publicQueries(full, `${prefix}${entry.name}/`));
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        const mod = `${prefix}${entry.name.slice(0, -3)}`;
        for (const m of readFileSync(full, "utf8").matchAll(/export\s+const\s+(\w+)\s*=\s*query\s*\(/g)) {
          out.push(`${mod}:${m[1]}`);
        }
      }
    }
    return out;
  }

  const all = publicQueries(CONVEX);

  it("de scan vindt de publieke queries, waaronder de twee sessie-queries", () => {
    expect(all.length).toBeGreaterThan(10);
    for (const q of SESSION) expect(all).toContain(q);
  });

  it("live met alles in orde: alleen users:current en users:signupState", () => {
    const live = all.filter((query) => sessionQueryIsLive({ ...LIVE, query }));
    expect(live.sort()).toEqual([...SESSION].sort());
  });

  it("users:signupState pauzeert net als users:current", () => {
    const query = "users:signupState";
    expect(sessionQueryIsLive({ ...LIVE, query })).toBe(true);
    expect(sessionQueryIsLive({ ...LIVE, query, appState: "background" })).toBe(false);
    expect(sessionQueryIsLive({ ...LIVE, query, clerkSignedIn: false })).toBe(false);
    expect(sessionQueryIsLive({ ...LIVE, query, convexAuthenticated: false })).toBe(false);
  });

  it("de poort roept de sessie-route aan met precies die twee queries", () => {
    const gate = readFileSync(fileURLToPath(new URL("../src/AuthGate.tsx", import.meta.url)), "utf8");
    const used = [...gate.matchAll(/useSessionQuery\(\s*api\.(\w+)\.(\w+)/g)].map((m) => `${m[1]}:${m[2]}`);
    expect([...new Set(used)].sort()).toEqual([...SESSION].sort());
  });
});
