import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRuntime, findAll } from "./support/hookRuntime";

// WP29 fix-cyclus 3, punt 2 (gate op dev): na het intypen van `verwijder` lag
// de knop "Account verwijderen" onder het toetsenbord. De return-toets heet
// "Gereed", maar verwijderde het account direct.
//
// Invariant: alleen de tik op de knop verwijdert. De return-toets in het
// bevestigingsveld sluit het toetsenbord en doet verder niets; daarna staat de
// knop in beeld. Dat de knop met het toetsenbord open boven het toetsenbord
// staat, toetst de gate (geen unit-test).
//
// DeleteAccountScreen draait hier met tests/support/hookRuntime.ts; de
// componenten en de mutation zijn nep.
//
// Spec: docs/work-packages/WP29-account-verwijderen.md §Fix-cyclus 3 (gate).

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

const backend = vi.hoisted(() => ({ deleteSelf: 0, signOut: 0 }));
const leaf = vi.hoisted(() => ({
  View: function View() {},
  Button: function Button() {},
  Notice: function Notice() {},
  Screen: function Screen() {},
  Text: function Text() {},
  TextField: function TextField() {},
}));

vi.mock("react-native", () => ({
  View: leaf.View,
  StyleSheet: { create: <T>(s: T) => s, absoluteFill: {}, hairlineWidth: 1 },
  Keyboard: { dismiss: () => {} },
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
}));
vi.mock("@clerk/expo", () => ({
  useClerk: () => ({
    signOut: async () => {
      backend.signOut += 1;
    },
  }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => async () => {
    backend.deleteSelf += 1;
    return null;
  },
}));
vi.mock("../src/convexApi", () => ({ api: { users: { deleteSelf: "users.deleteSelf" } } }));
vi.mock("../src/auth/signOutAndWipe", () => ({
  signOutAndWipe: async (signOut: () => Promise<unknown>) => {
    await signOut();
    return true;
  },
}));
vi.mock("../src/components/Button", () => ({ Button: leaf.Button }));
vi.mock("../src/components/Notice", () => ({ Notice: leaf.Notice }));
vi.mock("../src/components/Screen", () => ({ Screen: leaf.Screen }));
vi.mock("../src/components/Text", () => ({ Text: leaf.Text }));
vi.mock("../src/components/TextField", () => ({ TextField: leaf.TextField }));
vi.mock("../src/theme", () => ({ space: { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } }));

const { DeleteAccountScreen } = await import("../src/screens/DeleteAccountScreen");
const { CONFIRM_WORD, setAccountDeleted, setAccountDeleting } = await import(
  "../src/data/accountDeletion"
);

type El = { type: unknown; props: Record<string, unknown> };

function confirmField(tree: unknown): El {
  const [field] = findAll(tree, (el) => el.type === leaf.TextField);
  if (!field) throw new Error("geen bevestigingsveld");
  return field;
}

function deleteButton(tree: unknown): El {
  const [button] = findAll(tree, (el) => el.type === leaf.Button);
  if (!button) throw new Error("geen knop");
  return button;
}

async function typedWord(): Promise<unknown> {
  const tree = rt.runtime.render(() => DeleteAccountScreen());
  (confirmField(tree).props.onChangeText as (t: string) => void)(CONFIRM_WORD);
  return rt.runtime.settle();
}

beforeEach(() => {
  rt.runtime.unmount();
  backend.deleteSelf = 0;
  backend.signOut = 0;
  setAccountDeleting(false);
  setAccountDeleted(false);
});

describe("WP29 fix-cyclus 3, punt 2 — de return-toets in het bevestigingsveld", () => {
  it("verwijdert niet, ook niet met het woord ingetypt", async () => {
    const tree = await typedWord();
    const submit = confirmField(tree).props.onSubmitEditing as ((e?: unknown) => void) | undefined;
    submit?.({ nativeEvent: { text: CONFIRM_WORD } });
    await rt.runtime.settle();
    expect(backend.deleteSelf).toBe(0);
    expect(backend.signOut).toBe(0);
  });

  it("sluit het toetsenbord: één regel, en de return-toets houdt het veld niet vast", async () => {
    const { props } = confirmField(await typedWord());
    expect(props.multiline ?? false).toBe(false);
    expect(props.blurOnSubmit ?? true).toBe(true);
    expect([undefined, "blurAndSubmit"]).toContain(props.submitBehavior);
  });

  it("de tik op de knop verwijdert wel, één keer", async () => {
    const tree = await typedWord();
    expect(deleteButton(tree).props.disabled).toBe(false);
    (deleteButton(tree).props.onPress as () => void)();
    await rt.runtime.settle();
    expect(backend.deleteSelf).toBe(1);
  });
});
