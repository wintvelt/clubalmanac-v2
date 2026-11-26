import type { ImagePickerAsset } from "expo-image-picker";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addToSelection } from "../src/lib/addSelection";

// WP42b — de kiezer op Android met filmpjes (src/data/pickMedia.android.ts).
//   Productdoel en scope: een Android-lid kiest foto's én filmpjes, in
//   dezelfde kiezer als foto's (42a A6), met dezelfde regel voor de plaats
//   (42a B4 en de versieregel: `legacy` + ACCESS_MEDIA_LOCATION vanaf API 35;
//   invariant 4). Geen toegang tot de hele galerij (geen READ_MEDIA_*).
//   A20: de teksten noemen filmpjes en geen iCloud.
//   A20: een filmpje zonder `assetId` (de kiezer van Android geeft er
//   geen) krijgt de sleutel uit de inhoud (42a fix-ronde punt 2), blijft een
//   filmpje met zijn duur, en dezelfde keuze twee keer telt één keer.
// Spec: docs/work-packages/WP42-android.md §Spec-criticus aanvullingen 42b.

const MEDIA_LOCATION = "android.permission.ACCESS_MEDIA_LOCATION";
const permissions = { check: vi.fn(), request: vi.fn() };
let version = 35;

vi.mock("react-native", () => ({
  Platform: {
    OS: "android",
    get Version() {
      return version;
    },
  },
  PermissionsAndroid: {
    PERMISSIONS: { ACCESS_MEDIA_LOCATION: "android.permission.ACCESS_MEDIA_LOCATION" },
    check: (p: string) => permissions.check(p),
    request: (p: string) => permissions.request(p),
  },
}));

// De md5 van "de kopie van de kiezer": hier de uri zelf, zodat dezelfde uri dezelfde sleutel geeft.
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(readonly uri: string) {}
    async digest(algorithm: string) {
      if (algorithm !== "MD5") throw new Error("alleen MD5");
      return `hash-of-${this.uri.split("/").pop()}`;
    }
  },
}));

type PickMedia = typeof import("../src/data/pickMedia.android");

async function load(api: number): Promise<PickMedia> {
  version = api;
  vi.resetModules();
  return await import("../src/data/pickMedia.android");
}

beforeEach(() => {
  permissions.check.mockReset().mockResolvedValue(false);
  permissions.request.mockReset().mockResolvedValue("granted");
});

function video(name: string, extra: Partial<ImagePickerAsset> = {}): ImagePickerAsset {
  return {
    uri: `file:///data/user/0/com.clubalmanac.app/cache/ImagePicker/${name}.mp4`,
    width: 1080,
    height: 1920,
    type: "video",
    duration: 42_000,
    assetId: null,
    mimeType: "video/mp4",
    ...extra,
  };
}

describe("de kiezer op Android biedt foto's en filmpjes aan (productdoel 42b)", () => {
  it.each([30, 33, 34, 35, 36])("API %i: foto's en filmpjes", async (api) => {
    const mod = await load(api);
    expect([...mod.PICK_MEDIA_TYPES].sort()).toEqual(["images", "videos"]);
  });
});

describe("de plaats volgt de regel van foto's (invariant 4, 42a versieregel)", () => {
  it("vanaf API 35: via GET_CONTENT (legacy), en één keer de vraag om ACCESS_MEDIA_LOCATION", async () => {
    const mod = await load(35);
    expect(mod.PICK_EXTRA_OPTIONS).toEqual({ legacy: true });
    await mod.beforePick();
    await mod.beforePick();
    expect(permissions.request).toHaveBeenCalledTimes(1);
    expect(permissions.request).toHaveBeenCalledWith(MEDIA_LOCATION);
  });

  it.each([30, 33, 34])("API %i: de gewone kiezer en geen vraag", async (api) => {
    const mod = await load(api);
    expect(mod.PICK_EXTRA_OPTIONS).toEqual({});
    await mod.beforePick();
    expect(permissions.check).not.toHaveBeenCalled();
    expect(permissions.request).not.toHaveBeenCalled();
  });
});

describe("de teksten op Android (A20)", () => {
  it("geen 'Toegang tot je foto's nodig' en geen 'Instellingen openen' (42a A6 blijft)", async () => {
    const mod = await load(35);
    expect(mod.PICKER_ASKS_ACCESS).toBe(false);
  });

  it("eigen teksten voor Android noemen filmpjes en de 3 minuten, en geen iCloud", async () => {
    const mod = await load(35);
    const texts = mod.PHOTOS_ONLY_TEXTS;
    // `null` betekent: de teksten van iOS; die noemen iCloud bij een mislukt ophalen.
    expect(texts, "op Android geen iCloud-tekst: eigen teksten nodig").not.toBeNull();
    expect(texts!.emptyTitle).toBe("Kies foto's of filmpjes");
    expect(texts!.emptyText).toMatch(/filmpjes/);
    expect(texts!.emptyText).toMatch(/3 minuten/);
    for (const t of Object.values(texts!)) expect(t).not.toMatch(/iCloud|iPhone|Foto's-app/);
  });
});

describe("een filmpje uit de kiezer van Android (A20)", () => {
  it("zonder assetId: een sleutel uit de inhoud; het blijft een filmpje met zijn duur", async () => {
    const mod = await load(35);
    const [out] = await mod.withContentKeys([video("a")]);
    expect(out!.assetId).toBe("md5-hash-of-a.mp4");
    expect(out!.type).toBe("video");
    expect(out!.duration).toBe(42_000);
    expect(out!.uri).toBe(video("a").uri);
  });

  it("in de keuze is het een filmpje; hetzelfde filmpje nog eens kiezen telt één keer", async () => {
    const mod = await load(35);
    const first = await mod.withContentKeys([video("a"), { ...video("p"), type: "image", duration: null }]);
    const { items } = addToSelection([], first);
    expect(items.map((i) => i.kind)).toEqual(["filmpje", "foto"]);
    const again = await mod.withContentKeys([video("a")]);
    const next = addToSelection(items, again);
    expect(next.items).toHaveLength(2);
    expect(next.skipped).toHaveLength(1);
  });
});
