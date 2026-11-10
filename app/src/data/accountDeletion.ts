import { useSyncExternalStore } from "react";

// WP29: account verwijderen, gedeeld tussen het scherm, de poort en het
// inlogscherm. Alleen in het geheugen van deze app-sessie.
//
// 1. "Bezig" (invariant 7). Na `users.deleteSelf` is `users.current` direct
//    `null`; de poort zou dan even "Je account is nog niet klaar" tonen tot het
//    uitloggen klaar is. Zolang dit staat, toont de poort alleen "Laden…".
// 2. "Verwijderd": het inlogscherm toont één keer "Je account is verwijderd."
//    Lukt het uitloggen niet, dan toont de poort dat scherm, met Uitloggen
//    (lib/noUserRowView.ts).

type Listener = () => void;

let deleting = false;
let deleted = false;
let version = 0;
const listeners = new Set<Listener>();

function emit() {
  version += 1;
  for (const l of listeners) l();
}

function useStore<T>(read: () => T): T {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return read();
}

export function setAccountDeleting(value: boolean): void {
  if (deleting === value) return;
  deleting = value;
  emit();
}

export function useAccountDeleting(): boolean {
  return useStore(() => deleting);
}

export function setAccountDeleted(value: boolean): void {
  if (deleted === value) return;
  deleted = value;
  emit();
}

export function useAccountDeleted(): boolean {
  return useStore(() => deleted);
}

/** Het woord dat het lid intypt om te bevestigen (spec §Advies open vraag 1). */
export const CONFIRM_WORD = "verwijder";

export function confirmWordTyped(input: string): boolean {
  return input.trim().toLowerCase() === CONFIRM_WORD;
}
