import DateTimePicker from "@react-native-community/datetimepicker";
import { StyleSheet, View } from "react-native";
import { dayFromPicker, pickerDate, type Day } from "../lib/groupAdmin";
import { radius, useTheme } from "../theme";

type Props = { day: Day; min: Day; max: Day; onChange: (day: Day) => void };

// WP38: een dag kiezen tussen `min` en `max` (de einddatum van een
// filmproject). Op iOS het wiel; de web-variant staat in DayPicker.web.tsx.
// De kiezer werkt met de dag van het toestel; die dag telt zoals gekozen.
export function DayPicker({ day, min, max, onChange }: Props) {
  const { colors, scheme } = useTheme();
  return (
    <View style={[styles.picker, { backgroundColor: colors.field, borderColor: colors.fieldLine }]}>
      <DateTimePicker
        value={pickerDate(day)}
        mode="date"
        display="spinner"
        locale="nl-NL"
        themeVariant={scheme}
        textColor={colors.text}
        minimumDate={new Date(min.year, min.month - 1, min.day, 0, 0, 0, 0)}
        maximumDate={new Date(max.year, max.month - 1, max.day, 23, 59, 0, 0)}
        onValueChange={(_event, date) => onChange(dayFromPicker(date))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { borderWidth: 1, borderRadius: radius.field, overflow: "hidden" },
});
