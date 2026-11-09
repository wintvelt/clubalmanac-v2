import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRuntime } from "./support/hookRuntime";

// WP17b fix-cyclus 1, invariant 15 (audit S1): één selectie-actie tegelijk.
//
// Een dubbele tik op "Uit album" stuurde elke foto twee keer; de tweede ronde
// faalde en de melding zei dat het mislukte. Zolang een selectie-actie loopt,
// doet een nieuwe aanroep niets: geen mutation, geen melding. Ook vóór de
// volgende render (de tweede tik op dezelfde functie). Na de melding, of na een
// geannuleerde bevestiging, kan het weer.
//
// `useSelectionActions` draait hier als hook (tests/support/hookRuntime.ts).
// De mutations zijn nep en blijven hangen tot de test ze beantwoordt.
//
// Spec: docs/work-packages/WP17b-foto-acties.md §Fix-cyclus 1.

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

type Call = { fn: string; args: Record<string, unknown>; resolve: () => void; reject: (e: Error) => void };
const backend = vi.hoisted(() => ({ calls: [] as Call[] }));
const alerts = vi.hoisted(() => ({
  list: [] as { title: string; buttons: { text: string; style?: string; onPress?: () => void }[] }[],
}));

vi.mock("convex/react", () => ({
  useMutation: (ref: string) => (args: Record<string, unknown>) =>
    new Promise<void>((resolve, reject) => backend.calls.push({ fn: ref, args, resolve, reject })),
}));
vi.mock("../src/convexApi", () => ({
  api: {
    albums: { removePhoto: "albums.removePhoto", update: "albums.update" },
    photos: { remove: "photos.remove", rotate: "photos.rotate" },
    groups: { update: "groups.update", listMine: "groups.listMine" },
    users: { setProfilePhoto: "users.setProfilePhoto" },
  },
}));
vi.mock("../src/data/useLiveQuery", () => ({ useLiveQuery: () => undefined }));
vi.mock("expo-router", () => ({ router: { push: () => {}, back: () => {} } }));
vi.mock("react-native", () => ({
  ActionSheetIOS: { showActionSheetWithOptions: () => {} },
  Alert: {
    alert: (title: string, _message: string, buttons: (typeof alerts.list)[number]["buttons"]) =>
      alerts.list.push({ title, buttons: buttons ?? [] }),
  },
  Pressable: function Pressable() {},
  View: function View() {},
  StyleSheet: { create: <T>(s: T) => s, absoluteFill: {}, hairlineWidth: 1 },
}));
vi.mock("../src/components/Icon", () => ({ Icon: function Icon() {} }));
vi.mock("../src/components/Notice", () => ({ Notice: function Notice() {} }));
vi.mock("../src/components/SmallButton", () => ({ SmallButton: function SmallButton() {} }));
vi.mock("../src/components/Text", () => ({ Text: function Text() {} }));
vi.mock("../src/theme", () => ({
  useTheme: () => ({ colors: { line: "#ccc", muted: "#888", surface: "#fff", primary: "#00f" } }),
  size: { touchMin: 44, maxTextColumn: 600, screenMargin: 16 },
  space: { xs: 4, s: 8, m: 16 },
}));

type Action = "delete" | "removeFromAlbum";
type Photo = { photoId: string; ownerId: string; addedBy: string };
type Run = (action: Action, selected: readonly Photo[]) => void;

const ME = "u_me";
const CTX = { me: ME, role: "member" };
const MINE: Photo[] = ["p1", "p2", "p3"].map((photoId) => ({ photoId, ownerId: ME, addedBy: ME }));

let feedback: unknown[] = [];
let doneCount = 0;
let run: Run;

async function mountHook() {
  const { useSelectionActions } = await import("../src/screens/PhotoMenu");
  rt.runtime.render(() => {
    run = useSelectionActions({
      albumId: "a1",
      ctx: CTX,
      onFeedback: (f: unknown) => feedback.push(f),
      onDone: () => doneCount++,
    } as unknown as Parameters<typeof useSelectionActions>[0]) as unknown as Run;
    return null;
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** De backend antwoordt: de eerste keer per foto lukt het, een tweede keer is de foto al weg. */
async function answerAll() {
  const handled = new Set<string>();
  for (const call of backend.calls.splice(0)) {
    const key = `${call.fn}:${String(call.args.photoId)}`;
    if (handled.has(key)) call.reject(new Error("Foto niet gevonden"));
    else {
      handled.add(key);
      call.resolve();
    }
  }
  for (let i = 0; i < 5; i++) await tick();
  await rt.runtime.settle();
}

const shown = () => feedback.filter((f) => f !== null) as { kind: string; title: string }[];

function confirmLast() {
  const last = alerts.list.at(-1);
  expect(last, "er is een bevestiging").toBeDefined();
  const yes = last!.buttons.find((b) => b.style === "destructive");
  expect(yes, "bevestig-knop").toBeDefined();
  yes!.onPress?.();
}

function cancelLast() {
  const last = alerts.list.at(-1);
  expect(last, "er is een bevestiging").toBeDefined();
  last!.buttons.find((b) => b.style === "cancel")?.onPress?.();
}

beforeEach(async () => {
  backend.calls.length = 0;
  alerts.list.length = 0;
  feedback = [];
  doneCount = 0;
  await mountHook();
});

describe("invariant 15: een dubbele tik start geen tweede ronde", () => {
  it("Uit album, twee keer op dezelfde functie (vóór een render): elke foto één keer, één melding: gelukt", async () => {
    const first = run;
    first("removeFromAlbum", MINE);
    expect(backend.calls.map((c) => c.args.photoId)).toEqual(["p1", "p2", "p3"]);
    const feedbackAfterFirst = feedback.length;
    first("removeFromAlbum", MINE);
    expect(backend.calls, "geen tweede ronde").toHaveLength(3);
    expect(feedback.length, "een genegeerde tik verandert de melding niet").toBe(feedbackAfterFirst);

    await answerAll();
    expect(shown()).toHaveLength(1);
    expect(shown()[0]!.kind).toBe("success");
    expect(doneCount).toBe(1);
  });

  it("na een render: ook de nieuwe functie start niets zolang de eerste ronde loopt, ook niet een andere actie", async () => {
    run("removeFromAlbum", MINE);
    await rt.runtime.settle();
    run("removeFromAlbum", MINE);
    run("delete", MINE);
    // Een bevestiging mag verschijnen; bevestigen start dan nog steeds niets.
    if (alerts.list.length > 0) confirmLast();
    expect(backend.calls).toHaveLength(3);
    expect(backend.calls.every((c) => c.fn === "albums.removePhoto")).toBe(true);

    await answerAll();
    expect(shown()).toHaveLength(1);
    expect(shown()[0]!.kind).toBe("success");
  });

  it("verwijderen: tijdens de ronde start een tweede bevestigde ronde niets", async () => {
    run("delete", MINE);
    confirmLast();
    expect(backend.calls).toHaveLength(3);
    await rt.runtime.settle();
    run("delete", MINE);
    if (alerts.list.length > 1) confirmLast();
    expect(backend.calls, "geen tweede ronde").toHaveLength(3);

    await answerAll();
    expect(shown()).toHaveLength(1);
    expect(shown()[0]!.kind).toBe("success");
  });
});

describe("invariant 15: daarna kan het weer", () => {
  it("na de melding start een nieuwe actie gewoon", async () => {
    run("removeFromAlbum", MINE);
    await answerAll();
    expect(shown()).toHaveLength(1);
    run("removeFromAlbum", MINE.slice(0, 1));
    expect(backend.calls.map((c) => c.args.photoId)).toEqual(["p1"]);
  });

  it("ook met de functie van vóór de melding", async () => {
    const first = run;
    first("removeFromAlbum", MINE);
    await answerAll();
    first("removeFromAlbum", MINE.slice(0, 1));
    expect(backend.calls).toHaveLength(1);
  });

  it("bevestiging geannuleerd: er loopt niets, en het kan meteen opnieuw", async () => {
    run("delete", MINE);
    cancelLast();
    expect(backend.calls).toHaveLength(0);
    await rt.runtime.settle();
    run("delete", MINE);
    expect(alerts.list.length, "opnieuw een bevestiging").toBe(2);
    confirmLast();
    expect(backend.calls).toHaveLength(3);
  });
});
