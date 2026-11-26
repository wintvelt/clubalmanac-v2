import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Pressable, StyleSheet } from "react-native";
import { dayFromPicker, formatDay, pickerDate, type Day } from "../lib/groupAdmin";
import { border, radius, size, space, useTheme } from "../theme";
import { Icon } from "./Icon";
import { Text } from "./Text";

type Props = { day: Day; min?: Day; max?: Day; invalid?: boolean; onChange: (day: Day) => void };

// WP42 A4: een dag kiezen op Android. Het wiel van iOS bestaat daar niet (het
// component opent op Android bij elke render een dialoog). Hier staat de dag
// als veld; tikken opent de datumkiezer van Android, met dezelfde grenzen.
// Annuleren of terug laat de dag staan. Alleen voor Android.
export function AndroidDayField({ day, min, max, invalid = false, onChange }: Props) {
  const { colors } = useTheme();
  const open = () =>
    DateTimePickerAndroid.open({
      value: pickerDate(day),
      mode: "date",
      ...(min ? { minimumDate: new Date(min.year, min.month - 1, min.day, 0, 0, 0, 0) } : {}),
      ...(max ? { maximumDate: new Date(max.year, max.month - 1, max.day, 23, 59, 0, 0) } : {}),
      firstDayOfWeek: 1,
      positiveButton: { label: "OK" },
      negativeButton: { label: "Annuleren" },
      onValueChange: (_event, date) => onChange(dayFromPicker(date)),
    });
  const text = formatDay(day);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      onPress={open}
      android_ripple={{ color: colors.line }}
      style={[
        styles.field,
        {
          backgroundColor: colors.field,
          borderColor: invalid ? colors.danger : colors.fieldLine,
          borderWidth: invalid ? border.fieldFocus : border.field,
        },
      ]}
    >
      <Text style={styles.grow}>{text}</Text>
      <Icon name="calendar" color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: size.field,
    borderRadius: radius.field,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    overflow: "hidden",
  },
  grow: { flex: 1 },
});
