import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRuntime, findAll } from "./support/hookRuntime";

// WP17a invariant 18 (fix-cyclus 3, heraudit op 1af3f61): hoe `PhotoImage`
// (src/components/Photo.tsx) `usePhotoLoad` aansluit. De hook zelf pint
// app/tests/photoLoad.test.ts; hier is de hook nagebootst en draait de echte
// component als functie (tests/support/hookRuntime.ts).
//
// - het beeld krijgt de bron van de hook, en een key die per poging verschilt:
//   een nieuwe poging bouwt het beeld opnieuw op en vraagt opnieuw;
// - een fout van het beeld gaat naar `onError` van de hook;
// - "Opnieuw" op de fout-tegel roept `retry` van de hook aan;
// - terugvallen met een `fallback` (de letter op een cover): die, zonder beeld.

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));
const hook = vi.hoisted(() => ({
  source: undefined as { uri: string; headers?: Record<string, string> } | null | undefined,
  attempt: 0,
  onError: null as unknown as () => void,
  retry: null as unknown as () => void,
}));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

vi.mock("../src/data/images", () => ({
  usePhotoLoad: () => ({ ...hook }),
  useProfileSource: () => null,
}));

vi.mock("expo-image", () => ({ Image: function Image() {} }));
vi.mock("react-native", () => ({
  View: function View() {},
  Pressable: function Pressable() {},
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

const BOX = { width: 120, height: 90 };
const SOURCE = (token: string) => ({
  uri: "https://demo.convex.site/beeld/foto/foto1?formaat=klein",
  headers: { Authorization: `Bearer ${token}` },
});

type El = { type: unknown; key: string | null; props: Record<string, unknown> };

async function render(props: Record<string, unknown> = {}) {
  const { PhotoImage } = await import("../src/components/Photo");
  const { Image } = await import("expo-image");
  const { Pressable } = await import("react-native");
  const tree = rt.runtime.render(() =>
    PhotoImage({ photoId: "foto1", format: "klein", box: BOX, ...props } as Parameters<typeof PhotoImage>[0]),
  );
  const images = findAll(tree, (el) => el.type === Image, BOX) as El[];
  const pressables = findAll(tree, (el) => el.type === Pressable, BOX) as El[];
  return { tree, images, pressables };
}

beforeEach(() => {
  hook.source = undefined;
  hook.attempt = 0;
  hook.onError = vi.fn();
  hook.retry = vi.fn();
});

describe("PhotoImage — aansluiting op usePhotoLoad (invariant 18)", () => {
  it("wacht op het token: geen beeld", async () => {
    const { images } = await render();
    expect(images).toEqual([]);
  });

  it("het beeld krijgt de bron van de hook", async () => {
    hook.source = SOURCE("t1");
    const { images } = await render();
    expect(images).toHaveLength(1);
    expect(images[0]!.props.source).toEqual(SOURCE("t1"));
  });

  it("de key verschilt per poging, ook bij dezelfde foto en URL", async () => {
    hook.source = SOURCE("t1");
    hook.attempt = 0;
    const first = (await render()).images[0]!;
    hook.source = SOURCE("t2");
    hook.attempt = 1;
    const second = (await render()).images[0]!;
    hook.attempt = 2;
    const third = (await render()).images[0]!;
    expect(first.key).not.toBeNull();
    expect(new Set([first.key, second.key, third.key]).size).toBe(3);
  });

  it("een fout van het beeld gaat naar onError van de hook", async () => {
    hook.source = SOURCE("t1");
    const { images } = await render();
    const onError = images[0]!.props.onError as ((e?: unknown) => void) | undefined;
    expect(typeof onError).toBe("function");
    onError!({ error: "401" });
    expect(hook.onError).toHaveBeenCalledTimes(1);
    expect(hook.retry).not.toHaveBeenCalled();
  });

  it("teruggevallen zonder fallback: de fout-tegel, en Opnieuw roept retry aan", async () => {
    hook.source = null;
    const { images, pressables } = await render();
    expect(images).toEqual([]);
    expect(pressables).toHaveLength(1);
    (pressables[0]!.props.onPress as () => void)();
    expect(hook.retry).toHaveBeenCalledTimes(1);
    expect(hook.onError).not.toHaveBeenCalled();
  });

  it("teruggevallen met een fallback: die, zonder beeld en zonder fout-tegel", async () => {
    hook.source = null;
    const letter = { type: "Letter", key: null, props: {} };
    const { tree, images, pressables } = await render({ fallback: letter });
    expect(images).toEqual([]);
    expect(pressables).toEqual([]);
    expect(findAll(tree, (el) => el.type === "Letter")).toHaveLength(1);
  });
});
