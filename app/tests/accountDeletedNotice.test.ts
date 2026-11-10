import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRuntime, findAll } from "./support/hookRuntime";

// WP29 fix-cyclus 3, punt 1 (gate op dev): na Account verwijderen toonde het
// inlogscherm geen "Je account is verwijderd." (invariant 7). Rond het
// uitloggen haalt de app het inlogscherm weg en zet het opnieuw neer (poort,
// guards, router.replace). Een melding die eindigt bij het weghalen van het
// scherm, is dan al weg voordat het lid hem ziet.
//
// Invariant: de bevestiging hoort bij de app-sessie, niet bij één exemplaar
// van het scherm. Weghalen en opnieuw neerzetten verandert niets. Hij eindigt
// pas als het lid een nieuwe login begint: de tik op "Stuur code" (of de
// return-toets in het e-mailveld). Een herstart van de app wist hem ook (hij
// staat alleen in het geheugen).
//
// LoginScreen draait hier met tests/support/hookRuntime.ts. De eigen
// onderdelen van het scherm (zoals de melding) rendert de test mee; de
// gedeelde componenten zijn nep.
//
// Spec: docs/work-packages/WP29-account-verwijderen.md §Fix-cyclus 3 (gate).

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

const login = vi.hoisted(() => ({ sendCode: [] as string[] }));
const leaf = vi.hoisted(() => {
  const make = (name: string) => {
    const f = function () {
      return null;
    };
    Object.defineProperty(f, "name", { value: name });
    return f;
  };
  return {
    View: make("View"),
    Image: make("Image"),
    Button: make("Button"),
    Gradient: make("Gradient"),
    LinkButton: make("LinkButton"),
    Notice: make("Notice"),
    Screen: make("Screen"),
    Text: make("Text"),
    TextField: make("TextField"),
  };
});

vi.mock("react-native", () => ({
  Image: leaf.Image,
  View: leaf.View,
  StyleSheet: { create: <T>(s: T) => s, absoluteFill: {}, hairlineWidth: 1 },
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("../src/auth/deviceClerkStorage", () => ({
  useClerkWipeFailed: () => false,
  wipeClerkStorage: async () => true,
}));
vi.mock("../src/auth/useEmailCodeLogin", () => ({
  useEmailCodeLogin: () => ({
    step: { step: "email" },
    busy: false,
    feedback: null,
    sendCode: async (email: string) => {
      login.sendCode.push(email);
    },
    submitCode: async () => {},
    resendCode: async () => {},
    changeEmail: async () => {},
  }),
}));
vi.mock("../src/components/Button", () => ({ Button: leaf.Button }));
vi.mock("../src/components/Gradient", () => ({ Gradient: leaf.Gradient }));
vi.mock("../src/components/LinkButton", () => ({ LinkButton: leaf.LinkButton }));
vi.mock("../src/components/Notice", () => ({ Notice: leaf.Notice }));
vi.mock("../src/components/Screen", () => ({ Screen: leaf.Screen }));
vi.mock("../src/components/Text", () => ({ Text: leaf.Text }));
vi.mock("../src/components/TextField", () => ({ TextField: leaf.TextField }));
vi.mock("../src/theme", () => ({
  size: { maxTextColumn: 640, screenMargin: 16 },
  space: { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 },
  useTheme: () => ({ colors: { washStart: "#fff", washEnd: "#eee" }, scheme: "light" }),
}));

const { LoginScreen } = await import("../src/screens/LoginScreen");
const { setAccountDeleted, setAccountDeleting } = await import("../src/data/accountDeletion");

type El = { type: unknown; key: string | null; props: Record<string, unknown> };
const isElement = (x: unknown): x is El =>
  typeof x === "object" && x !== null && "type" in x && "props" in x;
const leaves = new Set<unknown>(Object.values(leaf));

// Rendert de eigen onderdelen van het scherm mee, in dezelfde hook-runtime.
// De gedeelde componenten (leaves) blijven elementen, zodat de test hun props
// kan lezen.
function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!isElement(node)) return node;
  if (typeof node.type === "function" && !leaves.has(node.type)) {
    return expand((node.type as (p: unknown) => unknown)(node.props));
  }
  const { children } = node.props;
  if (children === undefined || typeof children === "function") return node;
  return { ...node, props: { ...node.props, children: expand(children) } };
}

const mount = () => rt.runtime.render(() => expand(LoginScreen()));

const DELETED = /account is verwijderd/i;
function confirmationShown(tree: unknown): boolean {
  return (
    findAll(tree, (el) => {
      if (el.type !== leaf.Notice) return false;
      const { title, message, children } = el.props;
      return [title, message, children].some((v) => typeof v === "string" && DELETED.test(v));
    }).length > 0
  );
}

function sendCodeButton(tree: unknown): El {
  const [button] = findAll(tree, (el) => el.type === leaf.Button && el.props.title === "Stuur code");
  if (!button) throw new Error("geen knop Stuur code");
  return button;
}

function emailField(tree: unknown): El {
  const [field] = findAll(tree, (el) => el.type === leaf.TextField && el.props.label === "E-mailadres");
  if (!field) throw new Error("geen veld E-mailadres");
  return field;
}

beforeEach(() => {
  rt.runtime.unmount();
  setAccountDeleting(false);
  setAccountDeleted(false);
  login.sendCode.length = 0;
});

describe("WP29 fix-cyclus 3, punt 1 — 'Je account is verwijderd.' op het inlogscherm", () => {
  it("zonder verwijderen: geen bevestiging", () => {
    expect(confirmationShown(mount())).toBe(false);
  });

  it("na het verwijderen: het inlogscherm toont de bevestiging", () => {
    setAccountDeleted(true);
    expect(confirmationShown(mount())).toBe(true);
  });

  it("weghalen en opnieuw neerzetten (rond het uitloggen): de bevestiging blijft", () => {
    setAccountDeleted(true);
    mount();
    rt.runtime.unmount();
    expect(confirmationShown(mount())).toBe(true);
    // Het verwijderscherm zet "bezig" pas uit ná het uitloggen; ook dat
    // verandert niets.
    setAccountDeleting(false);
    rt.runtime.unmount();
    expect(confirmationShown(mount())).toBe(true);
  });

  it("de tik op Stuur code beëindigt hem, ook na opnieuw neerzetten", async () => {
    setAccountDeleted(true);
    const tree = mount();
    (sendCodeButton(tree).props.onPress as () => void)();
    expect(confirmationShown(await rt.runtime.settle())).toBe(false);
    expect(login.sendCode).toHaveLength(1);
    rt.runtime.unmount();
    expect(confirmationShown(mount())).toBe(false);
  });

  it("de return-toets in het e-mailveld beëindigt hem ook", async () => {
    setAccountDeleted(true);
    const tree = mount();
    (emailField(tree).props.onSubmitEditing as () => void)();
    expect(confirmationShown(await rt.runtime.settle())).toBe(false);
    rt.runtime.unmount();
    expect(confirmationShown(mount())).toBe(false);
  });
});
