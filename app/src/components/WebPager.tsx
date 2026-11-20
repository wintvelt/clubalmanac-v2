import type { ReactNode } from "react";

// WP35, webapp-fix 3: het foto-detail op het web (WebPager.web.tsx). Op iOS
// doet de horizontale lijst het zelf (swipen, onMomentumScrollEnd); de
// schermen tonen deze component alleen op het web.
export type WebPagerProps = {
  index: number;
  count: number;
  /** De user wisselt van foto. */
  onChange: (index: number) => void;
  /** De foto in beeld; de route-parameter `photoId` volgt hem. */
  photoId?: string;
  /** De foto op plek `index` (met een `key` per foto). */
  renderPage: (index: number) => ReactNode;
  /** Om de buren voor te laden. */
  photoAt: (index: number) => { photoId: string; hasFormats?: boolean } | undefined;
  /** Dicht bij het eind (Mijn foto's laadt dan meer). */
  onNearEnd?: () => void;
};

export function WebPager(_props: WebPagerProps) {
  return null;
}
