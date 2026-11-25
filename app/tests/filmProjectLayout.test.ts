import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { colors } from "../src/theme/tokens";
import { parse } from "./support/sourceScan";

// Feedback Wouter, derde ronde (2026-11-25). Bronscans; het uiterlijk zelf
// toetst de gate.
//   1. Lege standen: het icoon in het verloop (`gradStart` → `gradEnd`, 135°),
//      in licht en donker gelijk. Web: CSS met `background-clip: text` in een
//      `.web`-variant. iOS en Android: `@react-native-masked-view/masked-view`
//      (een echte afhankelijkheid in app/package.json). A-keuze: één component
//      `GradientIcon` (src/components/GradientIcon.tsx en .web.tsx), die
//      EmptyState gebruikt.
//   2. Brede schermen: projectpagina en downloadpagina gebruiken de indeling
//      van de groepspagina (`useWideLayout`, `WideSplit`, `WideSide`).
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Feedback derde ronde (A).

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (rel: string) => (existsSync(SRC + rel) ? readFileSync(SRC + rel, "utf8") : "");

function functionBody(rel: string, name: string): string {
  const sf = parse(read(rel), rel.split("/").pop());
  let body = "";
  const find = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name && n.body) body = n.body.getText(sf);
    ts.forEachChild(n, find);
  };
  find(sf);
  return body;
}

describe("lege standen: het icoon in het verloop (derde ronde, punt 1)", () => {
  it("@react-native-masked-view/masked-view is een afhankelijkheid van de app", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toContain("@react-native-masked-view/masked-view");
  });

  it("EmptyState tekent het icoon met GradientIcon, niet meer in een effen kleur", () => {
    const body = functionBody("components/States.tsx", "EmptyState");
    expect(body.length, "sanity: function EmptyState").toBeGreaterThan(0);
    expect(body).toContain("<GradientIcon");
    expect(body).not.toMatch(/<Icon\b[^>]*color=\{colors\.grad(Start|End)\}/);
  });

  it("native: GradientIcon maskeert het verloop met masked-view, van gradStart naar gradEnd", () => {
    const src = read("components/GradientIcon.tsx");
    expect(src.length, "sanity: components/GradientIcon.tsx").toBeGreaterThan(0);
    expect(src).toContain("@react-native-masked-view/masked-view");
    expect(src).toMatch(/gradStart/);
    expect(src).toMatch(/gradEnd/);
  });

  it("web: GradientIcon.web gebruikt CSS met background-clip: text en een verloop van 135°", () => {
    const src = read("components/GradientIcon.web.tsx");
    expect(src.length, "sanity: components/GradientIcon.web.tsx").toBeGreaterThan(0);
    expect(src).not.toContain("@react-native-masked-view/masked-view");
    expect(src).toMatch(/(background-clip|backgroundClip|WebkitBackgroundClip)["']?\s*[:=]\s*["']text["']/);
    expect(src).toContain("linear-gradient(135deg");
    expect(src).toMatch(/gradStart/);
    expect(src).toMatch(/gradEnd/);
  });

  it("het verloop is in licht en donker gelijk (vangnet: de tokens)", () => {
    expect(colors.dark.gradStart).toBe(colors.light.gradStart);
    expect(colors.dark.gradEnd).toBe(colors.light.gradEnd);
  });
});

describe("brede schermen: projectpagina en downloadpagina zoals de groepspagina (derde ronde, punt 2)", () => {
  const FILE = "screens/FilmProjectScreens.tsx";

  it("het scherm gebruikt useWideLayout, WideSplit en WideSide", () => {
    const src = read(FILE);
    expect(src.length, `sanity: ${FILE}`).toBeGreaterThan(0);
    expect(src).toMatch(/\buseWideLayout\(/);
    expect(src).toMatch(/import\s*\{[^}]*\bWideSplit\b[^}]*\}\s*from\s*["']\.\/WideSide["']/);
    expect(src).toMatch(/import\s*\{[^}]*\bWideSide\b[^}]*\}\s*from\s*["']\.\/WideSide["']/);
  });

  it.each(["ProjectPage", "DownloadPage"])("%s kiest de brede indeling (useWideLayout en een Wide-component)", (name) => {
    const body = functionBody(FILE, name);
    expect(body.length, `sanity: function ${name}`).toBeGreaterThan(0);
    expect(body).toMatch(/\buseWideLayout\(/);
    expect(body).toMatch(/<Wide\w*/);
  });
});
