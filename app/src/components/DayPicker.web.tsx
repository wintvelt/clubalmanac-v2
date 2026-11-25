import type { Day } from "../lib/groupAdmin";
import { radius, useTheme } from "../theme";

type Props = { day: Day; min: Day; max: Day; onChange: (day: Day) => void };

// WP38 (feedback webapp dev, tweede ronde): op het web is er geen wiel
// (@react-native-community/datetimepicker kent geen web). Daarom het
// datumveld van de browser, met dezelfde grenzen.
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const iso = (d: Day) => `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;

function parse(value: string): Day | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

export function DayPicker({ day, min, max, onChange }: Props) {
  const { colors } = useTheme();
  return (
    <input
      type="date"
      aria-label="Einddatum"
      value={iso(day)}
      min={iso(min)}
      max={iso(max)}
      onChange={(e) => {
        const next = parse(e.currentTarget.value);
        if (next) onChange(next);
      }}
      style={{
        fontSize: 18,
        padding: 12,
        minHeight: 44,
        borderRadius: radius.field,
        border: `1px solid ${colors.fieldLine}`,
        backgroundColor: colors.field,
        color: colors.text,
        fontFamily: "inherit",
      }}
    />
  );
}
