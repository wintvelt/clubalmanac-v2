import type { SelectionAction } from "./photoActions";

// WP40: de selectiestand in het album en in Mijn foto's, als pure logica.
// De kop (titel en Annuleren), de knoppen in de balk onderin, en waar de lijst
// van het album heen scrolt bij Selecteer en bij terug uit de selectie.
// Geen React en geen native modules: getest in tests/selectionBar.test.ts.

export type SelectionPlace = "album" | "mine";

export type SelectionHeader = { title: string; cancelDisabled: boolean };

// A1, A2: het aantal als titel; tijdens een actie "Bezig…" (WP17b invariant
// 15). Annuleren werkt altijd, behalve tijdens een actie (invariant 3).
export function selectionHeader({ count, busy }: { count: number; busy: boolean }): SelectionHeader {
  const title = busy ? "Bezig…" : count === 0 ? "Kies foto's" : `${count} geselecteerd`;
  return { title, cancelDisabled: busy };
}

export type SelectionButton = {
  action: SelectionAction;
  title: string;
  accessibilityLabel: string;
  danger: boolean;
  disabled: boolean;
};

const TITLES: Record<SelectionAction, string> = {
  addToAlbum: "Naar album",
  removeFromAlbum: "Uit album",
  delete: "Verwijderen",
};

// A2: vaste volgorde, Verwijderen (rood) als laatste, zoals in het foto-menu.
const ORDER: Record<SelectionPlace, readonly SelectionAction[]> = {
  album: ["addToAlbum", "removeFromAlbum", "delete"],
  mine: ["addToAlbum", "delete"],
};

function photos(n: number): string {
  return n === 1 ? "1 foto" : `${n} foto's`;
}

// A2, A7: grijs bij nul en tijdens een actie, nooit op grond van wie de foto's
// zijn (WP17b A-keuze 2). De VoiceOver-naam begint met de zichtbare titel en
// noemt het aantal; bij nul alleen de titel (VoiceOver zegt zelf "gedimd").
export function selectionButtons({
  place,
  count,
  busy,
}: {
  place: SelectionPlace;
  count: number;
  busy: boolean;
}): SelectionButton[] {
  return ORDER[place].map((action) => {
    const title = TITLES[action];
    return {
      action,
      title,
      accessibilityLabel: count === 0 ? title : `${title}, ${photos(count)}`,
      danger: action === "delete",
      disabled: count === 0 || busy,
    };
  });
}

// Minder dan een halve punt verschil telt niet: afronding van het scrollen.
const SAME = 0.5;

// A3, besluit 2: bij Selecteer scrolt de lijst tot het raster direct onder de
// kop begint, of zo ver als de lijst kan. Wie al zo ver of verder stond, ziet
// niets bewegen (null). Nooit naar een negatieve positie.
export function enterSelectionScroll({
  offset,
  gridTop,
  maxOffset,
}: {
  offset: number;
  gridTop: number;
  maxOffset: number;
}): number | null {
  const target = Math.max(0, Math.min(gridTop, maxOffset));
  return offset >= target - SAME ? null : target;
}

// A4: terug uit de selectie. Zette Selecteer de lijst ergens heen en staat hij
// daar nog, dan terug naar de plek van vóór Selecteer. Anders (zelf gescrold,
// of Selecteer scrolde niet) blijft hij staan (null).
export function leaveSelectionScroll({
  before,
  entered,
  current,
}: {
  before: number;
  entered: number | null;
  current: number;
}): number | null {
  if (entered === null) return null;
  if (Math.abs(current - entered) > SAME) return null;
  return Math.max(0, before);
}
