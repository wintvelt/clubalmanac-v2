import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isScanned, listFiles, parse } from "./support/sourceScan";

// WP47 in de bron, waar de pure tests niet bij kunnen:
//   - "dev" komt uit DEV_TOOLS, niet uit een tweede regel (invariant 3). Alleen
//     devTools.ts toetst de Convex-URL; Info leest geen URL (invariant 6).
//   - Info geeft de labels mee aan versionText, uit DEV_TOOLS en testFlightBuild.
//   - iOS: een asynchrone functie `testFlight` met AppTransaction.shared, een
//     geverifieerd resultaat, omgeving sandbox, en checks op simulator en
//     provisioning-bestand (invariant 8, 12). Nooit refresh() (inlogvraag,
//     invariant 9), nooit de receipt-route (deprecated, ook waar in Xcode).
//   - Android heeft de functie niet (besluit 3).
// Spec: docs/work-packages/WP47-versielabel.md §Spec-criticus aanvullingen.

const APP = fileURLToPath(new URL("../", import.meta.url));
const MODULE_DIR = join(APP, "modules", "clubalmanac-video");

function filesUnder(dir: string, ext: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, ext));
    else if (ext.test(name)) out.push(full);
  }
  return out;
}

const swiftText = () => filesUnder(join(MODULE_DIR, "ios"), /\.swift$/).map((f) => readFileSync(f, "utf8")).join("\n");
const kotlinText = () =>
  filesUnder(join(MODULE_DIR, "android"), /\.(kt|java)$/).map((f) => readFileSync(f, "utf8")).join("\n");

/** Zonder commentaar, zodat een uitleg in een comment niet telt. */
const stripSwiftComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** De broncode onder src/, als pad en tekst. */
function sources(): { rel: string; sf: ts.SourceFile }[] {
  const root = join(APP, "src");
  return listFiles(root)
    .filter((rel) => isScanned(rel))
    .map((rel) => ({ rel, sf: parse(readFileSync(join(root, rel), "utf8"), rel) }));
}

/** Aanroepen `naam(…)` in een bestand, met het aantal argumenten. */
function calls(sf: ts.SourceFile, name: string): number[] {
  const out: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const id = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (id === name) out.push(node.arguments.length);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function mentions(sf: ts.SourceFile, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === name) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("WP47: één bron voor dev (invariant 3, 6)", () => {
  it("alleen devTools.ts toetst of de build tegen dev praat", () => {
    const callers = sources()
      .filter(({ sf }) => calls(sf, "isDevDeployment").length > 0)
      .map(({ rel }) => rel);
    expect(callers).toEqual(["data/devTools.ts"]);
  });

  it("Info leest geen Convex-URL", () => {
    const text = readFileSync(join(APP, "src", "screens", "InfoList.tsx"), "utf8");
    expect(text).not.toMatch(/EXPO_PUBLIC_CONVEX_URL|convex\.cloud|isDevDeployment/);
  });
});

describe("WP47: Info toont de labels", () => {
  it("buildLabels krijgt DEV_TOOLS en het antwoord van testFlightBuild", () => {
    const users = sources().filter(({ sf }) => calls(sf, "buildLabels").length > 0);
    expect(users.map((u) => u.rel), "niemand roept buildLabels aan").not.toEqual([]);
    for (const { rel, sf } of users) {
      expect(mentions(sf, "DEV_TOOLS"), `${rel}: DEV_TOOLS`).toBe(true);
      expect(mentions(sf, "testFlightBuild"), `${rel}: testFlightBuild`).toBe(true);
    }
  });

  it("AppIdentity geeft labels mee aan versionText", () => {
    const sf = parse(readFileSync(join(APP, "src", "screens", "InfoList.tsx"), "utf8"), "InfoList.tsx");
    expect(calls(sf, "versionText")).toContain(3);
  });
});

describe("WP47: TestFlight op iOS (invariant 8, 9, 12)", () => {
  it("een asynchrone functie testFlight", () => {
    expect(stripSwiftComments(swiftText())).toMatch(/\bAsyncFunction\s*\(\s*"testFlight"/);
  });

  it("met AppTransaction.shared, geverifieerd, omgeving sandbox", () => {
    const swift = stripSwiftComments(swiftText());
    expect(swift).toMatch(/\bimport\s+StoreKit\b/);
    expect(swift).toMatch(/\bAppTransaction\s*\.\s*shared\b/);
    expect(swift).toMatch(/\.verified\b/);
    expect(swift).toMatch(/\.sandbox\b/);
  });

  it("nooit in de simulator, nooit een build met eigen provisioning-bestand", () => {
    const swift = stripSwiftComments(swiftText());
    expect(swift).toMatch(/targetEnvironment\s*\(\s*simulator\s*\)/);
    expect(swift).toMatch(/embedded(\.mobileprovision|"\s*,\s*ofType:\s*"mobileprovision")/);
  });

  it("geen inlogvraag en geen receipt-route", () => {
    const swift = stripSwiftComments(swiftText());
    expect(swift).not.toMatch(/AppTransaction\s*\.\s*refresh\b/);
    expect(swift).not.toMatch(/appStoreReceiptURL|sandboxReceipt/);
  });
});

describe("WP47: Android heeft geen TestFlight (besluit 3)", () => {
  it("de Kotlin-kant geeft geen functie testFlight", () => {
    expect(kotlinText()).not.toMatch(/\b(?:Async)?Function\s*\(\s*"testFlight"/);
  });
});
