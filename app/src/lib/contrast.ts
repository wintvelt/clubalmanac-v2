// Contrast volgens WCAG 2.x (relative luminance, sRGB). Voor de check dat
// elk tekst/achtergrond-paar uit de tokens de norm haalt (WP-Design
// invariant 4).

export const AA_TEXT = 4.5;
// Grote tekst, iconen die iets betekenen, randen van bedieningselementen.
export const AA_LARGE_OR_UI = 3;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`Geen #RRGGBB-kleur: ${hex}`);
  const n = parseInt(m[1], 16);
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
