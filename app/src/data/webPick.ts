import type { FailReason } from "../lib/upload";
import type { WebPhoto } from "./upload";

// WP36: de ingangen naar de kiezer van de browser. Op iOS doen ze niets: daar
// opent AddPhotosScreen zelf `expo-image-picker`, en Profiel ook. De
// web-variant staat in webPick.web.ts; Metro kiest hem voor de web-build.

export type AddPick = Promise<File[] | null>;

/** De gekozen profielfoto, al gecontroleerd en omgezet; of waarom die niet kan. */
export type ProfilePick = { photo: WebPhoto } | { reason: FailReason };

/** In de tik op "+" of "Foto's toevoegen": de kiezer openen voor `toevoegen`. */
export function startAddPick(): void {}

/** Het toevoeg-scherm neemt de keuze uit de tik over, nu en zolang het open staat. */
export function listenAddPick(_listener: (pick: AddPick) => void): () => void {
  return () => {};
}

/** Profiel: één foto kiezen, in de tik, en meteen controleren. `null`: geannuleerd. */
export function pickProfilePhoto(): Promise<ProfilePick | null> {
  return Promise.resolve(null);
}
