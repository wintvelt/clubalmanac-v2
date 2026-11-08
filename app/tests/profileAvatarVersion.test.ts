import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRuntime } from "./support/hookRuntime";

// WP17b fix-cyclus 1, invariant 14 (audit B1): de avatar volgt `profileVersion`,
// op de hele avatar.
//
// De profiel-URL is per user gelijk. Kiest een user een nieuwe profielfoto met
// dezelfde stand en hetzelfde formaat-vlag, dan moet de avatar toch opnieuw
// laden. Stond hij op de letter na een fout, dan probeert hij het nieuwe beeld.
// Zelfde versie: geen herlaad, en na een fout geen lus.
//
// Waar B de versie inzet (een key, de bron, een effect) maakt niet uit. Daarom
// draait de avatar hier in een kleine reconciler, zoals in React: elk eigen
// component heeft eigen state per plek in de boom, en een andere key of een
// ander type op die plek is een nieuw component met nieuwe state. React
// Native en expo-image zijn nep (zoals photoCache.test.ts).
//
// Spec: docs/work-packages/WP17b-foto-acties.md §Fix-cyclus 1.

type Runtime = ReturnType<typeof createHookRuntime>;
const rt = vi.hoisted(() => ({ active: null as unknown as Runtime }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  const base = createHookRuntime().module;
  const fwd =
    (name: "useState" | "useEffect" | "useRef" | "useMemo" | "useCallback" | "useContext") =>
    (...args: unknown[]) =>
      (rt.active.module[name] as (...a: unknown[]) => unknown)(...args);
  const react = {
    ...base,
    useState: fwd("useState"),
    useEffect: fwd("useEffect"),
    useRef: fwd("useRef"),
    useMemo: fwd("useMemo"),
    useCallback: fwd("useCallback"),
    useContext: fwd("useContext"),
  };
  return { ...react, default: react };
});

vi.mock("../src/data/images", () => ({
  usePhotoLoad: () => ({ source: undefined, attempt: 0, onError: () => {}, retry: () => {} }),
  useProfileSource: () => ({ uri: "https://demo.convex.site/beeld/profiel/u1?formaat=klein" }),
}));

const host = vi.hoisted(() => ({
  View: function View() {},
  Pressable: function Pressable() {},
  Image: function Image() {},
  LetterTile: function LetterTile() {},
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
vi.mock("../src/components/LetterTile", () => ({ LetterTile: host.LetterTile }));

// --- Een kleine reconciler ---------------------------------------------------------------

type El = { type: unknown; key: string | null; props: Record<string, unknown> };
type Mounted = { type: unknown; id: string; props: Record<string, unknown>; children: unknown };
type Instance = { runtime: Runtime; type: (p: unknown) => unknown; props: unknown };

const HOSTS = new Set<unknown>(Object.values(host));
const isEl = (x: unknown): x is El => typeof x === "object" && x !== null && "type" in x && "props" in x;
const nameOf = (type: unknown) =>
  typeof type === "function" ? type.name : typeof type === "string" ? type : "?";

let instances = new Map<string, Instance>();
let seen = new Set<string>();

/**
 * Eén plek in de boom = pad van ouder + positie + type + key. Een eigen
 * component op een plek die er al was, houdt zijn state; een nieuwe plek
 * begint opnieuw.
 */
async function mount(node: unknown, path: string): Promise<unknown> {
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    for (let i = 0; i < node.length; i++) out.push(await mount(node[i], `${path}[${i}]`));
    return out;
  }
  if (!isEl(node)) return node;
  const id = `${path}/${nameOf(node.type)}${node.key === null ? "" : `#${node.key}`}`;
  if (typeof node.type === "function" && !HOSTS.has(node.type)) {
    seen.add(id);
    let inst = instances.get(id);
    let out: unknown;
    if (!inst) {
      const fresh: Instance = { runtime: createHookRuntime(), type: node.type as (p: unknown) => unknown, props: node.props };
      instances.set(id, fresh);
      rt.active = fresh.runtime;
      out = fresh.runtime.render(() => fresh.type(fresh.props));
      inst = fresh;
    } else {
      inst.props = node.props;
      rt.active = inst.runtime;
      out = await inst.runtime.settle();
    }
    return await mount(out, id);
  }
  const m: Mounted = { type: node.type, id, props: node.props, children: await mount(node.props.children, id) };
  return m;
}

let rootProps: Record<string, unknown> = {};

async function update(): Promise<Mounted[]> {
  const { ProfileAvatar } = await import("../src/components/Photo");
  seen = new Set();
  // De avatar zelf als wortel, op een vaste plek (zoals een scherm hem rendert).
  const tree = await mount({ type: ProfileAvatar, key: null, props: rootProps }, "scherm");
  for (const id of [...instances.keys()]) if (!seen.has(id)) instances.delete(id);
  const out: Mounted[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n !== "object" || n === null || !("id" in n)) return;
    out.push(n as Mounted);
    walk((n as Mounted).children);
  };
  walk(tree);
  return out;
}

const imagesIn = (tree: Mounted[]) => tree.filter((n) => n.type === host.Image);
/** Wat het beeld voor React en expo-image identiek houdt: zijn plek en zijn bron. */
const identity = (img: Mounted) => JSON.stringify({ id: img.id, source: img.props.source });

async function show(props: Record<string, unknown>): Promise<Mounted[]> {
  rootProps = { userId: "u1", name: "Owen", size: 40, ...props };
  return await update();
}

async function fail(tree: Mounted[]): Promise<Mounted[]> {
  const [img] = imagesIn(tree);
  expect(img, "er is een beeld om te laten falen").toBeDefined();
  (img!.props.onError as (e?: unknown) => void)({ error: "404" });
  return await update();
}

beforeEach(() => {
  instances = new Map();
  seen = new Set();
});

const BASE = { hasFormats: true, exifOrientation: 6 };

describe("de reconciler zelf", () => {
  it("een fout zonder nieuwe versie: de letter, geen beeld (zoals nu, WP17a invariant 14)", async () => {
    const tree = await fail(await show({ ...BASE, version: "v1" }));
    expect(imagesIn(tree)).toHaveLength(0);
    expect(tree.some((n) => n.type === host.LetterTile)).toBe(true);
  });

  it("een andere stand: een ander beeld (WP25 invariant 26 blijft)", async () => {
    const [a] = imagesIn(await show({ ...BASE, version: "v1" }));
    const [b] = imagesIn(await show({ ...BASE, exifOrientation: 3, version: "v1" }));
    expect(identity(b!)).not.toBe(identity(a!));
  });
});

describe("invariant 14: een nieuwe versie laadt opnieuw", () => {
  it("zelfde stand en formaten, andere versie: een ander beeld (nieuw element of andere bron)", async () => {
    const [a] = imagesIn(await show({ ...BASE, version: "v1" }));
    const [b] = imagesIn(await show({ ...BASE, version: "v2" }));
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(identity(b!)).not.toBe(identity(a!));
  });

  it("ook zonder stand en zonder formaten", async () => {
    const [a] = imagesIn(await show({ hasFormats: false, version: "v1" }));
    const [b] = imagesIn(await show({ hasFormats: false, version: "v2" }));
    expect(identity(b!)).not.toBe(identity(a!));
  });

  it("na een fout (de letter): een nieuwe versie toont weer een beeld", async () => {
    const failed = await fail(await show({ ...BASE, version: "v1" }));
    expect(imagesIn(failed)).toHaveLength(0);
    const next = await show({ ...BASE, version: "v2" });
    expect(imagesIn(next), "het nieuwe beeld wordt geprobeerd").toHaveLength(1);
  });
});

describe("invariant 14: zelfde versie, geen herlaad", () => {
  it("niets gewisseld: hetzelfde beeld", async () => {
    const [a] = imagesIn(await show({ ...BASE, version: "v1" }));
    const [b] = imagesIn(await show({ ...BASE, version: "v1" }));
    expect(identity(b!)).toBe(identity(a!));
  });

  it("na een fout, zelfde versie: de letter blijft (geen lus)", async () => {
    await fail(await show({ ...BASE, version: "v1" }));
    for (let i = 0; i < 3; i++) {
      const again = await show({ ...BASE, version: "v1" });
      expect(imagesIn(again), `render ${i}`).toHaveLength(0);
    }
  });
});

describe("elke avatar in de app geeft de versie door, van hetzelfde object als de stand", () => {
  const SRC = join(__dirname, "../src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });

  /** De openings-tag van elk `<ProfileAvatar …>`, ook met JSX tussen accolades in de props. */
  function openingTags(): { file: string; tag: string }[] {
    const out: { file: string; tag: string }[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/<ProfileAvatar\b/g)) {
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

  it("version={X.profileVersion} naast exifOrientation={X.profileOrientation}", () => {
    const tags = openingTags();
    expect(tags.length, "ProfileAvatar wordt gebruikt").toBeGreaterThanOrEqual(3);
    for (const { file, tag } of tags) {
      const m = /exifOrientation=\{\s*([\w.?!]+?)\.profileOrientation\s*\}/.exec(tag);
      expect(m, `${file}: de stand komt van een object`).not.toBeNull();
      const obj = m![1]!.replace(/[.?!]/g, "\\$&");
      expect(tag, file).toMatch(new RegExp(`version=\\{\\s*${obj}\\.profileVersion\\s*\\}`));
    }
  });
});
