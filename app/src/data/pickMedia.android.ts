import type { ImagePickerOptions, MediaType } from "expo-image-picker";
import { PermissionsAndroid } from "react-native";

// WP42 A6: op Android in 42a alleen foto's; filmpjes toevoegen komt in 42b.
// De teksten noemen dan geen filmpjes (zoals de webapp) en geen iCloud.
//
// WP42 B4, spike S1 variant (d): de plaats van een foto blijft alleen als de
// kiezer via ACTION_GET_CONTENT opent (`legacy`) én de app het recht
// ACCESS_MEDIA_LOCATION heeft. Dan opent dezelfde fotokiezer van het systeem,
// met meerdere tegelijk. Zonder het recht (geweigerd) komt de foto zonder
// plaats binnen, met zijn datum, zoals in de webapp. Geen toegang tot de hele
// galerij (geen READ_MEDIA_*). Zelfde exports als pickMedia.ts.

const MEDIA_LOCATION = PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION;

export const PICK_MEDIA_TYPES: MediaType[] = ["images"];

export const PICK_EXTRA_OPTIONS: Pick<ImagePickerOptions, "legacy"> = { legacy: true };

// Hooguit één vraag per keer dat de app draait; daarna kiest het lid gewoon.
let asked: Promise<void> | null = null;

export function beforePick(): Promise<void> {
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

export const PHOTOS_ONLY_TEXTS: {
  emptyTitle: string;
  emptyText: string;
  fetchFailed: string;
} | null = {
  emptyTitle: "Kies foto's",
  emptyText: "Kies een of meer foto's om aan een album toe te voegen.",
  fetchFailed: "Je keuze ophalen lukte niet.",
};

export const PICKER_CLOSE_BY_APP_STATE = true;

export const PICKER_ASKS_ACCESS = false;
