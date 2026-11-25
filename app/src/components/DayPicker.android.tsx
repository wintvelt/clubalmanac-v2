import type { Day } from "../lib/groupAdmin";
import { AndroidDayField } from "./AndroidDayField";

type Props = { day: Day; min: Day; max: Day; onChange: (day: Day) => void };

// WP42 A4: de einddatum van een filmproject op Android. Een veld met de
// gekozen dag; tikken opent de datumkiezer van Android, met dezelfde eerste
// en laatste dag als het wiel op iOS (DayPicker.tsx).
export function DayPicker({ day, min, max, onChange }: Props) {
  return <AndroidDayField day={day} min={min} max={max} onChange={onChange} />;
}
