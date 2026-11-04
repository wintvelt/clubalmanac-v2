import { StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { gradientStops } from "../theme";

type Props = { from: string; to: string; radius?: number; angle?: 135 | 90 };

// Verloop dat zijn ouder vult, met de stops van het merkverloop: `to` vol
// vanaf 76%. 135° (linksboven naar rechtsonder) voor vlakken, 90° (links naar
// rechts) voor het streepje naast een jaartal (design.md §2).
export function Gradient({ from, to, radius = 0, angle = 135 }: Props) {
  const [start, full, end] = gradientStops;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="grad" x1="0" y1="0" x2="1" y2={angle === 135 ? "1" : "0"}>
          <Stop offset={start} stopColor={from} />
          <Stop offset={full} stopColor={to} />
          <Stop offset={end} stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" rx={radius} ry={radius} fill="url(#grad)" />
    </Svg>
  );
}
