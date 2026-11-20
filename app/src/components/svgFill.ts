// WP35: een <Svg> die zijn ouder vult (StyleSheet.absoluteFill). Op iOS doet de
// stijl dat al en is een id per <Svg>; hier dus niets extra. Web: svgFill.web.ts.
export const SVG_FILL: { width?: string; height?: string } = {};

export function useSvgId(base: string): string {
  return base;
}
