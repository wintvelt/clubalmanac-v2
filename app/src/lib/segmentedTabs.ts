// De indeling van de groepstabs (SegmentedTabs).
// - row: twee of drie tabs naast elkaar (design.md §5, §7).
// - compact (WP41b): vier tabs op één regel, met een kleinere marge en een
//   iets kleinere letter, zodat "Albums" niet afbreekt op een smalle iPhone.
// - grid (WP41): vier tabs bij grote tekst, twee rijen van twee (design.md §3).
import { LARGE_TEXT_SCALE, space } from "../theme/tokens";

export type SegmentedTabsLayout = "row" | "compact" | "grid";

export function segmentedTabsLayout(count: number, fontScale: number): SegmentedTabsLayout {
  if (count < 4) return "row";
  return fontScale >= LARGE_TEXT_SCALE ? "grid" : "compact";
}

/** De horizontale marge binnen een tab. */
export const SEG_TAB_PADDING = { row: space.m, compact: space.xs } as const;
