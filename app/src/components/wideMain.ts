import { createContext, useContext } from "react";

// De rechterkolom van de brede indeling (WideSplit, src/screens/WideSide.tsx).
// Daarin groeit de kolom van Screen tot de hoogte van het venster, en staat
// een lege stand (EmptyState) verticaal in het midden van de ruimte die over
// is (wens Wouter, WP38). Smal (iPhone) en in de zijkolom: false, bovenaan.
export const WideMainContext = createContext(false);

export function useWideMain(): boolean {
  return useContext(WideMainContext);
}
