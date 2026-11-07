import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { orientationTransform } from "../src/lib/photos";
import { createHookRuntime } from "./support/hookRuntime";

// WP25 fix-cyclus 1 — een avatar staat rechtop (A-invariant 19, kernvondst 7).
//
// Na de backfill geeft het profielpad *klein*: ruwe pixels zonder tag. De
// user-vormen dragen daarom `profileOrientation`, en `ProfileAvatar` draait het
// beeld daarmee zoals `Photo` dat doet (`orientationTransform`).
//
// De component draait hier als functie (tests/support/hookRuntime.ts). Eigen
// componenten binnen Photo.tsx worden uitgeklapt; React Native en expo-image
// zijn nep. De test kijkt naar het beeld en telt de transforms van het beeld
// en alles erboven bij elkaar: waar B de draaiing zet, maakt niet uit.

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

vi.mock("../src/data/images", () => ({
  usePhotoLoad: () => ({ source: undefined, attempt: 0, onError: () => {}, retry: () => {} }),
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

const HOSTS = new Set<unknown>([host.View, host.Pressable, host.Image]);
const isEl = (x: unknown): x is El => typeof x === "object" && x !== null && "type" in x && "props" in x;

/** Klapt eigen componenten uit (type is een functie die geen nep-host is). */
function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!isEl(node)) return node;
  if (typeof node.type === "function" && !HOSTS.has(node.type) && node.type.name !== "LetterTile") {
    return expand((node.type as (p: unknown) => unknown)(node.props));
  }
  const children = node.props.children;
  return { ...node, props: { ...node.props, children: typeof children === "function" ? children : expand(children) } };
}

function styleTransforms(style: unknown): Transform {
  if (Array.isArray(style)) return style.flatMap(styleTransforms);
  if (style && typeof style === "object" && Array.isArray((style as { transform?: unknown }).transform)) {
    return (style as { transform: Transform }).transform;
  }
  return [];
}

/** Elk beeld met de transforms van zichzelf en zijn voorouders, buitenste eerst. */
function imagesWithTransforms(tree: unknown): { image: El; transform: Transform }[] {
  const out: { image: El; transform: Transform }[] = [];
  const walk = (node: unknown, above: Transform) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, above));
    if (!isEl(node)) return;
    const here = [...above, ...styleTransforms(node.props.style)];
    if (node.type === host.Image) out.push({ image: node, transform: here });
    walk(node.props.children, here);
  };
  walk(tree, []);
  return out;
}

async function renderAvatar(props: Record<string, unknown>) {
  const { ProfileAvatar } = await import("../src/components/Photo");
  const tree = rt.runtime.render(() =>
    expand(ProfileAvatar({ userId: "u1", name: "Owen", size: 40, ...props } as Parameters<typeof ProfileAvatar>[0])),
  );
  return imagesWithTransforms(tree);
}

const rotations = (t: Transform) => t.filter((x) => "rotate" in x || "scaleX" in x || "scaleY" in x);

describe("ProfileAvatar — de stand uit de user-vorm (invariant 19)", () => {
  it.each([3, 6, 8])("stand %i: het beeld krijgt dezelfde transform als Photo", async (stand) => {
    const images = await renderAvatar({ exifOrientation: stand });
    expect(images).toHaveLength(1);
    expect(rotations(images[0]!.transform)).toEqual(orientationTransform(stand));
  });

  it("stand 2 (gespiegeld): ook de spiegeling", async () => {
    const images = await renderAvatar({ exifOrientation: 2 });
    expect(rotations(images[0]!.transform)).toEqual(orientationTransform(2));
  });

  it("geen stand, of 1: niet gedraaid", async () => {
    for (const stand of [undefined, 1]) {
      const images = await renderAvatar({ exifOrientation: stand });
      expect(images).toHaveLength(1);
      expect(rotations(images[0]!.transform)).toEqual([]);
    }
  });
});

describe("elke avatar in de app geeft de stand door", () => {
  const SRC = join(__dirname, "../src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });

  it("elke <ProfileAvatar …/> heeft exifOrientation={… profileOrientation}", () => {
    const uses = files(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/<ProfileAvatar\b[^>]*\/>/gs)].map((m) => ({ file, tag: m[0] })),
    );
    expect(uses.length, "ProfileAvatar wordt gebruikt").toBeGreaterThanOrEqual(3);
    for (const { file, tag } of uses) {
      expect(tag, file).toMatch(/exifOrientation=\{[^}]*profileOrientation[^}]*\}/s);
    }
  });
});
