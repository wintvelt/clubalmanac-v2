import type { ImagePickerOptions, MediaType } from "expo-image-picker";

// WP42 A6 en B4: wat deze build in het toevoegscherm kan kiezen, en hoe. Op
// iOS foto's en filmpjes (WP37); pickMedia.android.ts heeft alleen foto's
// (42a) en houdt de plaats (spike S1, variant d). Het web heeft een eigen
// scherm.

/** De soorten in de kiezer. */
export const PICK_MEDIA_TYPES: MediaType[] = ["images", "videos"];

/** Extra opties voor de kiezer van het toevoegscherm; op iOS geen. */
export const PICK_EXTRA_OPTIONS: Pick<ImagePickerOptions, "legacy"> = {};

/** Vlak vóór het openen van de kiezer; op iOS niets. */
export async function beforePick(): Promise<void> {}

/**
 * De lege stand, de uitleg bij het ophalen en de melding als het ophalen
 * mislukt, als ze afwijken van de teksten in AddPhotosScreen.tsx; `null` op
 * iOS: daar gelden die.
 */
export const PHOTOS_ONLY_TEXTS: {
  emptyTitle: string;
  emptyText: string;
  fetchFailed: string;
} | null = null;

/**
 * Zegt de kiezer zelf wanneer hij dicht is? Op iOS via de eigen module
 * (`pickerOnScreen`); op Android is de app niet actief zolang de kiezer
 * openstaat.
 */
export const PICKER_CLOSE_BY_APP_STATE = false;

/**
 * Kan de kiezer falen omdat de app geen toegang tot de foto's heeft? Op iOS
 * wel ("Toegang tot je foto's nodig", met "Instellingen openen"); de
 * fotokiezer van Android vraagt geen toegang.
 */
export const PICKER_ASKS_ACCESS = true;
