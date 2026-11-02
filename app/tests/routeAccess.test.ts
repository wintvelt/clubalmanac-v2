import { describe, expect, it } from "vitest";
import { PUBLIC_PATHS, routeAccess } from "../src/lib/routeAccess";
import type { SessionState } from "../src/lib/sessionState";

// WP15a invarianten 4, 7 + 10 en de routetabel: wat toont de app op dit pad,
// in deze auth-toestand? Alleen "ready" toont een ingelogd scherm, en
// "reconnecting" de navigator zonder live data (F1). Een pad is
// afgeschermd, tenzij het expliciet publiek is (in 15a alleen /inloggen).

const PROTECTED = [
  "/",
  "/mijn-fotos",
  "/profiel",
  "/instellingen",
  "/instellingen/over",
  "/toevoegen",
];
const LOGIN = "/inloggen";

describe("routeAccess — afgeschermde routes", () => {
  it.each(PROTECTED)("%s: tonen bij ready", (path) => {
    expect(routeAccess(path, "ready")).toBe("show");
  });

  it.each(PROTECTED)("%s: uitgelogd → inlogscherm", (path) => {
    expect(routeAccess(path, "signedOut")).toBe("login");
  });

  it.each(PROTECTED)("%s: laden → wachten, niet inloggen (deep link blijft staan)", (path) => {
    expect(routeAccess(path, "loading")).toBe("wait");
  });

  it.each(PROTECTED)("%s: Convex weigert → WP13-statusscherm", (path) => {
    expect(routeAccess(path, "convexAuthFailed")).toBe("convexAuthFailed");
  });

  it.each(PROTECTED)("%s: geen rij → WP13-statusscherm", (path) => {
    expect(routeAccess(path, "noUserRow")).toBe("noUserRow");
  });
});

// F1: tijdelijk geen token. De navigator blijft (kop, tabbalk); de schermen
// vragen dan niets live op (tests/liveQuery.test.ts).
describe("routeAccess — reconnecting (F1)", () => {
  it.each(PROTECTED)("%s: tonen, geen foutscherm en geen inlogscherm", (path) => {
    expect(routeAccess(path, "reconnecting")).toBe("show");
  });

  it("/inloggen: naar Home, want Clerk is ingelogd", () => {
    expect(routeAccess(LOGIN, "reconnecting")).toBe("home");
  });

  it("onbekend pad: tonen (Niet gevonden)", () => {
    expect(routeAccess("/bestaat-niet", "reconnecting")).toBe("show");
  });
});

describe("routeAccess — PUBLIC_PATHS (F4)", () => {
  it("is geëxporteerd en bevat in 15a alleen /inloggen", () => {
    expect([...PUBLIC_PATHS].sort()).toEqual([LOGIN]);
  });

  it("elk pad in PUBLIC_PATHS toont uitgelogd zijn scherm", () => {
    for (const path of PUBLIC_PATHS) expect(routeAccess(path, "signedOut")).toBe("show");
  });
});

describe("routeAccess — het inlogscherm", () => {
  it("uitgelogd: tonen", () => {
    expect(routeAccess(LOGIN, "signedOut")).toBe("show");
  });

  it("ingelogd: naar Home", () => {
    expect(routeAccess(LOGIN, "ready")).toBe("home");
  });

  it("laden: wachten", () => {
    expect(routeAccess(LOGIN, "loading")).toBe("wait");
  });

  it("Convex weigert of geen rij: WP13-statusscherm, niet het inlogscherm", () => {
    expect(routeAccess(LOGIN, "convexAuthFailed")).toBe("convexAuthFailed");
    expect(routeAccess(LOGIN, "noUserRow")).toBe("noUserRow");
  });
});

describe("routeAccess — onbekende paden zijn afgeschermd", () => {
  const UNKNOWN = ["/bestaat-niet", "/bestaat-niet/abc", "/instellingen/bestaat-niet"];

  it.each(UNKNOWN)("%s: uitgelogd → inlogscherm", (path) => {
    expect(routeAccess(path, "signedOut")).toBe("login");
  });

  it.each(UNKNOWN)("%s: ingelogd → tonen (het scherm Niet gevonden)", (path) => {
    expect(routeAccess(path, "ready")).toBe("show");
  });
});

describe("routeAccess — publiek is een exacte match", () => {
  it("een slash aan het eind telt niet mee", () => {
    expect(routeAccess("/inloggen/", "signedOut")).toBe("show");
    expect(routeAccess("/instellingen/", "signedOut")).toBe("login");
    expect(routeAccess("/instellingen/over/", "ready")).toBe("show");
  });

  it.each(["/inloggen-x", "/inloggenx", "/inloggen/extra", "/x/inloggen"])(
    "%s is geen inlogscherm: uitgelogd → inlogscherm, ingelogd → tonen",
    (path) => {
      expect(routeAccess(path, "signedOut")).toBe("login");
      expect(routeAccess(path, "ready")).toBe("show");
    },
  );
});

describe("routeAccess — volledig", () => {
  const STATES: SessionState[] = [
    "loading",
    "signedOut",
    "convexAuthFailed",
    "noUserRow",
    "reconnecting",
    "ready",
  ];
  const PATHS = [...PROTECTED, LOGIN, "/bestaat-niet", "/inloggen-x"];

  it("een ingelogd scherm verschijnt alleen bij ready of reconnecting (F1)", () => {
    for (const path of PATHS)
      for (const state of STATES) {
        const decision = routeAccess(path, state);
        if (path !== LOGIN && decision === "show") expect(["ready", "reconnecting"]).toContain(state);
        if (decision === "home") expect(["ready", "reconnecting"]).toContain(state);
      }
  });

  it("buiten ready en uitgelogd hangt de uitkomst niet van het pad af", () => {
    for (const state of ["loading", "convexAuthFailed", "noUserRow"] as const) {
      const decisions = new Set(PATHS.map((p) => routeAccess(p, state)));
      expect(decisions.size).toBe(1);
    }
  });
});
