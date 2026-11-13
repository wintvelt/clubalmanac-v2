import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRuntime, deferred, type Deferred } from "./support/hookRuntime";

// WP17d besluit 4, A-invariant 12 (audit N1): delen toont dat het bezig is en
// negeert een tweede tik. Het ophalen van *groot* duurt op 4G een paar
// seconden; zonder teken lijkt er niets te gebeuren en tikt het lid opnieuw.
//
// Aangenomen API (spec §Aangenomen API): `usePhotoMenu(...)` geeft naast
// `open` ook `sharing: boolean`. Die staat aan vanaf de tik op "Delen" (bij
// andermans foto: vanaf "Delen" in de melding) tot het delen klaar is,
// gelukt of niet. Zolang hij aan staat, start een nieuwe tik op "Delen" niets.
// Elk scherm met het foto-menu toont het (de vorm toetst de gate).
//
// `usePhotoMenu` draait hier als hook (tests/support/hookRuntime.ts). Het
// delen zelf (`sharePhoto`) is nep en blijft hangen tot de test het afrondt.

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

type Button = { text: string; style?: string; onPress?: () => void };
const ui = vi.hoisted(() => ({
  sheets: [] as { options: string[]; pick: (index: number) => void }[],
  alerts: [] as { title: string; buttons: Button[] }[],
}));

vi.mock("convex/react", () => ({ useMutation: () => async () => {} }));
vi.mock("../src/convexApi", () => ({
  api: {
    albums: { removePhoto: "albums.removePhoto", update: "albums.update", addPhoto: "albums.addPhoto" },
    photos: { remove: "photos.remove", rotate: "photos.rotate" },
    groups: { update: "groups.update", listMine: "groups.listMine" },
    users: { setProfilePhoto: "users.setProfilePhoto" },
  },
}));
vi.mock("../src/data/useLiveQuery", () => ({ useLiveQuery: () => undefined }));
vi.mock("expo-router", () => ({ router: { push: () => {}, back: () => {} } }));
vi.mock("react-native", () => ({
  ActionSheetIOS: {
    showActionSheetWithOptions: (o: { options: string[] }, pick: (index: number) => void) =>
      ui.sheets.push({ options: o.options, pick }),
    dismissActionSheet: () => {},
  },
  Alert: {
    alert: (title: string, _message: string, buttons?: Button[]) => ui.alerts.push({ title, buttons: buttons ?? [] }),
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

type Outcome = "shared" | "unavailable";
type Photo = { photoId: string; ownerId: string; addedBy: string; ownerName?: string; hasFormats?: boolean };
type Menu = { open: (photo: Photo) => void; sharing: boolean };

const ME = "u_me";
const OTHER = "u_other";
const MINE: Photo = { photoId: "p1", ownerId: ME, addedBy: ME, hasFormats: true };
const THEIRS: Photo = { photoId: "p2", ownerId: OTHER, addedBy: OTHER, ownerName: "Mia", hasFormats: true };

let menu: Menu;
let shares: { photo: Photo; done: Deferred<Outcome> }[] = [];
let feedback: unknown[] = [];

async function mount() {
  const { usePhotoMenu } = await import("../src/screens/PhotoMenu");
  rt.runtime.render(() => {
    menu = usePhotoMenu({
      place: { groupId: "g1", albumId: "a1" },
      ctx: { me: ME, role: "member" },
      photoIds: ["p1", "p2"],
      onFeedback: (f: unknown) => feedback.push(f),
      sharePhoto: (photo: Photo) => {
        const done = deferred<Outcome>();
        shares.push({ photo, done });
        return done.promise;
      },
    } as unknown as Parameters<typeof usePhotoMenu>[0]) as unknown as Menu;
    return null;
  });
}

/** Open het menu bij deze foto en tik op "Delen"; bij andermans foto ook "Delen" in de melding. */
async function tapShare(photo: Photo) {
  const before = ui.alerts.length;
  menu.open(photo);
  const sheet = ui.sheets.at(-1);
  expect(sheet, "het menu opent").toBeDefined();
  const index = sheet!.options.indexOf("Delen");
  expect(index, "Delen staat in het menu").toBeGreaterThanOrEqual(0);
  sheet!.pick(index);
  if (ui.alerts.length > before) {
    ui.alerts.at(-1)!.buttons.find((b) => b.text === "Delen")?.onPress?.();
  }
  await rt.runtime.settle();
}

async function finish(k: number, how: Outcome | Error) {
  const s = shares[k]!;
  if (how instanceof Error) s.done.reject(how);
  else s.done.resolve(how);
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  await rt.runtime.settle();
}

const shown = () => feedback.filter((f) => f !== null);

beforeEach(async () => {
  ui.sheets.length = 0;
  ui.alerts.length = 0;
  shares = [];
  feedback = [];
  await mount();
});

describe("A-invariant 12: delen toont dat het bezig is", () => {
  it("vóór de tik: niet bezig", () => {
    expect(menu.sharing).toBe(false);
  });

  it("eigen foto: bezig vanaf de tik, tot het delen klaar is", async () => {
    await tapShare(MINE);
    expect(shares).toHaveLength(1);
    expect(menu.sharing).toBe(true);
    await finish(0, "shared");
    expect(menu.sharing).toBe(false);
  });

  it("andermans foto: bezig vanaf 'Delen' in de melding", async () => {
    await tapShare(THEIRS);
    expect(shares).toHaveLength(1);
    expect(menu.sharing).toBe(true);
    await finish(0, "shared");
    expect(menu.sharing).toBe(false);
  });

  it("andermans foto, melding geannuleerd: niet bezig", async () => {
    menu.open(THEIRS);
    const sheet = ui.sheets.at(-1)!;
    sheet.pick(sheet.options.indexOf("Delen"));
    ui.alerts.at(-1)!.buttons.find((b) => b.style === "cancel")?.onPress?.();
    await rt.runtime.settle();
    expect(shares).toHaveLength(0);
    expect(menu.sharing).toBe(false);
  });

  it.each([
    ["mislukt", new Error("netwerk")],
    ["niet beschikbaar", "unavailable"],
  ] as const)("%s: daarna niet meer bezig, en één melding", async (_label, how) => {
    await tapShare(MINE);
    await finish(0, how as Outcome | Error);
    expect(menu.sharing).toBe(false);
    expect(shown()).toHaveLength(1);
  });
});

describe("A-invariant 12: een tweede tik tijdens het delen doet niets", () => {
  it("eigen foto: één keer delen, geen melding", async () => {
    await tapShare(MINE);
    await tapShare(MINE);
    expect(shares).toHaveLength(1);
    expect(shown()).toHaveLength(0);
  });

  it("andermans foto: één keer delen", async () => {
    await tapShare(THEIRS);
    await tapShare(THEIRS);
    expect(shares).toHaveLength(1);
  });

  it("een andere foto tijdens het delen: ook niets", async () => {
    await tapShare(MINE);
    await tapShare(THEIRS);
    expect(shares).toHaveLength(1);
    expect(shares[0]!.photo.photoId).toBe("p1");
  });

  it("daarna kan het weer", async () => {
    await tapShare(MINE);
    await finish(0, "shared");
    await tapShare(MINE);
    expect(shares).toHaveLength(2);
    expect(menu.sharing).toBe(true);
  });
});

describe("A-invariant 12: elk scherm met het foto-menu gebruikt `sharing`", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return files(full);
      return /\.tsx?$/.test(name) ? [full] : [];
    });

  it("waar usePhotoMenu wordt aangeroepen, wordt ook sharing gelezen", () => {
    const users = files(SRC).filter(
      (f) => !f.endsWith("PhotoMenu.tsx") && /\busePhotoMenu\(/.test(readFileSync(f, "utf8")),
    );
    expect(users.length, "schermen met het foto-menu").toBeGreaterThan(0);
    const without = users.filter((f) => !/\bsharing\b/.test(readFileSync(f, "utf8")));
    expect(without).toEqual([]);
  });
});
