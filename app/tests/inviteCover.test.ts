import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { orientationTransform } from "../src/lib/photos";
import { createHookRuntime } from "./support/hookRuntime";

// WP19c besluit 4, A-invariant 12: de cover op de uitnodigingskaart staat
// rechtop. Het beeldpad van de genodigde geeft *klein*: ruwe pixels zonder tag.
// `listReceived` geeft daarom `group.coverOrientation`, en `InviteCover` draait
// het beeld daarmee zoals `PhotoImage` en `ProfileAvatar` dat doen
// (`orientationTransform`).
//
// Zelfde opzet als profileAvatar.test.ts: de component draait als functie
// (tests/support/hookRuntime.ts), eigen componenten worden uitgeklapt, React
// Native en expo-image zijn nep. De test telt de transforms van het beeld en
// alles erboven bij elkaar: waar B de draaiing zet, maakt niet uit.
//
// Voor B: `InviteCover({ inviteId, name, exifOrientation? })` in
// src/components/InviteCover.tsx, met `useInviteCoverLoad` uit src/data/images.

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

const SOURCE = { uri: "https://demo.convex.site/beeld/uitnodiging/inv1?formaat=klein" };
const load = () => ({ source: SOURCE, attempt: 0, onError: () => {}, retry: () => {} });
vi.mock("../src/data/images", () => ({
  useInviteCoverLoad: load,
  usePhotoLoad: load,
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
vi.mock("../src/theme", () => {
  const tokens = new Proxy({}, { get: () => 12 });
  return {
    useTheme: () => ({ colors: { line: "#ccc", muted: "#888", surface: "#fff" } }),
    photoLayers: { coverScrim: { top: 0.4, at100: 0.2, bottom: 0 } },
    radius: tokens,
    space: tokens,
    size: tokens,
  };
});
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
  if (typeof children === "function") {
    // Een render-prop (zoals `Oriented` in Photo.tsx): roep hem aan met een vak.
    return { ...node, props: { ...node.props, children: expand((children as (b: unknown) => unknown)({ width: 64, height: 64 })) } };
  }
  return { ...node, props: { ...node.props, children: expand(children) } };
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

async function renderCover(props: Record<string, unknown>) {
  // Laadt de nep-react ook als de component zelf `react` niet importeert.
  await import("react");
  const mod = (await import("../src/components/InviteCover")) as {
    InviteCover: (p: Record<string, unknown>) => unknown;
  };
  const tree = rt.runtime.render(() => expand(mod.InviteCover({ inviteId: "inv1", name: "Club", ...props })));
  return imagesWithTransforms(tree);
}

const rotations = (t: Transform) => t.filter((x) => "rotate" in x || "scaleX" in x || "scaleY" in x);

describe("InviteCover — de stand uit listReceived (A-invariant 12)", () => {
  it.each([3, 6, 8])("stand %i: het beeld krijgt dezelfde transform als PhotoImage", async (stand) => {
    const images = await renderCover({ exifOrientation: stand });
    expect(images).toHaveLength(1);
    expect(rotations(images[0]!.transform)).toEqual(orientationTransform(stand));
  });

  it("stand 2 (gespiegeld): ook de spiegeling", async () => {
    const images = await renderCover({ exifOrientation: 2 });
    expect(rotations(images[0]!.transform)).toEqual(orientationTransform(2));
  });

  it("geen stand, of 1: niet gedraaid", async () => {
    for (const stand of [undefined, 1]) {
      const images = await renderCover({ exifOrientation: stand });
      expect(images).toHaveLength(1);
      expect(rotations(images[0]!.transform)).toEqual([]);
    }
  });

  it("het beeld blijft alleen in het geheugen (WP19b A-invariant 15)", async () => {
    const images = await renderCover({ exifOrientation: 6 });
    expect(images[0]!.image.props.cachePolicy).toBe("memory");
  });
});

describe("de kaart geeft de stand door", () => {
  const screen = readFileSync(join(__dirname, "../src/screens/InvitesScreens.tsx"), "utf8");

  it("InvitesScreens gebruikt de gedeelde InviteCover, niet een eigen kopie", () => {
    expect(screen).toMatch(/from\s+["']\.\.\/components\/InviteCover["']/);
    expect(screen).not.toMatch(/function\s+InviteCover\b/);
  });

  it("elke <InviteCover …/> heeft exifOrientation={… coverOrientation}", () => {
    const uses = [...screen.matchAll(/<InviteCover\b[^>]*\/>/gs)].map((m) => m[0]);
    expect(uses.length).toBeGreaterThanOrEqual(1);
    for (const tag of uses) expect(tag).toMatch(/exifOrientation=\{[^}]*coverOrientation[^}]*\}/s);
  });
});
