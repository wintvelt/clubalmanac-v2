import { readFileSync, existsSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRuntime } from "./support/hookRuntime";
import { parse } from "./support/sourceScan";

// WP40 gate ronde 1, besluit Wouter (herziet besluit 1 na A): tijdens de
// selectie is de tabbalk weg, zoals in de Foto's-app; de selectiebalk staat
// op die plek. Na Annuleren, of na een actie die de selectie beëindigt, komt
// hij terug. In het album en in Mijn foto's, ook op de iPad.
//
// G1 (A-keuze): de eigen tabbalk volgt de standaard-optie van de navigator om
// zich te verbergen, `tabBarStyle: { display: "none" }` op de tab in beeld,
// zoals de tabbalk van React Navigation zelf dat doet. Alleen de tab in beeld
// telt: een andere tab met die optie verbergt niets.
// G2: de schermen zetten die optie, zelf of via een gedeelde module.
// Wanneer de optie aan en weer uit gaat (selectie, unmount, uit beeld) toetsen
// audit en gate; dat is schermlogica.
//
// TabBar draait hier met tests/support/hookRuntime.ts; de componenten en de
// data zijn nep.
//
// Spec: docs/work-packages/WP40-selectiebalk.md §Gate ronde 1: A-aanvullingen.

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

const leaf = vi.hoisted(() => ({
  View: function View() {},
  Pressable: function Pressable() {},
  AnimatedPressable: function AnimatedPressable() {},
  Text: function Text() {},
  Icon: function Icon() {},
  Gradient: function Gradient() {},
}));

vi.mock("react-native", () => ({
  View: leaf.View,
  Pressable: leaf.Pressable,
  StyleSheet: {
    create: <T>(s: T) => s,
    absoluteFill: {},
    hairlineWidth: 1,
    flatten: (s: unknown) => (Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {})),
  },
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
}));
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ userId: "user_1", sessionId: "sess_1" }) }));
vi.mock("expo-router", () => ({
  router: { push: () => {}, dismissAll: () => {}, dismissTo: () => {} },
  usePathname: () => "/mijn-fotos",
  useNavigationContainerRef: () => ({ getRootState: () => undefined }),
}));
vi.mock("../src/components/Gradient", () => ({ Gradient: leaf.Gradient }));
vi.mock("../src/components/Icon", () => ({ Icon: leaf.Icon }));
vi.mock("../src/components/Motion", () => ({
  AnimatedPressable: leaf.AnimatedPressable,
  usePressMotion: () => ({ withRelease: (f: unknown) => f, onPressIn: () => {}, onPressOut: () => {}, dim: false, style: {} }),
}));
vi.mock("../src/components/Text", () => ({ Text: leaf.Text }));
vi.mock("../src/data/haptics", () => ({ successTap: () => {} }));
vi.mock("../src/data/homeGroupState", () => ({ useGroupVisit: () => null, useHomeGroup: () => ({ kind: "unknown" }) }));
vi.mock("../src/data/webPick", () => ({ startAddPick: () => {} }));
vi.mock("../src/theme", () => ({
  useTheme: () => ({
    scheme: "light",
    colors: {
      tabbar: "#fff",
      line: "#ccc",
      primary: "#00f",
      tabInactive: "#888",
      tabPill: "#eef",
      gradStart: "#00f",
      gradEnd: "#0ff",
      onGradient: "#fff",
    },
  }),
  border: { plusLight: 1.5 },
  plusButton: { shadow: { color: "#000", offsetY: 4, radius: 14, opacity: 0.26 }, ringLight: "#fff" },
  radius: { pill: 999 },
  size: { maxTextColumn: 640, tabbar: 66, tabPillWidth: 64, tabPillHeight: 32, plus: 58, plusRise: 26, touchMin: 44 },
  space: { xs: 4, s: 8, m: 12, l: 16 },
}));

const { TabBar } = await import("../src/navigation/TabBar");

const ROUTES = [
  { key: "home-k", name: "(home)" },
  { key: "fotos-k", name: "mijn-fotos" },
  { key: "profiel-k", name: "profiel" },
  { key: "inst-k", name: "instellingen" },
];

type Options = Record<string, unknown>;

function render(focused: number, options: Record<string, Options> = {}, plus = true): unknown {
  const descriptors = Object.fromEntries(ROUTES.map((r) => [r.key, { options: options[r.key] ?? {}, route: r }]));
  const props = {
    state: { index: focused, routes: ROUTES, key: "tabs", routeNames: ROUTES.map((r) => r.name), type: "tab", stale: false },
    descriptors,
    navigation: {},
    emitter: { emit: () => ({ defaultPrevented: false }) },
    navigateToTab: () => {},
    insets: { top: 59, bottom: 34, left: 0, right: 0 },
    plus,
  } as unknown as Parameters<typeof TabBar>[0];
  return rt.runtime.render(() => TabBar(props));
}

type El = { type: unknown; props: Record<string, unknown> };
const isEl = (x: unknown): x is El => typeof x === "object" && x !== null && "type" in x && "props" in x;

function flatStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.flat(Infinity).filter(Boolean).map(flatStyle));
  return typeof style === "object" && style !== null ? (style as Record<string, unknown>) : {};
}

/** Verborgen: niets, of een bovenste element met `display: "none"`. */
function hidden(out: unknown): boolean {
  if (out === null || out === undefined || out === false) return true;
  return isEl(out) && flatStyle(out.props.style).display === "none";
}

const HIDE = { tabBarStyle: { display: "none" } };

beforeEach(() => rt.runtime.unmount());

describe("G1: de tabbalk verbergt zich voor de tab in beeld", () => {
  it("zonder de optie: de tabbalk staat er", () => {
    expect(hidden(render(1))).toBe(false);
    expect(hidden(render(0))).toBe(false);
  });

  it("Mijn foto's in beeld, met de optie: weg", () => {
    expect(hidden(render(1, { "fotos-k": HIDE }))).toBe(true);
  });

  it("Home in beeld (het album), met de optie: weg", () => {
    expect(hidden(render(0, { "home-k": HIDE }))).toBe(true);
  });

  it("de optie op een andere tab verbergt niets (wissel van tab via een link)", () => {
    expect(hidden(render(2, { "home-k": HIDE }))).toBe(false);
    expect(hidden(render(0, { "fotos-k": HIDE }))).toBe(false);
  });

  it("andere stijl in tabBarStyle verbergt niets", () => {
    expect(hidden(render(1, { "fotos-k": { tabBarStyle: { backgroundColor: "red" } } }))).toBe(false);
  });

  it("de optie weer weg: de tabbalk komt terug", () => {
    expect(hidden(render(1, { "fotos-k": HIDE }))).toBe(true);
    rt.runtime.unmount();
    expect(hidden(render(1, {}))).toBe(false);
  });
});

// --- G2: de schermen zetten de optie -----------------------------------------

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

function source(rel: string): ts.SourceFile {
  return parse(readFileSync(join(SRC, rel), "utf8"), rel.split("/").pop());
}

/** Het bestand en wat het met een relatief pad importeert (één stap). */
function reach(rel: string): string[] {
  const out = [rel];
  walk(source(rel), (n) => {
    if (!ts.isImportDeclaration(n) || !ts.isStringLiteral(n.moduleSpecifier)) return;
    const spec = n.moduleSpecifier.text;
    if (!spec.startsWith(".")) return;
    const base = posix.normalize(posix.join(posix.dirname(rel), spec));
    const hit = [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((c) => existsSync(join(SRC, c)));
    if (hit) out.push(hit);
  });
  return out;
}

/** Komt de eigenschap `tabBarStyle` voor in een object in de code (geen commentaar)? */
function setsTabBarStyle(rel: string): boolean {
  let found = false;
  walk(source(rel), (n) => {
    if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && n.name.getText() === "tabBarStyle") found = true;
  });
  return found;
}

describe("G2: beide schermen verbergen de tabbalk tijdens de selectie", () => {
  it.each(["screens/AlbumScreen.tsx", "screens/MyPhotosScreen.tsx"])(
    "%s zet tabBarStyle, zelf of via een gedeelde module",
    (screen) => {
      expect(reach(screen).filter((f) => f !== "navigation/TabBar.tsx").some(setsTabBarStyle)).toBe(true);
    },
  );
});
