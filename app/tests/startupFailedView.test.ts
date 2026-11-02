import { describe, expect, it } from "vitest";
import { startupFailedView } from "../src/lib/startupFailedView";

// WP15a F15 (R4-3): de tekst van startupFailed volgt de oorzaak. Een blijvende
// fout van Clerk (geen netwerkfout) is geen "server niet bereikbaar", en
// "Opnieuw" geeft dan steeds dezelfde fout. Daarom is er altijd ook een
// uitweg: alles lokaal wissen (F13) en naar het inlogscherm.

type Input = Parameters<typeof startupFailedView>[0];

const CLERK = ["loading", "ready", "degraded", "error"] as const;
const INTERNET = /internet|netwerk|wifi|wi-fi/i;
const AUTO_RETRY = /zodra|vanzelf|automatisch|straks weer/i;
const UNREACHABLE = /niet bereikbaar|onbereikbaar/i;

const text = (input: Input) => {
  const v = startupFailedView(input);
  return `${v.title} ${v.message}`;
};

describe("startupFailedView — altijd Opnieuw en een uitweg", () => {
  it("in elke combinatie van netwerk en Clerk-status", () => {
    for (const online of [true, false, null])
      for (const clerkStatus of CLERK) {
        const v = startupFailedView({ online, clerkStatus });
        expect(v.retry).toBe("enabled");
        expect(v.reset).toBe("enabled");
        expect(v.title.trim()).not.toBe("");
        expect(v.message.trim()).not.toBe("");
      }
  });
});

describe("startupFailedView — offline", () => {
  it.each([false, null])("netwerk %s: soort offline, wat Clerk ook zegt", (online) => {
    for (const clerkStatus of CLERK) expect(startupFailedView({ online, clerkStatus }).kind).toBe("offline");
  });

  it("noemt internet en belooft een nieuwe poging zodra er netwerk is", () => {
    expect(text({ online: false, clerkStatus: "error" })).toMatch(INTERNET);
    expect(text({ online: false, clerkStatus: "error" })).toMatch(AUTO_RETRY);
  });
});

describe("startupFailedView — online, Clerk geeft een fout", () => {
  it("soort startupError", () => {
    expect(startupFailedView({ online: true, clerkStatus: "error" }).kind).toBe("startupError");
  });

  it("noemt geen internet, zegt niet 'niet bereikbaar', belooft geen automatische poging", () => {
    const t = text({ online: true, clerkStatus: "error" });
    expect(t).not.toMatch(INTERNET);
    expect(t).not.toMatch(UNREACHABLE);
    expect(t).not.toMatch(AUTO_RETRY);
  });
});

describe("startupFailedView — online, de time-out liep af", () => {
  it.each(["loading", "ready", "degraded"] as const)("Clerk %s: soort serverSlow", (clerkStatus) => {
    expect(startupFailedView({ online: true, clerkStatus }).kind).toBe("serverSlow");
  });

  it("noemt geen internet en belooft geen automatische poging", () => {
    const t = text({ online: true, clerkStatus: "loading" });
    expect(t).not.toMatch(INTERNET);
    expect(t).not.toMatch(AUTO_RETRY);
  });
});

describe("startupFailedView — elke soort heeft een eigen tekst", () => {
  it("offline, startupError en serverSlow verschillen", () => {
    const texts = new Set([
      text({ online: false, clerkStatus: "loading" }),
      text({ online: true, clerkStatus: "error" }),
      text({ online: true, clerkStatus: "loading" }),
    ]);
    expect(texts.size).toBe(3);
  });
});
