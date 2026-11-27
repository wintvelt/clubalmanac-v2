import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import {
  pendingPickAction,
  pickMarkFromStore,
  pickMarkToStore,
  type PendingPickAction,
  type PendingResult,
  type PickMark,
} from "../lib/pendingPick";
import { clearPickerCopiesAtStart, removePickerCopies } from "./pickerCopies";

// WP42c invariant 8, A36 (punt 7 van 42a): sluit Android de app terwijl de
// kiezer open is, dan bewaart expo-image-picker de keuze, en geeft
// `getPendingResultAsync` hem na de volgende start. De app onthoudt vóór het
// openen waarvoor (toevoegen met het album van toen, of de profielfoto) en
// wanneer, in een klein bestand; zo komt een profielfoto nooit in het
// toevoegscherm. Zelfde exports als pendingPick.ts.
//
// Volgorde bij de start: eerst de map van de kiezer leeg (de kopieën van een
// vorige keer), dan pas `getPendingResultAsync`: die maakt de kopieën van de
// bewaarde keuze op dat moment.

const MARK_FILE = "clubalmanac-pending-pick.json";

function markFile(): File | null {
  try {
    return new File(Paths.document, MARK_FILE);
  } catch {
    return null;
  }
}

export function markPick(mark: PickMark): void {
  try {
    const file = markFile();
    if (!file) return;
    if (!file.exists) file.create();
    file.writeSync(pickMarkToStore(mark));
  } catch {
    // Zonder doel: na een gesloten app hooguit "niets".
  }
}

export function clearPickMark(): void {
  try {
    const file = markFile();
    if (file?.exists) file.delete();
  } catch {
    // De volgende start leest het, en wist het dan.
  }
}

function readMark(): PickMark | null {
  try {
    const file = markFile();
    if (!file?.exists) return null;
    return pickMarkFromStore(file.textSync());
  } catch {
    return null;
  }
}

let taken = false;

export async function takePendingPick(): Promise<PendingPickAction<ImagePicker.ImagePickerAsset>> {
  if (taken) return { kind: "niets" };
  taken = true;
  clearPickerCopiesAtStart();
  const mark = readMark();
  clearPickMark();
  let result: PendingResult<ImagePicker.ImagePickerAsset>;
  try {
    const pending = await ImagePicker.getPendingResultAsync();
    result = pending as PendingResult<ImagePicker.ImagePickerAsset>;
  } catch (e) {
    const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
    result = { code: typeof code === "string" ? code : "ERR_PENDING_RESULT" };
  }
  const action = pendingPickAction({ mark, result, now: Date.now() });
  if (action.kind === "weg") removePickerCopies(action.uris);
  return action;
}
