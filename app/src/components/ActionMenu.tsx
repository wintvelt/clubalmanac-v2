import { ActionSheetIOS } from "react-native";

// WP42 A1: één ingang voor de menu's met opties (foto, lid, profielfoto,
// cover, status). Op iOS (en het web) is dit precies het actieblad van iOS,
// met dezelfde argumenten als voorheen. Android heeft geen actieblad (de
// aanroep crasht daar); ActionMenu.android.tsx toont een Android-menu met
// dezelfde opties, volgorde en teksten.

export type ActionMenuOptions = {
  /** Boven het menu, bv. de naam van het lid. */
  title?: string;
  /** Alle knoppen, ook Annuleren (op `cancelButtonIndex`), zoals het iOS-blad. */
  options: string[];
  cancelButtonIndex: number;
  /** Herkenbaar als gevaarlijk (rood). */
  destructiveButtonIndex?: number;
};

/** Toont het menu; `onSelect` krijgt de index, of `cancelButtonIndex` bij sluiten zonder keuze. */
export function showActionMenu(options: ActionMenuOptions, onSelect: (index: number) => void): void {
  ActionSheetIOS.showActionSheetWithOptions(options, onSelect);
}

/** Sluit een open menu zonder keuze. */
export function dismissActionMenu(): void {
  ActionSheetIOS.dismissActionSheet();
}

/** Alleen op Android iets: daar staat het menu in de boom. */
export function ActionMenuHost(): null {
  return null;
}
