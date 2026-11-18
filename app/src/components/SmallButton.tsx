import { StyleSheet } from "react-native";
import { border, radius, size, space, useTheme } from "../theme";
import { Icon, type IconName } from "./Icon";
import { AnimatedPressable, usePressMotion } from "./Motion";
import { Text } from "./Text";

type Props = {
  title: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
  // `danger` voor een gevaarlijke actie (Verwijderen), zoals de rij in Profiel.
  tone?: "primary" | "danger";
  accessibilityLabel?: string;
};

// Kleine knop, bv. "Bewerk album". Staat op een eigen regel, nooit naast
// lange tekst (design.md §3).
export function SmallButton({ title, onPress, icon, disabled = false, tone = "primary", accessibilityLabel }: Props) {
  const { colors } = useTheme();
  const tint = tone === "danger" ? colors.danger : colors.primary;
  // WP33 invariant 6: krimpt bij indrukken; uit krimpt hij niet (B4).
  const press = usePressMotion("button");
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[styles.button, { borderColor: tint }, press.dim && styles.pressed, disabled && styles.disabled, press.style]}
    >
      {icon && <Icon name={icon} size={18} color={tint} />}
      <Text variant="smallButton" color={tone === "danger" ? "danger" : "primary"}>
        {title}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: size.smallButton,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    paddingHorizontal: space.m,
    borderWidth: border.secondaryButton,
    borderRadius: radius.button,
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
});
