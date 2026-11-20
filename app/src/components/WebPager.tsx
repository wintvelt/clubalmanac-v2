import type { RefObject } from "react";

// WP35: bladeren in het foto-detail op het web (WebPager.web.tsx). Op iOS doet
// de horizontale lijst het zelf (swipen, onMomentumScrollEnd); hier niets.
export type WebPagerProps = {
  list: RefObject<unknown>;
  index: number;
  count: number;
  pageWidth: number;
  onSettle: (index: number) => void;
  photoId?: string;
};

export function WebPager(_props: WebPagerProps) {
  return null;
}
