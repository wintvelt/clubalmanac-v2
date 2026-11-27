import type { ImagePickerAsset } from "expo-image-picker";

// WP42c A36: wat de start (PendingPickHandler) aan het toevoegscherm geeft na
// een keuze die Android bewaarde: de keuze zelf, of "kies opnieuw". Eén keer:
// het toevoegscherm neemt het bij het openen.

export type AddHandoff =
  | { kind: "toevoegen"; albumId: string | null; assets: ImagePickerAsset[] }
  | { kind: "opnieuw_kiezen"; albumId: string | null };

let pending: AddHandoff | null = null;

export function setAddHandoff(handoff: AddHandoff): void {
  pending = handoff;
}

export function takeAddHandoff(): AddHandoff | null {
  const h = pending;
  pending = null;
  return h;
}
