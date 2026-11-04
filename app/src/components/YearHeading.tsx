import { StyleSheet, View } from "react-native";
import { radius, size, space, useTheme } from "../theme";
import { Gradient } from "./Gradient";
import { Text } from "./Text";

// Jaartal-kop boven de albums van dat jaar (design.md §1, §5): Literata in
// `primary`, met het verloopstreepje (90°) erachter.
export function YearHeading({ year }: { year: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Text variant="yearLarge" color="primary" accessibilityRole="header">
        {year}
      </Text>
      <View style={styles.stripe}>
        <Gradient from={colors.gradStart} to={colors.gradEnd} radius={size.yearStripe / 2} angle={90} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.m },
  stripe: { flex: 1, height: size.yearStripe, borderRadius: radius.pill, overflow: "hidden" },
});
