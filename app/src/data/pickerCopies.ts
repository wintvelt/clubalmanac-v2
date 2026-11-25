import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

// WP42 fix-ronde 42a, punt 3: de kiezer kopieert elk gekozen beeld naar
// `<cache>/ImagePicker`, op iOS en Android, met de EXIF (en dus de plaats) erin.
// Die kopieën gaan weg zodra ze niet meer nodig zijn: als het toevoegscherm
// sluit, als een nieuwe keuze de oude vervangt, na de profielfoto, en bij de
// start en bij uitloggen wat er nog lag (een app die stopte). Alleen bestanden
// in die map: een filmpje waarvan het origineel naar de map van de originelen
// ging (WP38b), blijft staan. Op het web niets.

const PICKER_DIR = "ImagePicker";

function pickerDir(): Directory | null {
  if (Platform.OS === "web") return null;
  try {
    return new Directory(Paths.cache, PICKER_DIR);
  } catch {
    return null;
  }
}

/** Het pad zonder `file://` en zonder de `/private` die iOS er soms voor zet. */
function plainPath(uri: string): string {
  let path = uri.replace(/^file:\/\//, "");
  try {
    path = decodeURI(path);
  } catch {
    // Laten zoals het is.
  }
  return path.replace(/^\/private\//, "/");
}

/** Ligt dit bestand in de map van de kiezer? */
function isPickerCopy(uri: string, dir: Directory): boolean {
  const base = plainPath(dir.uri).replace(/\/?$/, "/");
  return plainPath(uri).startsWith(base);
}

/** De kopieën van de kiezer weg; andere bestanden laat dit staan. Nooit een fout. */
export function removePickerCopies(uris: readonly string[]): void {
  const dir = pickerDir();
  if (!dir) return;
  for (const uri of uris) {
    if (!isPickerCopy(uri, dir)) continue;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // Al weg, of de volgende start ruimt het op.
    }
  }
}

/** De hele map van de kiezer leeg: bij de start en bij uitloggen. Nooit een fout. */
export function clearPickerCopies(): void {
  const dir = pickerDir();
  if (!dir) return;
  try {
    if (dir.exists) dir.delete();
  } catch {
    // Volgende keer opnieuw.
  }
}

let cleared = false;

/**
 * Eén keer per start de map leeg; daarna niet meer, want dan kunnen er
 * kopieën staan die het toevoegscherm nog gebruikt.
 */
export function clearPickerCopiesAtStart(): void {
  if (cleared) return;
  cleared = true;
  clearPickerCopies();
}
