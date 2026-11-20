// Het foto-detail op het web (WebPager.web.tsx): wat te doen als het scrollen
// van de lijst stilstaat. Puur, zodat de terugkoppellus te testen is.
//
// De lus (iPhone Safari): de lijst rendert alleen de foto's rond de foto in
// beeld. Wisselt die, dan verandert de inhoud van de lijst en zet Safari de
// scroll-snap zelf op een andere plek. Telde dat als een nieuwe foto, dan
// wisselde de foto in beeld weer, en zo verder: een detail dat met een andere
// foto opent en daarna blijft springen. Daarom telt alleen een gebaar van de
// user (aanraken, trackpad) als bladeren; elke andere verschuiving gaat terug
// naar de foto in beeld.

export type PagerSettle =
  | { kind: "show"; index: number }
  | { kind: "restore"; left: number }
  | { kind: "none" };

/**
 * `gesture`: de user raakte de lijst aan (of veegde met een trackpad) sinds
 * de vorige keer stilstaan. `index`: de foto in beeld volgens het scherm.
 */
export function pagerSettle(p: {
  gesture: boolean;
  scrollLeft: number;
  pageWidth: number;
  index: number;
  count: number;
}): PagerSettle {
  if (!(p.pageWidth > 0) || p.count < 1) return { kind: "none" };
  if (p.gesture) {
    const i = Math.round(p.scrollLeft / p.pageWidth);
    return { kind: "show", index: Math.max(0, Math.min(p.count - 1, i)) };
  }
  const left = p.index * p.pageWidth;
  return Math.abs(p.scrollLeft - left) > 1 ? { kind: "restore", left } : { kind: "none" };
}
