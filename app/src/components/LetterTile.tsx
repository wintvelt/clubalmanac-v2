import { StyleSheet, View } from "react-native";
import { initialOf } from "../lib/groups";
import { useTheme } from "../theme";
import { Gradient } from "./Gradient";
import { Text } from "./Text";
import type { TypeRoleName } from "../theme";

type Props = { name: string | null | undefined; size: number; radius: number; variant?: TypeRoleName };

// Een vlak in het verloop met de eerste letter (WP16 besluit 2): de plek van
// de cover of profielfoto tot WP17 het beeld brengt. Decoratief: de rij eromheen
// draagt de naam.
export function LetterTile({ name, size, radius, variant = "groupName" }: Props) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.tile, { width: size, height: size }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Gradient from={colors.gradStart} to={colors.gradEnd} radius={radius} />
      <Text variant={variant} color="onGradient" maxFontSizeMultiplier={1}>
        {initialOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center" },
});
