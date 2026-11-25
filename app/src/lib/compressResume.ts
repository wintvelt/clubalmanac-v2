// WP38b besluit 25: verkleinen dat stopt omdat de app de voorgrond verliet,
// probeert het opnieuw zodra de app weer actief is. Ook voor gewone filmpjes
// (WP37). Pure beslissing; het toevoegscherm volgt de AppState.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38b, 38b-12.
//
// - Was de app tijdens het verkleinen niet steeds `active`, dan is een
//   mislukking geen fout van het filmpje: wachten tot de app weer `active` is
//   en opnieuw, met dezelfde upload-id, zonder melding.
// - Hooguit COMPRESS_AUTO_RETRIES keer op rij; daarna de gewone melding van WP37.
// - Bleef de app voor, dan is het de gewone mislukking.

export const COMPRESS_AUTO_RETRIES = 3;

/** Was de app tijdens het verkleinen ergens niet `active` (achtergrond of inactief)? */
export function leftForeground(appStates: readonly string[]): boolean {
  return appStates.some((s) => s !== "active");
}

export function afterCompressFailure(input: { leftForeground: boolean; autoRetries: number }): "opnieuw_als_actief" | "mislukt" {
  return input.leftForeground && input.autoRetries < COMPRESS_AUTO_RETRIES ? "opnieuw_als_actief" : "mislukt";
}
