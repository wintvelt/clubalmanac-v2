import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { refusalOf } from "../src/lib/groupAdmin";
import { filmProjectPath, newFilmProjectPath } from "../src/lib/groupRoutes";
import { originalPosterUrl } from "../src/lib/imageUrls";
import { PUBLIC_PATHS, routeAccess } from "../src/lib/routeAccess";
import { listFiles } from "./support/sourceScan";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (rel: string) => (existsSync(SRC + rel) ? readFileSync(SRC + rel, "utf8") : "");

// WP38c — de routes en de randen van het filmproject buiten de eigen module.
//   - 38c-19: de projectpagina onder de groep, starten modaal naast "Nieuw
//     album", met een web-variant ("Alleen in de app", WP35 W5). Beide
//     afgeschermd (geen publiek pad).
//   - De poster van een inzending via het eigen beeldpad van 38a
//     (`/beeld/inzending/<id>`), nooit via `/beeld/foto/`.
//   - Blind spot 8 (besluit 17): "Album verwijderen" van het filmalbum van een
//     open project geeft `FILM_PROJECT_OPEN`; de app zegt "Sluit eerst het
//     filmproject".
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38c.

const APP_DIR = fileURLToPath(new URL("../src/app", import.meta.url));
const files = existsSync(APP_DIR) ? listFiles(APP_DIR, new Set()) : [];
const HOME = "(tabs)/(home)/";

function homeRoutes(webOnly: boolean): string[] {
  return files
    .filter((f) => f.startsWith(HOME) && /\.[jt]sx?$/.test(f) && !/(^|\/)_layout\.[jt]sx?$/.test(f))
    .filter((f) => /\.web\.[jt]sx?$/.test(f) === webOnly)
    .map((f) => "/" + f.slice(HOME.length).replace(/(\.web)?\.[jt]sx?$/, "").replace(/(^|\/)index$/, ""))
    .map((p) => (p === "/" ? "/" : p.replace(/\/$/, "")));
}

describe("paden (38c-19)", () => {
  it("filmProjectPath", () => {
    expect(filmProjectPath("g1", "p1")).toBe("/groep/g1/filmproject/p1");
    expect(filmProjectPath("g 1", "p/1")).toBe("/groep/g%201/filmproject/p%2F1");
  });

  it("newFilmProjectPath", () => {
    expect(newFilmProjectPath("g1")).toBe("/groep/g1/nieuw-filmproject");
  });

  it.each([
    ["de projectpagina", () => filmProjectPath("g1", "p1")],
    ["starten", () => newFilmProjectPath("g1")],
  ] as const)("%s is niet publiek", (_name, pathOf) => {
    const path = pathOf();
    expect(PUBLIC_PATHS.has(path)).toBe(false);
    expect(routeAccess(path, "ready")).toBe("show");
    expect(routeAccess(path, "signedOut")).toBe("login");
  });
});

describe("routebestanden (38c-19)", () => {
  it("de projectpagina: /groep/[groupId]/filmproject/[projectId]", () => {
    expect(homeRoutes(false)).toContain("/groep/[groupId]/filmproject/[projectId]");
  });

  it("starten: /groep/[groupId]/nieuw-filmproject, met een web-variant (alleen in de app)", () => {
    expect(homeRoutes(false)).toContain("/groep/[groupId]/nieuw-filmproject");
    expect(homeRoutes(true)).toContain("/groep/[groupId]/nieuw-filmproject");
  });
});

describe("de poster van een inzending", () => {
  it("via /beeld/inzending/<id>, met het formaat", () => {
    const site = "https://example-123.eu-west-1.convex.site";
    expect(originalPosterUrl(site, "o1", "klein")).toBe(`${site}/beeld/inzending/o1?formaat=klein`);
    expect(originalPosterUrl(site, "o/1", "groot")).toBe(`${site}/beeld/inzending/o%2F1?formaat=groot`);
  });
});

describe("album verwijderen tijdens een open project (besluit 17)", () => {
  it("FILM_PROJECT_OPEN: 'Sluit eerst het filmproject'", () => {
    const r = refusalOf(new ConvexError({ code: "FILM_PROJECT_OPEN" }), "deleteAlbum");
    expect(r.field).toBe("general");
    expect(r.text).toContain("Sluit eerst het filmproject");
  });
});

describe("de knop 'Filmproject starten' in de schermen (besluit 1 na A)", () => {
  it("Icon kent 'key'", () => {
    expect(read("components/Icon.tsx")).toMatch(/\bkey:\s*"key"/);
  });

  it("een scherm gebruikt START_BUTTON (icoon en label uit de pure module)", () => {
    const screens = listFiles(SRC + "screens", new Set()).filter((f) => /\.tsx?$/.test(f));
    expect(screens.some((f) => read("screens/" + f).includes("START_BUTTON"))).toBe(true);
  });
});

describe("filmpje verwijderen noemt het origineel (besluit 16, besluit 7 na A)", () => {
  it("de bevestiging in het menu heeft de zin over het origineel", () => {
    const text = read("screens/PhotoMenu.tsx") + read("lib/photoActions.ts");
    expect(text).toContain("Is het ingestuurd voor een filmproject, dan gaat het origineel ook weg.");
  });
});
