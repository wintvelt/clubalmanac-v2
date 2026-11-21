import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { parse } from "./support/sourceScan";

// WP37 gate op de iPhone, A-invariant 38: na het kiezen niet een paar seconden
// een kaal of bevroren scherm.
//   De kiezer gaat dicht zodra de user kiest; `launchImageLibraryAsync` geeft
//   het resultaat pas als iOS elk gekozen origineel naar de app heeft gekopieerd
//   (Passthrough, `PHAssetResourceManager`; een origineel in iCloud eerst
//   downloaden). Dat is native werk, niet op de JS-thread, maar zonder eigen
//   toestand staat er zolang "Kies foto's", of de vorige keuze met een knop
//   "Uploaden" die de oude keuze nog zou versturen.
//   Daarom zet `pick()` vóór `launchImageLibraryAsync` een state op true, en in
//   een `finally` (gekozen, geannuleerd of mislukt) weer op false. Zolang die
//   true is, toont het scherm `<LoadingState label="Je keuze ophalen…" />` en
//   niet de lege toestand en niet de knop "Uploaden".
// Een bronscan (de TypeScript-parser): het scherm draait niet in de testruntime.
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §A-invarianten 38.

const FILE = fileURLToPath(new URL("../src/screens/AddPhotosScreen.tsx", import.meta.url));
const LABEL = "Je keuze ophalen…";

const sf = parse(readFileSync(FILE, "utf8"), "AddPhotosScreen.tsx");

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

function find<T extends ts.Node>(root: ts.Node, pred: (n: ts.Node) => n is T): T[] {
  const out: T[] = [];
  walk(root, (n) => {
    if (pred(n)) out.push(n);
  });
  return out;
}

function mentions(node: ts.Node, name: string): boolean {
  let hit = false;
  walk(node, (n) => {
    if (ts.isIdentifier(n) && n.text === name) hit = true;
  });
  return hit;
}

function isCallTo(n: ts.Node, name: string): n is ts.CallExpression {
  if (!ts.isCallExpression(n)) return false;
  const e = n.expression;
  return (ts.isIdentifier(e) && e.text === name) || (ts.isPropertyAccessExpression(e) && e.name.text === name);
}

function jsxNamed(name: string): Array<ts.JsxSelfClosingElement | ts.JsxOpeningElement> {
  return find(sf, (n): n is ts.JsxSelfClosingElement | ts.JsxOpeningElement =>
    (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === name,
  );
}

function attr(el: ts.JsxSelfClosingElement | ts.JsxOpeningElement, name: string): ts.JsxAttribute | undefined {
  return el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === name);
}

/** Staat `node` onder een voorwaarde die `name` noemt (`a && …`, `a ? … : …`, `if (a) …`)? */
function guardedBy(node: ts.Node, name: string): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isConditionalExpression(p) && mentions(p.condition, name)) return true;
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && mentions(p.left, name)) {
      return true;
    }
    if (ts.isIfStatement(p) && mentions(p.expression, name)) return true;
  }
  return false;
}

/** Een `if (… name …) return …` in het component, vóór `node`. */
function earlyReturnBefore(node: ts.Node, name: string): boolean {
  return find(sf, (n): n is ts.IfStatement => ts.isIfStatement(n)).some(
    (s) =>
      s.getStart(sf) < node.getStart(sf) &&
      mentions(s.expression, name) &&
      find(s.thenStatement, (n): n is ts.ReturnStatement => ts.isReturnStatement(n)).length > 0 &&
      // Alleen een return van het component zelf, niet een in `pick` of een andere functie.
      !find(sf, (n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "pick").some(
        (f) => s.getStart(sf) >= f.getStart(sf) && s.getEnd() <= f.getEnd(),
      ),
  );
}

// De functie `pick` (function pick() of const pick = …).
const pickFn = find(sf, (n): n is ts.FunctionDeclaration | ts.VariableDeclaration =>
  (ts.isFunctionDeclaration(n) && n.name?.text === "pick") ||
  (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "pick"),
)[0];
const launch = pickFn ? find(pickFn, (n): n is ts.CallExpression => isCallTo(n, "launchImageLibraryAsync"))[0] : undefined;

// De setter die vóór het openen van de kiezer true krijgt.
const setterBefore =
  pickFn && launch
    ? find(pickFn, (n): n is ts.CallExpression =>
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        /^set[A-Z]/.test(n.expression.text) &&
        n.arguments.length === 1 &&
        n.arguments[0]!.kind === ts.SyntaxKind.TrueKeyword &&
        n.getStart(sf) < launch.getStart(sf),
      ).map((c) => (c.expression as ts.Identifier).text)
    : [];

// Die setter moet in een finally rond de kiezer weer false krijgen.
const tries = pickFn && launch ? find(pickFn, (n): n is ts.TryStatement => ts.isTryStatement(n)) : [];
const setter = setterBefore.find((name) =>
  tries.some(
    (t) =>
      t.finallyBlock !== undefined &&
      t.tryBlock.getStart(sf) <= launch!.getStart(sf) &&
      launch!.getEnd() <= t.tryBlock.getEnd() &&
      find(t.finallyBlock, (n): n is ts.CallExpression =>
        isCallTo(n, name) && n.arguments.length === 1 && n.arguments[0]!.kind === ts.SyntaxKind.FalseKeyword,
      ).length > 0,
  ),
);

// De state bij die setter: const [x, setX] = useState(…).
const stateName = setter
  ? find(sf, (n): n is ts.VariableDeclaration =>
      ts.isVariableDeclaration(n) &&
      ts.isArrayBindingPattern(n.name) &&
      n.name.elements.length === 2 &&
      n.name.elements[1]!.getText(sf) === setter &&
      n.initializer !== undefined &&
      ts.isCallExpression(n.initializer) &&
      n.initializer.expression.getText(sf) === "useState",
    ).map((d) => ((d.name as ts.ArrayBindingPattern).elements[0] as ts.BindingElement).name.getText(sf))[0]
  : undefined;

describe("na het kiezen meteen een zichtbare toestand (A-invariant 38)", () => {
  it("sanity: pick() opent de kiezer met launchImageLibraryAsync", () => {
    expect(pickFn, "geen functie pick in AddPhotosScreen.tsx").toBeDefined();
    expect(launch, "pick() roept launchImageLibraryAsync niet aan").toBeDefined();
  });

  it("pick() zet een state op true vóór de kiezer, en in een finally rond de kiezer weer op false", () => {
    expect(setterBefore.length, "geen setX(true) vóór launchImageLibraryAsync in pick()").toBeGreaterThan(0);
    expect(setter, `geen finally rond de kiezer die ${setterBefore.join(" of ")} weer op false zet`).toBeDefined();
    expect(stateName, `geen useState bij ${setter}`).toBeDefined();
  });

  it(`zolang die state waar is: <LoadingState label="${LABEL}" />`, () => {
    const loading = jsxNamed("LoadingState").filter((el) => {
      const a = attr(el, "label");
      return a?.initializer !== undefined && ts.isStringLiteral(a.initializer) && a.initializer.text === LABEL;
    });
    expect(loading.length, `geen <LoadingState label="${LABEL}" /> in AddPhotosScreen.tsx`).toBeGreaterThan(0);
    expect(stateName).toBeDefined();
    expect(loading.some((el) => guardedBy(el, stateName!)), `LoadingState hangt niet af van ${stateName}`).toBe(true);
  });

  it("dan niet de lege toestand en niet de knop Uploaden (die zou de oude keuze versturen)", () => {
    expect(stateName).toBeDefined();
    const empty = jsxNamed("EmptyState");
    const uploadButton = jsxNamed("Button").filter((el) => attr(el, "onPress")?.initializer?.getText(sf).includes("startUpload"));
    expect(empty.length, "sanity: EmptyState staat in het scherm").toBeGreaterThan(0);
    expect(uploadButton.length, "sanity: de knop met onPress={startUpload}").toBeGreaterThan(0);
    for (const el of [...empty, ...uploadButton]) {
      const ok = guardedBy(el, stateName!) || earlyReturnBefore(el, stateName!);
      expect(ok, `<${el.tagName.getText(sf)}> verschijnt ook terwijl ${stateName} waar is`).toBe(true);
    }
  });
});
