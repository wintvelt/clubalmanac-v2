import { useSyncExternalStore } from "react";

// WP40 gate ronde 2: wat de tabbalk en de schermen met een selectiestand van
// elkaar moeten weten.
//
// - "Er meteen weer": valt de selectie weg zonder wissel (het scherm verdwijnt
//   of gaat uit beeld, G3, G4), dan staat de tabbalk er meteen en helemaal
//   (H6). Het scherm zet dit vlak voordat het de verberg-optie weghaalt; de
//   tabbalk leest het bij de eerstvolgende wissel. De vraag vervalt na korte
//   tijd: kwam de tabbalk al terug (een andere tab), dan geldt hij niet voor
//   een latere selectie.
// - "Op zijn plek": de tabbalk staat er weer en neemt weer ruimte in. Pas dan
//   komt de melding na een actie, op haar plek boven de tabbalk (H4).

const SNAP_VALID_MS = 300;
let snapAt: number | null = null;

export function snapTabBarBack(): void {
  snapAt = Date.now();
}

/** Leest en wist de vraag om de tabbalk meteen terug te zetten. */
export function takeTabBarSnap(): boolean {
  const snap = snapAt !== null && Date.now() - snapAt <= SNAP_VALID_MS;
  snapAt = null;
  return snap;
}

let docked = true;
const listeners = new Set<() => void>();

export function setTabBarDocked(value: boolean): void {
  if (docked === value) return;
  docked = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Staat de tabbalk op zijn plek (niet verborgen, niet onderweg)? */
export function useTabBarDocked(): boolean {
  return useSyncExternalStore(subscribe, () => docked, () => true);
}
