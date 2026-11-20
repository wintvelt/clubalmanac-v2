// Het foto-detail op het web (WebPager.web.tsx): één foto tegelijk, zonder
// horizontale scrollcontainer (besluit Wouter na webapp-fix 3). In WebKit liep
// de horizontale lijst zelf weg (scrollLeft sprong elke seconde naar een andere
// foto terwijl beelden binnenkwamen). Nu verandert alleen de user de foto: de
// pijltjes, de pijltoetsen, of een veeg over de drempel.

/** Zoveel moet een veeg minstens horizontaal gaan (px). */
export const SWIPE_MIN_PX = 50;
/** Of zoveel van de breedte, als dat minder is (smalle vakken). */
export const SWIPE_MIN_SHARE = 0.18;
/** Een veeg is horizontaal: minstens zoveel keer zo breed als hoog. */
export const SWIPE_RATIO = 1.5;

/** Eén stap, binnen de grenzen; buiten de lijst: dezelfde index. */
export function stepIndex(index: number, delta: number, count: number): number {
  if (count < 1) return 0;
  const to = index + delta;
  if (to < 0 || to > count - 1) return Math.max(0, Math.min(count - 1, index));
  return to;
}

/**
 * De index na een veeg. `dx` en `dy`: van het neerzetten tot het loslaten.
 * Naar links vegen (dx < 0) is de volgende foto. Te kort, te schuin of buiten
 * de lijst: dezelfde index.
 */
export function swipeIndex(p: { dx: number; dy: number; width: number; index: number; count: number }): number {
  const threshold = Math.min(SWIPE_MIN_PX, Math.max(1, p.width) * SWIPE_MIN_SHARE);
  const ax = Math.abs(p.dx);
  if (!(ax >= threshold) || ax < Math.abs(p.dy) * SWIPE_RATIO) return stepIndex(p.index, 0, p.count);
  return stepIndex(p.index, p.dx < 0 ? 1 : -1, p.count);
}

/** De buren om voor te laden: vorige en volgende, binnen de lijst. */
export function neighbours(index: number, count: number): number[] {
  return [index - 1, index + 1].filter((i) => i >= 0 && i < count);
}
