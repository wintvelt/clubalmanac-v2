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
// Gate ronde 2 (H3, H6): met de optie mag de tabbalk nog wegzakken, maar dan
// is geen tab en geen + aan te tikken of voor VoiceOver te vinden. Zonder de
// optie werkt alles weer, ook in hetzelfde scherm na aan en uit. De nep-
// animaties (tests/support/reanimatedMock.ts) staan meteen op hun eindstand,
// dus "na settle" is de stand na de wissel.
// G2: de schermen zetten die optie, zelf of via een gedeelde module.
// Wanneer de optie aan en weer uit gaat (selectie, unmount, uit beeld) toetsen
// audit en gate; dat is schermlogica.
//
// TabBar draait hier met tests/support/hookRuntime.ts; de componenten en de
// data zijn nep. Componenten binnen de tabbalk (TabItem, de +) worden mee
// uitgevoerd (`expand`), zodat de test de tabs zelf ziet. Beperking van de
// runtime: zo'n component met eigen hooks moet bij elke render op dezelfde
// plek staan.
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
  AnimatedView: function AnimatedView() {},
  RNAnimatedView: function RNAnimatedView() {},
}));

vi.mock("react-native", () => {
  // De Animated van React Native: meteen op de eindstand, zoals de nep-Reanimated.
  class Value {
    constructor(public v: number) {}
    setValue(v: number) {
      this.v = v;
    }
    interpolate() {
      return this;
    }
    stopAnimation() {}
  }
  const run = () => ({ start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }), stop: () => {} });
  const ident = <T,>(x: T) => x;
  return {
    View: leaf.View,
    Pressable: leaf.Pressable,
    StyleSheet: {
      create: <T,>(s: T) => s,
      absoluteFill: {},
      absoluteFillObject: {},
      hairlineWidth: 1,
      flatten: (s: unknown) => (Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {})),
    },
    Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
    Animated: {
      View: leaf.RNAnimatedView,
      Value,
      timing: run,
      spring: run,
      parallel: run,
      sequence: run,
      createAnimatedComponent: ident,
    },
    Easing: { linear: ident, quad: ident, cubic: ident, ease: ident, in: ident, out: ident, inOut: ident, bezier: () => ident },
    useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
    AccessibilityInfo: {
      announceForAccessibility: () => {},
      sendAccessibilityEvent: () => {},
      isReduceMotionEnabled: async () => false,
      isScreenReaderEnabled: async () => false,
      addEventListener: () => ({ remove: () => {} }),
    },
    AppState: { addEventListener: () => ({ remove: () => {} }) },
  };
});
vi.mock("react-native-reanimated", async () => {
  const { reanimatedMock } = await import("./support/reanimatedMock");
  return reanimatedMock(() => rt.runtime.module, leaf.AnimatedView);
});
vi.mock("react-native-worklets", async () => {
  const { workletsMock } = await import("./support/reanimatedMock");
  return workletsMock();
});
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
vi.mock("../src/data/accessibility", () => ({
  useReduceMotion: () => false,
  useScreenReader: () => false,
  screenReaderOn: () => false,
}));
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ userId: "user_1", sessionId: "sess_1" }) }));
vi.mock("expo-router", () => ({
  router: { push: () => {}, dismissAll: () => {}, dismissTo: () => {} },
  usePathname: () => "/mijn-fotos",
  useNavigationContainerRef: () => ({ getRootState: () => undefined }),
}));
vi.mock("../src/components/Gradient", () => ({ Gradient: leaf.Gradient }));
vi.mock("../src/components/Icon", () => ({ Icon: leaf.Icon }));
// De echte Motion (met de nep-Reanimated), zodat een nieuwe hook daarin werkt;
// alleen indrukken is nep.
vi.mock("../src/components/Motion", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

function props(focused: number, options: Record<string, Options>, plus: boolean) {
  const descriptors = Object.fromEntries(ROUTES.map((r) => [r.key, { options: options[r.key] ?? {}, route: r }]));
  return {
    state: { index: focused, routes: ROUTES, key: "tabs", routeNames: ROUTES.map((r) => r.name), type: "tab", stale: false },
    descriptors,
    navigation: {},
    emitter: { emit: () => ({ defaultPrevented: false }) },
    navigateToTab: () => {},
    insets: { top: 59, bottom: 34, left: 0, right: 0 },
    plus,
  } as unknown as Parameters<typeof TabBar>[0];
}

type El = { type: unknown; props: Record<string, unknown> };
const isEl = (x: unknown): x is El => typeof x === "object" && x !== null && "type" in x && "props" in x;

const LEAVES = new Set<unknown>(Object.values(leaf));

/** Voert componenten in de boom uit (TabItem, de +), tot op de nep-bladeren. */
function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!isEl(node)) return node;
  if (typeof node.type === "function" && !LEAVES.has(node.type)) {
    return expand((node.type as (p: unknown) => unknown)(node.props));
  }
  const children = node.props.children;
  return typeof children === "function" ? node : { ...node, props: { ...node.props, children: expand(children) } };
}

/** Eén keer tekenen, in een nieuw scherm. */
function render(focused: number, options: Record<string, Options> = {}, plus = true): unknown {
  return rt.runtime.render(() => expand(TabBar(props(focused, options, plus))));
}

/** Hetzelfde scherm blijft staan; `set` verandert de opties tussen de renders. */
function mount(focused: number, options: Record<string, Options>) {
  let current = options;
  const out = rt.runtime.render(() => expand(TabBar(props(focused, current, true))));
  return {
    out,
    async set(next: Record<string, Options>) {
      current = next;
      return rt.runtime.settle<unknown>();
    },
  };
}

function flatStyle(style: unknown): Record<string, unknown> {
  if (typeof style === "function") return flatStyle((style as (s: { pressed: boolean }) => unknown)({ pressed: false }));
  if (Array.isArray(style)) return Object.assign({}, ...style.flat(Infinity).filter(Boolean).map(flatStyle));
  return typeof style === "object" && style !== null ? (style as Record<string, unknown>) : {};
}

type Target = { label: unknown; touch: boolean; voiceOver: boolean };

/**
 * De tabs en de + in de boom, met of ze aan te tikken en voor VoiceOver te
 * vinden zijn. Weg voor tikken: `pointerEvents: "none"` (prop of stijl),
 * `disabled`, of `display: "none"` op het element of erboven. Weg voor
 * VoiceOver: `accessibilityElementsHidden`, `importantForAccessibility:
 * "no-hide-descendants"`, `aria-hidden` of `display: "none"`, ook erboven.
 */
function targets(tree: unknown): Target[] {
  const out: Target[] = [];
  const walk = (node: unknown, touch: boolean, voiceOver: boolean) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, touch, voiceOver));
    if (!isEl(node)) return;
    const p = node.props;
    const style = flatStyle(p.style);
    const gone = style.display === "none";
    const noTouch = gone || p.pointerEvents === "none" || style.pointerEvents === "none" || p.disabled === true;
    const noVoice =
      gone ||
      p.accessibilityElementsHidden === true ||
      p.importantForAccessibility === "no-hide-descendants" ||
      p["aria-hidden"] === true;
    const t = touch && !noTouch;
    const v = voiceOver && !noVoice;
    if (p.accessibilityRole === "tab" || (p.accessibilityRole === "button" && p.accessibilityLabel === "Toevoegen")) {
      out.push({ label: p.accessibilityLabel, touch: t, voiceOver: v });
    }
    walk(p.children, t, v);
  };
  walk(tree, true, true);
  return out;
}

/** Geen tab en geen + aan te tikken of voor VoiceOver te vinden. */
function hidden(out: unknown): boolean {
  return targets(out).every((t) => !t.touch && !t.voiceOver);
}

/** Alle tabs (en de +) staan er en werken. */
function usable(out: unknown, count = ROUTES.length + 1): boolean {
  const all = targets(out);
  return all.length === count && all.every((t) => t.touch && t.voiceOver);
}

const HIDE = { tabBarStyle: { display: "none" } };

beforeEach(() => rt.runtime.unmount());

describe("G1, H6: de tabbalk verbergt zich voor de tab in beeld", () => {
  it("zonder de optie: de tabbalk staat er en werkt", () => {
    expect(usable(render(1))).toBe(true);
    expect(usable(render(0))).toBe(true);
  });

  it("Mijn foto's in beeld, met de optie: niets aan te tikken, niets voor VoiceOver", () => {
    expect(hidden(render(1, { "fotos-k": HIDE }))).toBe(true);
  });

  it("Home in beeld (het album), met de optie: niets aan te tikken, niets voor VoiceOver", () => {
    expect(hidden(render(0, { "home-k": HIDE }))).toBe(true);
  });

  it("de optie op een andere tab verbergt niets (wissel van tab via een link)", () => {
    expect(usable(render(2, { "home-k": HIDE }))).toBe(true);
    expect(usable(render(0, { "fotos-k": HIDE }))).toBe(true);
    // Zodat `hidden` niet altijd waar is.
    expect(hidden(render(0, { "fotos-k": HIDE }))).toBe(false);
  });

  it("andere stijl in tabBarStyle verbergt niets", () => {
    expect(usable(render(1, { "fotos-k": { tabBarStyle: { backgroundColor: "red" } } }))).toBe(true);
  });

  it("de optie weer weg, in een nieuw scherm: de tabbalk komt terug", () => {
    expect(hidden(render(1, { "fotos-k": HIDE }))).toBe(true);
    rt.runtime.unmount();
    expect(usable(render(1, {}))).toBe(true);
  });

  it("uitgelogd (Inloggen, Info), zonder optie: werkt zoals altijd (G8)", () => {
    const loggedOut = [
      { key: "in-k", name: "inloggen" },
      { key: "info-k", name: "info" },
    ];
    const p = props(0, {}, false) as unknown as { state: { routes: unknown[]; routeNames: string[] } };
    p.state.routes = loggedOut;
    p.state.routeNames = loggedOut.map((r) => r.name);
    const out = rt.runtime.render(() => expand(TabBar(p as unknown as Parameters<typeof TabBar>[0])));
    expect(usable(out, 2)).toBe(true);
  });
});

describe("H3, H5, H6: aan en uit in hetzelfde scherm", () => {
  it("Selecteer: de optie komt erbij, dan is geen tab of + meer aan te tikken of voor VoiceOver", async () => {
    const m = mount(1, {});
    expect(usable(m.out)).toBe(true);
    expect(hidden(await m.set({ "fotos-k": HIDE }))).toBe(true);
  });

  it("Annuleren: de optie gaat weg, dan werkt de tabbalk weer helemaal", async () => {
    const m = mount(0, { "home-k": HIDE });
    expect(hidden(m.out)).toBe(true);
    expect(usable(await m.set({}))).toBe(true);
  });

  it("Selecteer en Annuleren snel na elkaar: eindigt met een werkende tabbalk", async () => {
    const m = mount(1, {});
    await m.set({ "fotos-k": HIDE });
    await m.set({});
    await m.set({ "fotos-k": HIDE });
    expect(usable(await m.set({}))).toBe(true);
  });

  it("Annuleren en Selecteer snel na elkaar: eindigt verborgen", async () => {
    const m = mount(1, { "fotos-k": HIDE });
    await m.set({});
    expect(hidden(await m.set({ "fotos-k": HIDE }))).toBe(true);
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
