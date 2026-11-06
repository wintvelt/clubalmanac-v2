import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { albumPath, groupPath, photoPath } from "../src/lib/groupRoutes";
import { PUBLIC_PATHS, routeAccess } from "../src/lib/routeAccess";
import { listFiles } from "./support/sourceScan";

// WP16 §Routes. Groep en Album staan in de stack van de Home-tab, met Mijn
// groepen als wortel op `/`. Ze zijn afgeschermd: geen publiek pad
// (routeFiles.test.ts bewaakt dat elk routebestand onder een Protected valt).
// De groepstabs (Albums, Leden) hebben geen eigen route.

const APP_DIR = fileURLToPath(new URL("../src/app", import.meta.url));
const files = existsSync(APP_DIR) ? listFiles(APP_DIR, new Set()) : [];

// Het pad binnen de Home-stack, zonder extensie en zonder `/index`.
const HOME = "(tabs)/(home)/";
function homeRoutes(): string[] {
  return files
    .filter((f) => f.startsWith(HOME) && /\.[jt]sx?$/.test(f) && !/(^|\/)_layout\.[jt]sx?$/.test(f))
    .map((f) => "/" + f.slice(HOME.length).replace(/\.[jt]sx?$/, "").replace(/(^|\/)index$/, ""))
    .map((p) => (p === "/" ? "/" : p.replace(/\/$/, "")));
}

describe("paden", () => {
  it("groupPath", () => {
    expect(groupPath("abc123")).toBe("/groep/abc123");
  });

  it("albumPath", () => {
    expect(albumPath("g1", "a1")).toBe("/groep/g1/album/a1");
  });

  // WP17a: het foto-detail staat onder het album, in dezelfde stack.
  it("photoPath", () => {
    expect(photoPath("g1", "a1", "p1")).toBe("/groep/g1/album/a1/foto/p1");
  });
});

describe("routebestanden in de Home-stack", () => {
  it("Mijn groepen is de wortel", () => {
    expect(homeRoutes()).toContain("/");
  });

  it("Groep: /groep/[groupId]", () => {
    expect(homeRoutes()).toContain("/groep/[groupId]");
  });

  it("Album (WP17 vult het): /groep/[groupId]/album/[albumId]", () => {
    expect(homeRoutes()).toContain("/groep/[groupId]/album/[albumId]");
  });

  it("Foto-detail (WP17a): /groep/[groupId]/album/[albumId]/foto/[photoId]", () => {
    expect(homeRoutes()).toContain("/groep/[groupId]/album/[albumId]/foto/[photoId]");
  });

  it("geen route per groepstab", () => {
    const tabs = homeRoutes().filter((p) => /^\/groep\/\[groupId\]\/(albums|leden|cover|uitnodigen)$/.test(p));
    expect(tabs).toEqual([]);
  });
});

describe("toegang", () => {
  const paths = [groupPath("g1"), albumPath("g1", "a1"), "/groep/g1/album/a1/foto/p1"];

  it.each(paths)("%s is niet publiek", (path) => {
    expect(PUBLIC_PATHS.has(path)).toBe(false);
  });

  it.each(paths)("%s: ingelogd tonen, uitgelogd naar inloggen", (path) => {
    expect(routeAccess(path, "ready")).toBe("show");
    expect(routeAccess(path, "signedOut")).toBe("login");
  });
});
