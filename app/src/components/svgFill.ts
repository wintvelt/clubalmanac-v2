import { useCallback, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";

// WP35: een <Svg> die zijn ouder vult (StyleSheet.absoluteFill). Op iOS doet de
// stijl dat al en is een id per <Svg>; hier dus niets extra. Web: svgFill.web.ts.
export const SVG_FILL: { width?: string; height?: string } = {};

export function useSvgId(base: string): string {
  return base;
}

// react-native-svg rekent een vorm in procenten (Rect van 100%) één keer uit en
// bewaart hem. Wordt de <Svg> daarna groter of kleiner (draaien, Split View),
// dan tekent hij de oude maat opnieuw: bv. de scrim over de cover hield na
// draaien de oude breedte, met rechts een naad. Daarom: verandert de maat na
// de eerste meting, dan een nieuwe <Svg> (`redraw` als key, `layout` erop).
export function useSvgRedraw(): { redraw: number; layout: { onLayout?: (e: LayoutChangeEvent) => void } } {
  const measured = useRef<{ width: number; height: number } | null>(null);
  const [redraw, setRedraw] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const before = measured.current;
    measured.current = { width, height };
    if (before && (before.width !== width || before.height !== height)) setRedraw((n) => n + 1);
  }, []);
  return { redraw, layout: { onLayout } };
}
