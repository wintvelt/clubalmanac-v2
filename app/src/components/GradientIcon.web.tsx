import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect } from "react";
import { gradientStops, useTheme } from "../theme";
import { ioniconName, type IconName } from "./Icon";

type Props = { name: IconName; size: number };

// WP38 (feedback Wouter, derde ronde): de web-variant van GradientIcon. Het
// merkverloop (`gradStart` → `gradEnd`, 135°, met de stops van Gradient) als
// achtergrond, geknipt tot de glyph met CSS `background-clip: text`. Geen
// masked-view op het web.
// Safari knipt de achtergrond niet tot de tekst van een genest element: het
// verloop, `background-clip: text` en de doorzichtige kleur staan daarom op
// het element dat de glyph zelf tekent (de glyph van Ionicons, rechtstreeks
// in zijn lettertype), niet op een omhulsel rond `Icon`.
export function GradientIcon({ name, size }: Props) {
  const { colors } = useTheme();
  const [start, full, end] = gradientStops;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const glyphMap = Ionicons.glyphMap as Record<string, number>;
  const code = glyphMap[ioniconName(name)];
  // Het lettertype staat er meestal al (elk ander icoon laadt het); anders nu.
  useEffect(() => {
    void Ionicons.loadFont().catch(() => {});
  }, []);
  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      {code !== undefined && (
        <span
          style={{
            fontFamily: Ionicons.getFontFamily(),
            fontSize: size,
            lineHeight: `${size}px`,
            fontStyle: "normal",
            fontWeight: "normal",
            display: "inline-block",
            backgroundImage: `linear-gradient(135deg, ${colors.gradStart} ${pct(start)}, ${colors.gradEnd} ${pct(full)}, ${colors.gradEnd} ${pct(end)})`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            color: "transparent",
          }}
        >
          {String.fromCodePoint(code)}
        </span>
      )}
    </div>
  );
}
