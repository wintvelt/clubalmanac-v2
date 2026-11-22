import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRuntime } from "./support/hookRuntime";

// WP40 invariant 1 en A9: de acties van de selectie blijven precies wat ze
// waren (WP17b invariant 7, besluit 3, fix-cyclus 1; WP17c invariant 3; WP33
// invariant 10). WP40 verandert alleen de plek en de vorm van de knoppen.
// Deze test pint wat `useSelectionActions` per actie doet, zodat B de balk
// kan herbouwen zonder dat er iets aan de acties verschuift. Hij is nu al
// groen; `selectionBusy.test.ts` pint daarnaast één actie tegelijk.
//
// Per actie: welke mutation met welke argumenten, wanneer er eerst een
// bevestiging komt (en met welke titel), de melding achteraf, `onDone` (de
// selectie stopt) en `onBusyChange`, de tik op het toestel, en niets zonder
// album, doel, context of keuze.
//
// Spec: docs/work-packages/WP40-selectiebalk.md §Testcontract.

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

type Call = { fn: string; args: Record<string, unknown>; resolve: () => void; reject: (e: unknown) => void };
const backend = vi.hoisted(() => ({ calls: [] as Call[] }));
const alerts = vi.hoisted(() => ({
  list: [] as { title: string; message: string; buttons: { text: string; style?: string; onPress?: () => void }[] }[],
}));
const haptics = vi.hoisted(() => ({ taps: 0 }));

vi.mock("convex/react", () => ({
  useMutation: (ref: string) => (args: Record<string, unknown>) =>
    new Promise<void>((resolve, reject) => backend.calls.push({ fn: ref, args, resolve, reject })),
}));
vi.mock("../src/convexApi", () => ({
  api: {
    albums: { removePhoto: "albums.removePhoto", update: "albums.update", addPhoto: "albums.addPhoto" },
    photos: { remove: "photos.remove", rotate: "photos.rotate", flag: "photos.flag" },
    groups: { update: "groups.update", listMine: "groups.listMine" },
    users: { setProfilePhoto: "users.setProfilePhoto" },
  },
}));
vi.mock("../src/data/useLiveQuery", () => ({ useLiveQuery: () => undefined }));
vi.mock("../src/data/haptics", () => ({ successTap: () => haptics.taps++ }));
vi.mock("expo-router", () => ({ router: { push: () => {}, back: () => {} } }));
vi.mock("react-native", () => ({
  ActionSheetIOS: { showActionSheetWithOptions: () => {}, dismissActionSheet: () => {} },
  ActivityIndicator: function ActivityIndicator() {},
  Alert: {
    alert: (title: string, message: string, buttons: (typeof alerts.list)[number]["buttons"]) =>
      alerts.list.push({ title, message, buttons: buttons ?? [] }),
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

type Action = "delete" | "removeFromAlbum" | "addToAlbum";
type Photo = { photoId: string; ownerId: string; addedBy: string };
type Run = (action: Action, selected: readonly Photo[], target?: string) => void;
type Feedback = { kind: "error" | "success"; title: string; message?: string };

const ME = "u_me";
const OTHER = "u_other";
const ALBUM = "a_here";
const TARGET = "a_target";
const mine = (...ids: string[]): Photo[] => ids.map((photoId) => ({ photoId, ownerId: ME, addedBy: ME }));
// Van een ander, door die ander in het album gezet.
const theirs = (...ids: string[]): Photo[] => ids.map((photoId) => ({ photoId, ownerId: OTHER, addedBy: OTHER }));

let feedback: (Feedback | null)[] = [];
let done = 0;
let busyChanges: boolean[] = [];
let run: Run;

async function mount(opts: { albumId?: string; ctx?: { me: string; role: string } | undefined }) {
  const { useSelectionActions } = await import("../src/screens/PhotoMenu");
  rt.runtime.render(() => {
    run = useSelectionActions({
      ...(opts.albumId ? { albumId: opts.albumId } : {}),
      ctx: opts.ctx,
      onFeedback: (f: Feedback | null) => feedback.push(f),
      onDone: () => done++,
      onBusyChange: (b: boolean) => busyChanges.push(b),
    } as unknown as Parameters<typeof useSelectionActions>[0]) as unknown as Run;
    return null;
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** De backend antwoordt op alles wat er nu ligt; `fail` per photoId een fout. */
async function answer(fail: Record<string, unknown> = {}) {
  for (const call of backend.calls) {
    const reason = fail[String(call.args.photoId)];
    if (reason !== undefined) call.reject(reason);
    else call.resolve();
  }
  for (let i = 0; i < 5; i++) await tick();
  await rt.runtime.settle();
}

const shown = () => feedback.filter((f): f is Feedback => f !== null);
const sent = (): Record<string, unknown>[] => backend.calls.map((c) => ({ fn: c.fn, ...c.args }));

function press(style: "destructive" | "cancel") {
  const last = alerts.list.at(-1);
  expect(last, "er is een bevestiging").toBeDefined();
  const button = last!.buttons.find((b) => b.style === style);
  expect(button, `knop ${style}`).toBeDefined();
  button!.onPress?.();
}

const MEMBER = { me: ME, role: "member" };
const ADMIN = { me: ME, role: "admin" };

beforeEach(() => {
  backend.calls.length = 0;
  alerts.list.length = 0;
  feedback = [];
  done = 0;
  busyChanges = [];
  haptics.taps = 0;
});

describe("Verwijderen (WP17b invariant 2 en 7)", () => {
  beforeEach(() => mount({ albumId: ALBUM, ctx: MEMBER }));

  it("eerst een bevestiging met het aantal; pas na bevestigen photos.remove per foto", async () => {
    run("delete", mine("p1", "p2", "p3"));
    expect(backend.calls, "niets vóór de bevestiging").toHaveLength(0);
    expect(alerts.list).toHaveLength(1);
    expect(alerts.list[0]!.title).toBe("3 foto's overal verwijderen?");
    expect(alerts.list[0]!.buttons.find((b) => b.style === "destructive")?.text).toBe("Verwijderen");
    expect(alerts.list[0]!.buttons.find((b) => b.style === "cancel")?.text).toBe("Annuleren");

    press("destructive");
    expect(sent()).toEqual([
      { fn: "photos.remove", photoId: "p1" },
      { fn: "photos.remove", photoId: "p2" },
      { fn: "photos.remove", photoId: "p3" },
    ]);
    expect(busyChanges).toEqual([true]);

    await answer();
    expect(busyChanges).toEqual([true, false]);
    expect(shown()).toEqual([{ kind: "success", title: "3 foto's verwijderd" }]);
    expect(done, "de selectie stopt").toBe(1);
    expect(haptics.taps, "tik na de rode knop, alles gelukt").toBe(1);
  });

  it("één foto: enkelvoud in de bevestiging en de melding", async () => {
    run("delete", mine("p1"));
    expect(alerts.list[0]!.title).toBe("1 foto overal verwijderen?");
    press("destructive");
    await answer();
    expect(shown()).toEqual([{ kind: "success", title: "1 foto verwijderd" }]);
  });

  it("bevestiging geannuleerd: niets verstuurd, geen melding, de selectie blijft", async () => {
    run("delete", mine("p1", "p2"));
    press("cancel");
    await answer();
    expect(backend.calls).toHaveLength(0);
    expect(shown()).toHaveLength(0);
    expect(done).toBe(0);
    expect(busyChanges).toEqual([]);
  });

  it("met foto's van anderen: alleen de eigen, en de bevestiging zegt dat de rest blijft staan", async () => {
    run("delete", [...mine("p1", "p2"), ...theirs("x1")]);
    expect(alerts.list[0]!.title).toBe("2 foto's overal verwijderen?");
    expect(alerts.list[0]!.message).toContain("1 foto van anderen blijven staan.");
    press("destructive");
    expect(sent().map((c) => c.photoId)).toEqual(["p1", "p2"]);
    await answer();
    const f = shown();
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("error");
    expect(f[0]!.title).toBe("2 foto's verwijderd");
    expect(done).toBe(1);
  });

  it("ook een admin verwijdert alleen eigen foto's", async () => {
    await mount({ albumId: ALBUM, ctx: ADMIN });
    run("delete", [...mine("p1"), ...theirs("x1", "x2")]);
    press("destructive");
    expect(sent().map((c) => c.photoId)).toEqual(["p1"]);
  });

  it("alleen foto's van anderen: geen bevestiging, niets verstuurd, 'Er is niets veranderd', de selectie stopt", async () => {
    run("delete", theirs("x1", "x2"));
    expect(alerts.list).toHaveLength(0);
    await answer();
    expect(backend.calls).toHaveLength(0);
    const f = shown();
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("error");
    expect(f[0]!.title).toBe("Er is niets veranderd");
    expect(done).toBe(1);
    expect(haptics.taps).toBe(0);
  });

  it("deels mislukt: een fout met wat wel lukte, geen tik", async () => {
    run("delete", mine("p1", "p2", "p3"));
    press("destructive");
    await answer({ p2: new Error("kapot") });
    const f = shown();
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("error");
    expect(f[0]!.title).toBe("2 foto's verwijderd");
    expect(f[0]!.message).toContain("Bij 1 foto lukte het niet");
    expect(haptics.taps).toBe(0);
    expect(done).toBe(1);
  });
});

describe("Uit album (WP17b invariant 7, besluit 3)", () => {
  it("lid, eigen foto's: geen bevestiging, albums.removePhoto per foto met dit album, geen tik", async () => {
    await mount({ albumId: ALBUM, ctx: MEMBER });
    run("removeFromAlbum", mine("p1", "p2"));
    expect(alerts.list).toHaveLength(0);
    expect(sent()).toEqual([
      { fn: "albums.removePhoto", albumId: ALBUM, photoId: "p1" },
      { fn: "albums.removePhoto", albumId: ALBUM, photoId: "p2" },
    ]);
    await answer();
    expect(shown()).toEqual([{ kind: "success", title: "2 foto's uit het album gehaald" }]);
    expect(done).toBe(1);
    expect(haptics.taps, "geen rode knop, dus geen tik").toBe(0);
  });

  it("lid: wat een ander toevoegde mag niet; dat staat in de melding", async () => {
    await mount({ albumId: ALBUM, ctx: MEMBER });
    run("removeFromAlbum", [...mine("p1"), ...theirs("x1")]);
    expect(alerts.list).toHaveLength(0);
    expect(sent().map((c) => c.photoId)).toEqual(["p1"]);
    await answer();
    const f = shown();
    expect(f[0]!.kind).toBe("error");
    expect(f[0]!.title).toBe("1 foto uit het album gehaald");
  });

  it("admin, met een foto van een ander: eerst een bevestiging, dan alles; na bevestigen een tik", async () => {
    await mount({ albumId: ALBUM, ctx: ADMIN });
    run("removeFromAlbum", [...mine("p1", "p2"), ...theirs("x1")]);
    expect(backend.calls).toHaveLength(0);
    expect(alerts.list).toHaveLength(1);
    expect(alerts.list[0]!.title).toBe("3 foto's uit dit album halen?");
    expect(alerts.list[0]!.message).toContain("is 1 foto van een ander");
    expect(alerts.list[0]!.buttons.find((b) => b.style === "destructive")?.text).toBe("Uit album halen");
    press("destructive");
    expect(sent().map((c) => c.photoId)).toEqual(["p1", "p2", "x1"]);
    await answer();
    expect(shown()).toEqual([{ kind: "success", title: "3 foto's uit het album gehaald" }]);
    expect(haptics.taps).toBe(1);
  });

  it("lid, een foto van een ander die je zelf toevoegde: mag, met bevestiging", async () => {
    await mount({ albumId: ALBUM, ctx: MEMBER });
    run("removeFromAlbum", [{ photoId: "y1", ownerId: OTHER, addedBy: ME }]);
    expect(alerts.list).toHaveLength(1);
    expect(alerts.list[0]!.title).toBe("1 foto uit dit album halen?");
  });

  it("zonder album (Mijn foto's): doet niets, ook geen melding", async () => {
    await mount({ ctx: MEMBER });
    run("removeFromAlbum", mine("p1"));
    await answer();
    expect(backend.calls).toHaveLength(0);
    expect(alerts.list).toHaveLength(0);
    expect(feedback).toEqual([]);
    expect(done).toBe(0);
  });
});

describe("Naar album (WP17c invariant 3)", () => {
  it.each([
    ["in een album", ALBUM],
    ["in Mijn foto's", undefined],
  ])("%s: geen bevestiging, albums.addPhoto per eigen foto naar het gekozen album", async (_label, albumId) => {
    await mount({ albumId, ctx: MEMBER });
    run("addToAlbum", mine("p1", "p2"), TARGET);
    expect(alerts.list).toHaveLength(0);
    expect(sent()).toEqual([
      { fn: "albums.addPhoto", albumId: TARGET, photoId: "p1" },
      { fn: "albums.addPhoto", albumId: TARGET, photoId: "p2" },
    ]);
    expect(busyChanges).toEqual([true]);
    await answer();
    expect(busyChanges).toEqual([true, false]);
    expect(shown()).toEqual([{ kind: "success", title: "2 foto's toegevoegd aan het album" }]);
    expect(done).toBe(1);
    expect(haptics.taps).toBe(0);
  });

  it("alleen eigen foto's, ook voor een admin; de rest staat in de melding", async () => {
    await mount({ albumId: ALBUM, ctx: ADMIN });
    run("addToAlbum", [...mine("p1"), ...theirs("x1")], TARGET);
    expect(sent().map((c) => c.photoId)).toEqual(["p1"]);
    await answer();
    expect(shown()[0]!.kind).toBe("error");
    expect(shown()[0]!.title).toBe("1 foto toegevoegd aan het album");
  });

  it("stond er al in: geen fout, wel genoemd", async () => {
    await mount({ ctx: MEMBER });
    run("addToAlbum", mine("p1", "p2", "p3"), TARGET);
    await answer({ p3: new ConvexError({ code: "ALREADY_IN_ALBUM" }) });
    const f = shown();
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("success");
    expect(f[0]!.title).toBe("2 foto's toegevoegd aan het album");
    expect(f[0]!.message).toContain("1 foto stond al in het album.");
  });

  it("zonder gekozen album: doet niets", async () => {
    await mount({ ctx: MEMBER });
    run("addToAlbum", mine("p1"));
    await answer();
    expect(backend.calls).toHaveLength(0);
    expect(feedback).toEqual([]);
    expect(done).toBe(0);
  });
});

describe("altijd", () => {
  it.each(["delete", "removeFromAlbum", "addToAlbum"] as const)("%s zonder keuze: doet niets", async (action) => {
    await mount({ albumId: ALBUM, ctx: ADMIN });
    run(action, [], TARGET);
    await answer();
    expect(backend.calls).toHaveLength(0);
    expect(alerts.list).toHaveLength(0);
    expect(feedback).toEqual([]);
    expect(done).toBe(0);
  });

  it.each(["delete", "removeFromAlbum", "addToAlbum"] as const)("%s zonder context (nog laden): doet niets", async (action) => {
    await mount({ albumId: ALBUM, ctx: undefined });
    run(action, mine("p1"), TARGET);
    await answer();
    expect(backend.calls).toHaveLength(0);
    expect(alerts.list).toHaveLength(0);
    expect(feedback).toEqual([]);
    expect(done).toBe(0);
  });

  it("een actie haalt eerst de vorige melding weg", async () => {
    await mount({ albumId: ALBUM, ctx: MEMBER });
    run("removeFromAlbum", mine("p1"));
    expect(feedback[0]).toBeNull();
  });
});
