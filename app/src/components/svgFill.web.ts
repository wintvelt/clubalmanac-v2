import { useId } from "react";

// WP35: in de browser is een <svg> zonder width en height 300 × 150 pixels,
// ook met position absolute en inset 0. Dan loopt een verloop of laag buiten
// zijn vak (lettertegel, avatar, kop). Met 100% vult hij precies zijn ouder.
export const SVG_FILL: { width?: string; height?: string } = { width: "100%", height: "100%" };

// In de browser delen alle <svg>'s op de pagina één verzameling id's: met een
// vast id ("grad") wint de eerste definitie, en krijgt elk verloop de kleuren
// van dat eerste. Een eigen id per verloop.
export function useSvgId(base: string): string {
  return `${base}-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
}
