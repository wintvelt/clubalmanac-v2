import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WP13 invariant 2: de convex-client in de app is dezelfde versie als die in de
// root, waarmee convex/_generated gemaakt is. De app importeert
// convex/_generated uit de root; die bestanden lossen `convex/*` op uit de
// root-node_modules, de app-runtime uit app/node_modules. Lopen de versies
// uiteen, dan praten types en client langs elkaar heen.
//
// Gemeten op de lockfiles: die bepalen wat `npm ci` installeert, in CI en lokaal.

function lockedConvexVersion(lockfileUrl: URL): string | undefined {
  const lock = JSON.parse(readFileSync(lockfileUrl, "utf8")) as {
    packages?: Record<string, { version?: string }>;
  };
  return lock.packages?.["node_modules/convex"]?.version;
}

const ROOT_LOCK = new URL("../../package-lock.json", import.meta.url);
const APP_LOCK = new URL("../package-lock.json", import.meta.url);

describe("convex-versie (invariant 2)", () => {
  it("root-lockfile zet convex vast", () => {
    expect(lockedConvexVersion(ROOT_LOCK)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("app-lockfile zet dezelfde convex-versie vast als de root", () => {
    expect(lockedConvexVersion(APP_LOCK)).toBe(lockedConvexVersion(ROOT_LOCK));
  });
});
