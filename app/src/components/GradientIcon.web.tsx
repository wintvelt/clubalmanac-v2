import { gradientStops, useTheme } from "../theme";
import { Icon, type IconName } from "./Icon";

type Props = { name: IconName; size: number };

// WP38 (feedback Wouter, derde ronde): de web-variant van GradientIcon. Het
// merkverloop (`gradStart` → `gradEnd`, 135°, met de stops van Gradient) als
// achtergrond, geknipt tot de glyph met CSS `background-clip: text`; de glyph
// zelf is doorzichtig. Geen masked-view op het web.
export function GradientIcon({ name, size }: Props) {
  const { colors } = useTheme();
  const [start, full, end] = gradientStops;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundImage: `linear-gradient(135deg, ${colors.gradStart} ${pct(start)}, ${colors.gradEnd} ${pct(full)}, ${colors.gradEnd} ${pct(end)})`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
      }}
    >
      <Icon name={name} size={size} color="transparent" />
    </div>
  );
}
