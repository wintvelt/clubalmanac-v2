import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orientationTransform } from "../src/lib/photos";
import { createHookRuntime } from "./support/hookRuntime";

// WP25 fix-cyclus 2 — de app bewaart een terugval niet op schijf, en wisselt
// bytes en stand tegelijk (A-invariant 26, kernvondst 14; red-team N1). Plus de
// draaiing in `Oriented`, die geen test pinde (kernvondst 15).
//
// Het beeldpad geeft zonder formaten het origineel, onder dezelfde URL als het
// formaat. expo-image kijkt niet naar `no-store` en bewaart standaard op
// schijf. Kwam daarna `exifOrientation` binnen, dan draaide de app het
// bewaarde origineel nog een keer, ook na een herstart. Daarom:
// - `PhotoImage` krijgt `hasFormats` en geeft het door aan `usePhotoLoad` (de
//   cache-sleutel, zie photoLoad.test.ts); zonder formaten niet op schijf;
// - `ProfileAvatar` krijgt `hasFormats`; wisselt het, dan bouwt het beeld
//   opnieuw op (de stand alleen laadt geen nieuwe bytes);
// - elke aanroep in de app geeft het door, van hetzelfde object als de stand.
//
// Zoals profileAvatar.test.ts: de component draait als functie
// (tests/support/hookRuntime.ts), eigen componenten worden uitgeklapt, React
// Native en expo-image zijn nep.

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));
const hook = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

vi.mock("../src/data/images", () => ({
  // Zoals de echte hook: de sleutel hangt af van hasFormats (photoLoad.test.ts).
  usePhotoLoad: (...args: unknown[]) => {
    hook.calls.push(args);
    const uri = "https://demo.convex.site/beeld/foto/foto1?formaat=klein";
    return {
      source: { uri, cacheKey: `${uri}#${args[2] === true ? "met" : "zonder"}`, headers: {} },
      attempt: 0,
      onError: () => {},
      retry: () => {},
    };
  },
  useProfileSource: () => ({ uri: "https://demo.convex.site/beeld/profiel/u1?formaat=klein" }),
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
type Transform = Record<string, unknown>[];
type Found = { image: El; transform: Transform; keys: (string | null)[] };

const HOSTS = new Set<unknown>([host.View, host.Pressable, host.Image]);
const isEl = (x: unknown): x is El => typeof x === "object" && x !== null && "type" in x && "props" in x;

/** Klapt eigen componenten uit; een render-prop (`children` als functie) ook. */
function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!isEl(node)) return node;
  if (typeof node.type === "function" && !HOSTS.has(node.type) && node.type.name !== "LetterTile") {
    const out = expand((node.type as (p: unknown) => unknown)(node.props));
    return node.key !== null && isEl(out) ? { ...out, key: `${node.key}/${out.key ?? ""}` } : out;
  }
  return { ...node, props: { ...node.props, children: expand(node.props.children) } };
}

function styleTransforms(style: unknown): Transform {
  if (Array.isArray(style)) return style.flatMap(styleTransforms);
  if (style && typeof style === "object" && Array.isArray((style as { transform?: unknown }).transform)) {
    return (style as { transform: Transform }).transform;
  }
  return [];
}

function flatStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatStyle));
  return style && typeof style === "object" ? (style as Record<string, unknown>) : {};
}

/** Elk beeld, met de transforms en keys van zichzelf en zijn voorouders. */
function images(tree: unknown): Found[] {
  const out: Found[] = [];
  const walk = (node: unknown, above: Transform, keys: (string | null)[]) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, above, [...keys, `#${i}`]));
    if (!isEl(node)) return;
    const here = [...above, ...styleTransforms(node.props.style)];
    const k = [...keys, node.key];
    if (node.type === host.Image) out.push({ image: node, transform: here, keys: k });
    walk(node.props.children, here, k);
  };
  walk(tree, [], []);
  return out;
}

const rotations = (t: Transform) => t.filter((x) => "rotate" in x || "scaleX" in x || "scaleY" in x);
const BOX = { width: 120, height: 90 };

async function renderPhoto(props: Record<string, unknown>) {
  const { PhotoImage } = await import("../src/components/Photo");
  const tree = rt.runtime.render(() =>
    expand(PhotoImage({ photoId: "foto1", format: "klein", box: BOX, ...props } as Parameters<typeof PhotoImage>[0])),
  );
  return images(tree);
}

async function renderAvatar(props: Record<string, unknown>) {
  const { ProfileAvatar } = await import("../src/components/Photo");
  const tree = rt.runtime.render(() =>
    expand(ProfileAvatar({ userId: "u1", name: "Owen", size: 40, ...props } as Parameters<typeof ProfileAvatar>[0])),
  );
  return images(tree);
}

/** Wat het beeld identiek houdt voor React en expo-image: de keys op het pad en de bron. */
const identity = (f: Found) => JSON.stringify({ keys: f.keys, source: f.image.props.source });

beforeEach(() => {
  hook.calls.length = 0;
});

describe("PhotoImage — zonder formaten niet op schijf (invariant 26)", () => {
  it.each([false, undefined])("hasFormats %s: cachePolicy 'none' of 'memory'", async (hasFormats) => {
    const found = await renderPhoto({ hasFormats });
    expect(found).toHaveLength(1);
    expect(["none", "memory"]).toContain(found[0]!.image.props.cachePolicy);
  });

  it("hasFormats true: de schijfcache blijft (invariant 1)", async () => {
    const found = await renderPhoto({ hasFormats: true });
    expect([undefined, "disk", "memory-disk"]).toContain(found[0]!.image.props.cachePolicy);
  });

  it("geeft hasFormats door aan usePhotoLoad (de cache-sleutel)", async () => {
    await renderPhoto({ hasFormats: true });
    expect(hook.calls.at(-1)).toEqual(["foto1", "klein", true]);
    await renderPhoto({ hasFormats: false });
    expect(hook.calls.at(-1)).toEqual(["foto1", "klein", false]);
  });
});

describe("PhotoImage — de draaiing in Oriented (kernvondst 15)", () => {
  it.each([2, 3, 6, 8])("stand %i: het beeld krijgt orientationTransform", async (stand) => {
    const found = await renderPhoto({ hasFormats: true, exifOrientation: stand });
    expect(rotations(found[0]!.transform)).toEqual(orientationTransform(stand));
  });

  it("geen stand, of 1: niet gedraaid", async () => {
    for (const stand of [undefined, 1]) {
      const found = await renderPhoto({ hasFormats: true, exifOrientation: stand });
      expect(rotations(found[0]!.transform)).toEqual([]);
    }
  });

  it("een kwartslag (6): het beeld krijgt de omgekeerde maten, zodat het na draaien het vak vult", async () => {
    const found = await renderPhoto({ hasFormats: true, exifOrientation: 6 });
    expect(flatStyle(found[0]!.image.props.style)).toMatchObject({ width: BOX.height, height: BOX.width });
  });
});

describe("ProfileAvatar — bytes en stand wisselen tegelijk (invariant 26)", () => {
  it("wisselt hasFormats, dan is het een ander beeld (opnieuw opgebouwd of een andere bron)", async () => {
    const [zonder] = await renderAvatar({ hasFormats: false });
    const [met] = await renderAvatar({ hasFormats: true, exifOrientation: 6 });
    expect(zonder, "zonder").toBeDefined();
    expect(met, "met").toBeDefined();
    expect(identity(met!)).not.toBe(identity(zonder!));
  });

  // Fix-cyclus 3 (kernvondst 17): een nieuwe profielfoto met een andere stand,
  // beide met formaten. De URL blijft gelijk; zonder nieuw beeld draait de
  // nieuwe stand de oude bytes.
  it("wisselt de stand (beide met formaten), dan is het een ander beeld", async () => {
    const [oud] = await renderAvatar({ hasFormats: true, exifOrientation: 1 });
    const [nieuw] = await renderAvatar({ hasFormats: true, exifOrientation: 6 });
    expect(identity(nieuw!)).not.toBe(identity(oud!));
  });

  it("niets gewisseld: hetzelfde beeld (geen herlaad bij elke render)", async () => {
    const [eerst] = await renderAvatar({ hasFormats: true, exifOrientation: 6 });
    const [daarna] = await renderAvatar({ hasFormats: true, exifOrientation: 6 });
    expect(identity(daarna!)).toBe(identity(eerst!));
  });

  it("cachePolicy blijft 'none' (WP17a invariant 3), met en zonder formaten", async () => {
    for (const hasFormats of [true, false]) {
      const [found] = await renderAvatar({ hasFormats });
      expect(found!.image.props.cachePolicy).toBe("none");
    }
  });
});

describe("elke aanroep in de app geeft hasFormats door, van hetzelfde object als de stand", () => {
  const SRC = join(__dirname, "../src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });

  /** De openings-tag van elk `<Name …>`, ook met JSX tussen accolades in de props. */
  function openingTags(name: string): { file: string; tag: string }[] {
    const out: { file: string; tag: string }[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(new RegExp(`<${name}\\b`, "g"))) {
        let depth = 0;
        let i = m.index! + m[0].length;
        for (; i < text.length; i++) {
          const c = text[i];
          if (c === "{") depth++;
          else if (c === "}") depth--;
          else if (c === ">" && depth === 0) break;
        }
        out.push({ file, tag: text.slice(m.index!, i + 1) });
      }
    }
    return out;
  }

  it.each([
    ["PhotoImage", "exifOrientation", "hasFormats", 5],
    ["ProfileAvatar", "profileOrientation", "profileHasFormats", 3],
  ] as const)("<%s>: hasFormats={X.%s → X.%s}", (component, stand, flag, atLeast) => {
    const tags = openingTags(component);
    expect(tags.length, `${component} wordt gebruikt`).toBeGreaterThanOrEqual(atLeast);
    for (const { file, tag } of tags) {
      const m = new RegExp(`exifOrientation=\\{\\s*([\\w.?!]+?)\\.${stand}\\s*\\}`).exec(tag);
      expect(m, `${file}: de stand komt van een object`).not.toBeNull();
      expect(tag, file).toMatch(new RegExp(`hasFormats=\\{\\s*${m![1]!.replace(/[.?]/g, "\\$&")}\\.${flag}\\s*\\}`));
    }
  });
});
