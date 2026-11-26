import { File } from "expo-file-system";
import type { ImagePickerAsset, ImagePickerOptions, MediaType } from "expo-image-picker";
import { PermissionsAndroid, Platform } from "react-native";

// WP42b A20: op Android foto's en filmpjes in één kiezer, zoals op iOS
// (42a A6 had alleen foto's). De teksten zijn die van iOS, zonder iCloud: de
// kiezer van Android haalt niets uit de cloud.
//
// WP42 B4, spike S1 variant (d): de plaats van een foto blijft alleen als de
// kiezer via ACTION_GET_CONTENT opent (`legacy`) én de app het recht
// ACCESS_MEDIA_LOCATION heeft. Dan opent dezelfde fotokiezer van het systeem,
// met meerdere tegelijk. Zonder het recht (geweigerd) komt de foto zonder
// plaats binnen, met zijn datum, zoals in de webapp. Geen toegang tot de hele
// galerij (geen READ_MEDIA_*). Zelfde exports als pickMedia.ts.
//
// Fix-ronde 42a, punt 1: dat geldt pas vanaf Android 15 (API 35). Gemeten op
// de emulator: op API 30 en 33 opent `legacy` de app Bestanden in plaats van
// de fotokiezer; op API 34 opent hij de fotokiezer, maar die haalt de plaats
// ook mét het recht weg. Daar dus de gewone kiezer (de fotokiezer, of op een
// toestel zonder fotokiezer de app Bestanden) en geen vraag om het recht. De
// fotokiezer geeft dan geen plaats; de app Bestanden (API 30 op de emulator)
// geeft hem wel, ook zonder het recht.
//
// WP42b invariant 4, A18: dezelfde regel voor de plaats van een filmpje
// (`©xyz`); de kiezer behandelt filmpjes zoals foto's.

const MEDIA_LOCATION = PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION;

/** Vanaf deze Android-versie houdt variant (d) de plaats, met de fotokiezer. */
const PLACE_FROM_API = 35;

const KEEPS_PLACE = Number(Platform.Version) >= PLACE_FROM_API;

export const PICK_MEDIA_TYPES: MediaType[] = ["images", "videos"];

export const PICK_EXTRA_OPTIONS: Pick<ImagePickerOptions, "legacy"> = KEEPS_PLACE ? { legacy: true } : {};

// Hooguit één vraag per keer dat de app draait; daarna kiest het lid gewoon.
let asked: Promise<void> | null = null;

export function beforePick(): Promise<void> {
  if (!KEEPS_PLACE) return Promise.resolve();
  asked ??= (async () => {
    try {
      if (await PermissionsAndroid.check(MEDIA_LOCATION)) return;
      await PermissionsAndroid.request(MEDIA_LOCATION);
    } catch {
      // Geen antwoord: dan zonder plaats.
    }
  })();
  return asked;
}

// De naam is van 42a (alleen foto's); de teksten noemen nu ook filmpjes (A20).
export const PHOTOS_ONLY_TEXTS: {
  emptyTitle: string;
  emptyText: string;
  fetchFailed: string;
  keepOpen: string | null;
} | null = {
  emptyTitle: "Kies foto's of filmpjes",
  emptyText: "Kies een of meer foto's of filmpjes (hooguit 3 minuten) om aan een album toe te voegen.",
  fetchFailed: "Je keuze ophalen lukte niet.",
  // WP42b A22 (B12): op Android stopt verkleinen en versturen als de app wegklikt.
  keepOpen: "Houd Clubalmanac open tot de filmpjes klaar zijn.",
};

export const PICKER_CLOSE_BY_APP_STATE = true;

export const PICKER_ASKS_ACCESS = false;

// WP42 fix-ronde, punt 2: de kiezer van Android geeft geen `assetId` (spike
// S1). Dan een vaste sleutel uit de inhoud: de MD5 van de kopie van de kiezer,
// native berekend. Dezelfde foto geeft dezelfde bytes, dus dezelfde sleutel;
// "Meer selecteren" ontdubbelt erop en dezelfde foto voor hetzelfde album houdt
// zijn upload-id. Lukt het lezen niet, dan zonder sleutel, zoals voorheen.
async function contentKey(uri: string): Promise<string | null> {
  try {
    return `md5-${await new File(uri).digest("MD5")}`;
  } catch {
    return null;
  }
}

export async function withContentKeys(assets: ImagePickerAsset[]): Promise<ImagePickerAsset[]> {
  return Promise.all(
    assets.map(async (asset) => (asset.assetId ? asset : { ...asset, assetId: await contentKey(asset.uri) })),
  );
}
