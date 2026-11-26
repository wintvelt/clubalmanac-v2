import { Directory, Paths } from "expo-file-system";
import { Platform } from "react-native";

// WP42 A7: op Android komt `shareAsync` terug zodra het deelmenu dicht is,
// niet als de ontvangende app (WhatsApp, Gmail) het bestand gelezen heeft. Daar
// blijft het gedeelde bestand dus staan, in een map `delen-…` in de cache, tot
// de volgende keer delen, de volgende start of uitloggen. Op iOS gaat het
// meteen na het delen weg, zoals voorheen. De bestanden hebben geen GPS
// (WP17d: *groot* of het filmpje uit R2, opnieuw opgeslagen zonder EXIF).

export const SHARE_DIR_PREFIX = "delen-";

/** Blijft het gedeelde bestand staan tot later? Alleen op Android. */
export const KEEP_SHARED_FILE = Platform.OS === "android";

/** Ruimt achtergebleven deelbestanden op; alleen op Android, en nooit met een fout. */
export function clearOldShares(): void {
  if (!KEEP_SHARED_FILE) return;
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof Directory && entry.name.startsWith(SHARE_DIR_PREFIX)) {
        try {
          entry.delete();
        } catch {
          // Volgende keer opnieuw.
        }
      }
    }
  } catch {
    // Geen cache te lezen: niets op te ruimen.
  }
}
