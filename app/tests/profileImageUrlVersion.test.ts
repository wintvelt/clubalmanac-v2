import { describe, expect, it, vi } from "vitest";
import { profileImageUrl } from "../src/lib/imageUrls";
import { createHookRuntime, findAll } from "./support/hookRuntime";

// Webapp-fix (gezien op prod, Chrome): na een nieuwe profielfoto bleef overal
// de oude staan tot herladen. De profiel-URL was per user gelijk; iOS laadt
// opnieuw (`key={version}` met `cachePolicy="none"`), maar een browser
// hergebruikt voor dezelfde URL het beeld uit zijn geheugen, ook na een
// remount en ondanks `no-cache`. Daarom gaat `profileVersion` mee in de URL:
// een nieuwe versie is een nieuwe URL. Zonder versie blijft de URL zoals hij
// was. Het profielpad (convex/http.ts) leest alleen `formaat`.
//
// Hier ook de echte web-hook (src/data/images.web.tsx) achter de echte
// avatar, met de hook-runtime in plaats van React (tests/support/hookRuntime.ts).

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

// De web-variant: Photo.tsx importeert "../data/images"; op het web is dat
// images.web.tsx (Metro kiest de .web-variant).
vi.mock("../src/data/images", async () => {
  const web = await import("../src/data/images.web");
  return {
    usePhotoLoad: () => ({ source: undefined, attempt: 0, onError: () => {}, retry: () => {} }),
    useProfileSource: web.useProfileSource,
  };
});

vi.mock("@clerk/expo", () => ({
  useAuth: () => ({ isSignedIn: false, userId: null, sessionClaims: undefined, getToken: async () => null }),
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

const SITE = "https://demo-123.eu-west-1.convex.site";

describe("profileImageUrl — de versie in de URL", () => {
  it("twee versies: twee URL's", () => {
    expect(profileImageUrl(SITE, "u1", "klein", "v1")).not.toBe(profileImageUrl(SITE, "u1", "klein", "v2"));
  });

  it("dezelfde versie: dezelfde URL", () => {
    expect(profileImageUrl(SITE, "u1", "klein", "v1")).toBe(profileImageUrl(SITE, "u1", "klein", "v1"));
  });

  it("zonder versie: de URL van voorheen", () => {
    expect(profileImageUrl(SITE, "u1", "klein")).toBe(`${SITE}/beeld/profiel/u1?formaat=klein`);
    expect(profileImageUrl(SITE, "u1", "groot", undefined)).toBe(`${SITE}/beeld/profiel/u1?formaat=groot`);
  });

  it("pad, user en formaat blijven gelijk; de versie is een eigen parameter, gecodeerd", () => {
    const url = new URL(profileImageUrl(SITE, "u 1", "groot", "kg2&formaat=klein#x"));
    expect(url.pathname).toBe("/beeld/profiel/u%201");
    expect(url.searchParams.getAll("formaat")).toEqual(["groot"]);
    expect(url.searchParams.get("versie")).toBe("kg2&formaat=klein#x");
    expect(url.hash).toBe("");
  });

  it("geen token in de URL, ook met versie", () => {
    expect(profileImageUrl(SITE, "u1", "klein", "kg2abc")).not.toMatch(/token|bearer|authorization|sig|jwt/i);
  });
});

type El = { type: unknown; key: string | null; props: Record<string, unknown> };
const HOSTS = new Set<unknown>(Object.values(host));
const isEl = (x: unknown): x is El => typeof x === "object" && x !== null && "type" in x && "props" in x;

/** Klapt eigen componenten uit (type is een functie die geen nep-host is). */
function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!isEl(node)) return node;
  if (typeof node.type === "function" && !HOSTS.has(node.type)) {
    return expand((node.type as (p: unknown) => unknown)(node.props));
  }
  return { ...node, props: { ...node.props, children: expand(node.props.children) } };
}

async function avatarUris(props: Record<string, unknown>): Promise<string[]> {
  const { ProfileAvatar } = await import("../src/components/Photo");
  const h = rt.runtime;
  // images.web.tsx maakt één context: de site-URL.
  expect(h.contexts.length, "sanity: de site-context").toBeGreaterThanOrEqual(1);
  h.provide(h.contexts[0]!, SITE);
  const tree = h.render(() =>
    expand(ProfileAvatar({ userId: "u1", name: "Owen", size: 40, ...props } as Parameters<typeof ProfileAvatar>[0])),
  );
  return findAll(tree, (el) => el.type === host.Image).map(
    (el) => (el.props.source as { uri: string }).uri,
  );
}

describe("de web-avatar geeft de versie door aan de URL", () => {
  it("een nieuwe versie: een nieuwe URL in het beeld", async () => {
    const [a] = await avatarUris({ version: "v1", hasFormats: true });
    const [b] = await avatarUris({ version: "v2", hasFormats: true });
    expect(a).toBe(profileImageUrl(SITE, "u1", "klein", "v1"));
    expect(b).toBe(profileImageUrl(SITE, "u1", "klein", "v2"));
    expect(b).not.toBe(a);
  });

  it("dezelfde versie: dezelfde URL", async () => {
    const [a] = await avatarUris({ version: "v1" });
    const [b] = await avatarUris({ version: "v1" });
    expect(b).toBe(a);
  });

  it("ook het formaat van de avatar gaat mee", async () => {
    const [a] = await avatarUris({ version: "v1", format: "groot" });
    expect(a).toBe(profileImageUrl(SITE, "u1", "groot", "v1"));
  });

  it("zonder versie: de URL van voorheen", async () => {
    const uris = await avatarUris({});
    expect(uris).toEqual([`${SITE}/beeld/profiel/u1?formaat=klein`]);
  });

  it("versie \"0\": de letter, geen beeld", async () => {
    expect(await avatarUris({ version: "0" })).toEqual([]);
  });
});
