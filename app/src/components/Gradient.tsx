import { StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { gradientStops } from "../theme";

type Props = { from: string; to: string; radius?: number };

// Verloop onder 135° (linksboven naar rechtsonder) dat zijn ouder vult, met
// de stops van het merkverloop: `to` vol vanaf 76%.
export function Gradient({ from, to, radius = 0 }: Props) {
  const [start, full, end] = gradientStops;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset={start} stopColor={from} />
          <Stop offset={full} stopColor={to} />
          <Stop offset={end} stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" rx={radius} ry={radius} fill="url(#grad)" />
    </Svg>
  );
}
