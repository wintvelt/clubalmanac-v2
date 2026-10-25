import { Pressable, StyleSheet } from "react-native";
import { size, space, useTheme } from "../theme";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

type Props = {
  title: string;
  onPress: () => void;
  // "nav" (blauw, onderstreept) gaat ergens heen, "action" (oranje) doet iets,
  // zoals Nieuwe groep (design.md §5).
  tone?: "nav" | "action";
  icon?: IconName;
  disabled?: boolean;
};

// Tekstknop: minstens 44 pt hoog, ook al is de tekst kleiner.
export function LinkButton({ title, onPress, tone = "nav", icon, disabled = false }: Props) {
  const { colors } = useTheme();
  const color = tone === "nav" ? colors.primary : colors.ctaText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={space.xs}
      style={({ pressed }) => [
        styles.link,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon && <Icon name={icon} size={22} color={color} strokeWidth={2.4} />}
      <Text
        variant="button"
        style={[{ color }, tone === "nav" && styles.underline]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    minHeight: size.touchMin,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space.xs,
  },
  underline: { textDecorationLine: "underline" },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
});
