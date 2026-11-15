import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createHookRuntime } from "./support/hookRuntime";

// WP20 besluit 10, N5 (fix-cyclus 2): het beeld van een gemelde foto blijft
// niet op de telefoon van de webmaster. De wachtrij (FlagQueueScreen) bewaart
// het alleen in het geheugen, niet in de schijfcache. Na goedkeuren of wissen
// mag de webmaster het beeld niet meer hebben (A-invariant 9: alleen zolang de
// foto gemeld is); een herstart van de app wist het geheugen.
//
// A-keuze 11: `PhotoImage` krijgt de prop `memoryOnly`; met `memoryOnly` gaat
// het beeld nooit op schijf (cachePolicy "memory" of "none"), ook met formaten.
// Zonder de prop verandert er niets (invariant 1, photoCache.test.ts). De
// wachtrij geeft hem aan elk beeld. "Gemelde foto's" van de eigenaar hoeft
// niet: dat zijn zijn eigen foto's.
//
// Zoals photoCache.test.ts: de component draait als functie
// (tests/support/hookRuntime.ts), React Native en expo-image zijn nep. Het
// scherm zelf is een bron-scan, zoals de hasFormats-scan daar.
// Spec: docs/work-packages/WP20-melden.md §Besluiten na de red-team, §Fix-cyclus 2 (A).

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

vi.mock("../src/data/images", () => ({
  usePhotoLoad: (photoId: string, format: string, hasFormats: boolean) => {
    const uri = `https://demo.convex.site/beeld/foto/${photoId}?formaat=${format}`;
    return {
      source: { uri, cacheKey: `${uri}#${hasFormats ? "met" : "zonder"}`, headers: {} },
      attempt: 0,
      onError: () => {},
      retry: () => {},
    };
  },
  useProfileSource: () => null,
}));

const host = vi.hoisted(() => ({
  View: function View() {},
  Pressable: function Pressable() {},
  Image: function Image() {},
}));
vi.mock("expo-image", () => ({ Image: host.Image }));
vi.mock("react-native", () => ({
  View: host.View,
  Pressable: host.Pressable,
  StyleSheet: { create: <T>(s: T) => s, absoluteFill: {} },
}));
vi.mock("react-native-svg", () => ({
  default: function Svg() {},
  Defs: function Defs() {},
  LinearGradient: function LinearGradient() {},
  Rect: function Rect() {},
  Stop: function Stop() {},
}));
vi.mock("../src/theme", () => ({
  useTheme: () => ({ colors: { line: "#ccc", muted: "#888", surface: "#fff" } }),
  photoLayers: { coverScrim: { top: 0.4, at100: 0.2, bottom: 0 } },
}));
vi.mock("../src/components/Icon", () => ({ Icon: function Icon() {} }));
vi.mock("../src/components/LetterTile", () => ({ LetterTile: function LetterTile() {} }));

type El = { type: unknown; key: string | null; props: Record<string, unknown> };
const HOSTS = new Set<unknown>([host.View, host.Pressable, host.Image]);
const isEl = (x: unknown): x is El => typeof x === "object" && x !== null && "type" in x && "props" in x;

/** Klapt eigen componenten uit; een render-prop (`children` als functie) ook. */
function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!isEl(node)) return node;
  if (typeof node.type === "function" && !HOSTS.has(node.type) && node.type.name !== "LetterTile") {
    return expand((node.type as (p: unknown) => unknown)(node.props));
  }
  return { ...node, props: { ...node.props, children: expand(node.props.children) } };
}

function imagesIn(tree: unknown): El[] {
  const out: El[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isEl(node)) return;
    if (node.type === host.Image) out.push(node);
    walk(node.props.children);
  };
  walk(tree);
  return out;
}

async function renderPhoto(props: Record<string, unknown>) {
  const { PhotoImage } = await import("../src/components/Photo");
  const tree = rt.runtime.render(() =>
    expand(
      PhotoImage({
        photoId: "gemeld1",
        format: "klein",
        box: { width: 96, height: 96 },
        ...props,
      } as Parameters<typeof PhotoImage>[0]),
    ),
  );
  return imagesIn(tree);
}

const NOT_ON_DISK = ["memory", "none"];

describe("PhotoImage met memoryOnly: nooit op schijf (A-keuze 11)", () => {
  it.each([true, false, undefined])("hasFormats %s: cachePolicy 'memory' of 'none'", async (hasFormats) => {
    const found = await renderPhoto({ memoryOnly: true, hasFormats });
    expect(found).toHaveLength(1);
    expect(NOT_ON_DISK).toContain(found[0]!.props.cachePolicy);
  });

  it("controle: zonder memoryOnly en met formaten blijft de schijfcache (invariant 1)", async () => {
    const found = await renderPhoto({ hasFormats: true });
    expect([undefined, "disk", "memory-disk"]).toContain(found[0]!.props.cachePolicy);
  });
});

describe("de wachtrij van de webmaster geeft elk beeld memoryOnly", () => {
  const text = readFileSync(join(__dirname, "../src/screens/FlagScreens.tsx"), "utf8");

  /** De broncode van de functie `name` tot de volgende functie op het hoogste niveau. */
  function functionBody(name: string): string {
    const start = text.search(new RegExp(`^(export )?function ${name}\\b`, "m"));
    expect(start, `function ${name} in FlagScreens.tsx`).toBeGreaterThanOrEqual(0);
    const rest = text.slice(start + 1);
    const next = rest.search(/^(export )?(function|const|type) /m);
    return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
  }

  /** De openings-tag van elk `<PhotoImage …>`, ook met JSX tussen accolades in de props. */
  function photoTags(source: string): string[] {
    const out: string[] = [];
    for (const m of source.matchAll(/<PhotoImage\b/g)) {
      let depth = 0;
      let i = m.index! + m[0].length;
      for (; i < source.length; i++) {
        const c = source[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
      }
      out.push(source.slice(m.index!, i + 1));
    }
    return out;
  }

  it("FlagQueueContent: elk <PhotoImage> heeft memoryOnly", () => {
    const tags = photoTags(functionBody("FlagQueueContent"));
    expect(tags.length, "de wachtrij toont een beeld").toBeGreaterThanOrEqual(1);
    for (const tag of tags) {
      expect(tag).toMatch(/\bmemoryOnly(\s*=\s*\{\s*true\s*\})?(?=[\s/>])/);
    }
  });
});
