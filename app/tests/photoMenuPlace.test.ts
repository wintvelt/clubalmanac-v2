import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRuntime } from "./support/hookRuntime";

// WP17d besluit 5 (fix-cyclus 2), A-invariant 13: het foto-menu verschijnt bij
// andermans foto, in het album en in het foto-detail.
//
// Gate-vondst: sinds WP17c had `menuActions` de standaard `place = null`.
// PhotoDetailScreen en AlbumScreen vroegen "is er een menu?" zonder de plek, en
// kregen voor andermans foto een lege lijst: geen knop "Acties", geen lang
// drukken. Een gewoon lid zag zo geen "Delen" en geen "Als profielfoto"
// (WP27). Het menu zelf (`open`) kreeg de plek wel.
//
// Wat hier vastligt:
//   - `menuActions` heeft geen standaard-plek meer: elke aanroep geeft de plek
//     (een album, of null voor Mijn foto's). Vergeet je hem, dan faalt de
//     typecheck in plaats van stil een lege lijst.
//   - De schermen vragen niet meer zelf `menuActions`: `usePhotoMenu` geeft
//     `hasActions(photo)`, met dezelfde plek als `open`. Zo kan "is er een
//     menu?" niet meer afwijken van het menu dat opengaat.
//
// Aangenomen API (spec §Aangenomen API): `usePhotoMenu(...)` geeft
// `{ open, sharing, hasActions }`.

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

const ui = vi.hoisted(() => ({ sheets: [] as { options: string[] }[] }));

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
    showActionSheetWithOptions: (o: { options: string[] }) => ui.sheets.push({ options: o.options }),
    dismissActionSheet: () => {},
  },
  Alert: { alert: () => {} },
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

type Photo = { photoId: string; ownerId: string; addedBy: string; ownerName?: string; hasFormats?: boolean };
type Place = { groupId: string; albumId: string } | null;
type Menu = { open: (photo: Photo) => void; hasActions: (photo: Photo) => boolean };

const ME = "u_me";
const OTHER = "u_other";
const MEMBER = { me: ME, role: "member" };
const ALBUM: Place = { groupId: "g1", albumId: "a1" };

const MINE: Photo = { photoId: "p1", ownerId: ME, addedBy: ME, hasFormats: true };
const THEIRS: Photo = { photoId: "p2", ownerId: OTHER, addedBy: OTHER, ownerName: "Mia", hasFormats: true };
const THEIRS_NO_FORMATS: Photo = { ...THEIRS, photoId: "p3", hasFormats: false };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MenuActions = (ctx: any, photo: any, place: any) => string[];

async function lib() {
  const mod = await import("../src/screens/PhotoMenu");
  return { menuActions: mod.menuActions as unknown as MenuActions, usePhotoMenu: mod.usePhotoMenu };
}

let menu: Menu;

async function mount(place: Place) {
  const { usePhotoMenu } = await lib();
  rt.runtime.render(() => {
    menu = usePhotoMenu({
      place,
      ctx: MEMBER,
      photoIds: ["p1", "p2", "p3"],
      onFeedback: () => {},
      sharePhoto: async () => "shared",
    } as unknown as Parameters<typeof usePhotoMenu>[0]) as unknown as Menu;
    return null;
  });
}

function sheetFor(photo: Photo): string[] {
  const before = ui.sheets.length;
  menu.open(photo);
  return ui.sheets.length > before ? ui.sheets.at(-1)!.options : [];
}

beforeEach(() => {
  ui.sheets.length = 0;
});

describe("A-invariant 13: menuActions heeft geen standaard-plek", () => {
  it("drie verplichte parameters (een standaardwaarde telt niet mee in Function.length)", async () => {
    const { menuActions } = await lib();
    expect(menuActions.length).toBe(3);
  });

  it("in een album, andermans foto met formaten: Delen en Als profielfoto", async () => {
    const { menuActions } = await lib();
    const actions = menuActions(MEMBER, THEIRS, ALBUM);
    expect(actions).toContain("share");
    expect(actions).toContain("profilePhoto");
    expect(actions).not.toContain("location");
    expect(actions).not.toContain("delete");
  });

  it("in een album, andermans foto zonder formaten: geen Delen, wel Als profielfoto", async () => {
    const { menuActions } = await lib();
    const actions = menuActions(MEMBER, THEIRS_NO_FORMATS, ALBUM);
    expect(actions).not.toContain("share");
    expect(actions).toContain("profilePhoto");
  });

  it("in een album, eigen foto: zoals nu (delen, locatie, de acties van de eigenaar)", async () => {
    const { menuActions } = await lib();
    expect(menuActions(MEMBER, MINE, ALBUM)).toEqual([
      "share",
      "location",
      "profilePhoto",
      "rotate",
      "removeFromAlbum",
      "delete",
    ]);
  });

  it("Mijn foto's (plek null), eigen foto: zoals nu", async () => {
    const { menuActions } = await lib();
    const { myPhotoActions } = await import("../src/lib/myPhotos");
    expect(menuActions(MEMBER, MINE, null)).toEqual(["share", "location", ...myPhotoActions()]);
  });
});

describe("A-invariant 13: usePhotoMenu zegt zelf of er een menu is, met de plek van open", () => {
  it("in een album: andermans foto heeft een menu, met Delen en Als profielfoto", async () => {
    await mount(ALBUM);
    expect(menu.hasActions(THEIRS)).toBe(true);
    const options = sheetFor(THEIRS);
    expect(options).toContain("Delen");
    expect(options).toContain("Als profielfoto");
  });

  it("in een album: andermans foto zonder formaten heeft ook een menu (Als profielfoto)", async () => {
    await mount(ALBUM);
    expect(menu.hasActions(THEIRS_NO_FORMATS)).toBe(true);
    expect(sheetFor(THEIRS_NO_FORMATS)).toContain("Als profielfoto");
  });

  it("in een album: eigen foto heeft een menu", async () => {
    await mount(ALBUM);
    expect(menu.hasActions(MINE)).toBe(true);
    expect(sheetFor(MINE)).toContain("Overal verwijderen");
  });

  it("hasActions en open zijn het eens: menu ⇔ er gaat een menu open", async () => {
    for (const place of [ALBUM, null]) {
      await mount(place);
      for (const photo of [MINE, THEIRS, THEIRS_NO_FORMATS]) {
        expect(menu.hasActions(photo), `${place ? "album" : "Mijn foto's"} ${photo.photoId}`).toBe(
          sheetFor(photo).length > 0,
        );
      }
    }
  });

  it("Mijn foto's: eigen foto heeft het menu van Mijn foto's", async () => {
    await mount(null);
    expect(menu.hasActions(MINE)).toBe(true);
    const options = sheetFor(MINE);
    expect(options).toContain("Delen");
    expect(options).toContain("Locatie wijzigen");
  });
});

describe("A-invariant 13: de schermen vragen het menu via usePhotoMenu", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return files(full);
      return /\.tsx?$/.test(name) ? [full] : [];
    });
  const rel = (f: string) => f.slice(SRC.length + 1);

  it("buiten PhotoMenu roept geen bestand menuActions zelf aan", () => {
    const hits = files(SRC).filter(
      (f) => !f.endsWith("PhotoMenu.tsx") && /\bmenuActions\(/.test(readFileSync(f, "utf8")),
    );
    expect(hits.map(rel)).toEqual([]);
  });

  it("elk scherm met usePhotoMenu gebruikt hasActions voor de knop of het lang drukken", () => {
    const users = files(SRC).filter(
      (f) => !f.endsWith("PhotoMenu.tsx") && /\busePhotoMenu\(/.test(readFileSync(f, "utf8")),
    );
    expect(users.map(rel).sort()).toEqual(
      ["screens/AlbumScreen.tsx", "screens/MyPhotoDetailScreen.tsx", "screens/MyPhotosScreen.tsx", "screens/PhotoDetailScreen.tsx"],
    );
    const without = users.filter((f) => !/\.hasActions\(/.test(readFileSync(f, "utf8")));
    expect(without.map(rel)).toEqual([]);
  });
});
