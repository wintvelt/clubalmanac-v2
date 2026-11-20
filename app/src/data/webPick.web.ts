import type { WebPhoto } from "./upload";
import { openFilePicker, webPhotoOf } from "./webConvert";

// WP36 A-invariant U9: de kiezer opent in de tik zelf. De "+" en de knop in
// het album openen hem en gaan dan naar `toevoegen`; dat scherm neemt de
// keuze hier over. Annuleert de user, of meldt de browser niets, dan staat er
// op dat scherm een knop "Foto's kiezen".

export type AddPick = Promise<File[] | null>;

let pending: AddPick | null = null;
const listeners = new Set<(pick: AddPick) => void>();

export function startAddPick(): void {
  const pick = openFilePicker(true);
  if (listeners.size === 0) {
    pending = pick;
    return;
  }
  for (const l of listeners) l(pick);
}

export function listenAddPick(listener: (pick: AddPick) => void): () => void {
  listeners.add(listener);
  if (pending) {
    const pick = pending;
    pending = null;
    listener(pick);
  }
  return () => {
    listeners.delete(listener);
  };
}

export async function pickProfilePhoto(): Promise<WebPhoto | null> {
  const files = await openFilePicker(false);
  const file = files?.[0];
  if (!file) return null;
  return (await webPhotoOf(file, { profile: true })).photo;
}
