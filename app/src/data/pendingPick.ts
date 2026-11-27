import type { ImagePickerAsset } from "expo-image-picker";
import type { PendingPickAction, PickMark } from "../lib/pendingPick";

// WP42c A36: de keuze bewaard als Android de app sluit terwijl de kiezer open
// is. Alleen op Android (pendingPick.android.ts); op iOS en het web doet dit
// niets (iOS verandert niet).

/** Vlak vóór het openen van de kiezer: waarvoor en wanneer. */
export function markPick(_mark: PickMark): void {}

/** De kiezer gaf antwoord (of een fout): het doel is niet meer nodig. */
export function clearPickMark(): void {}

/** Bij de start, één keer: wat er met een keuze van een gesloten app moet. */
export async function takePendingPick(): Promise<PendingPickAction<ImagePickerAsset>> {
  return { kind: "niets" };
}
