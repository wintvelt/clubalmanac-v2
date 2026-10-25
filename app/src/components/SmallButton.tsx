import { Pressable, StyleSheet } from "react-native";
import { border, radius, size, space, useTheme } from "../theme";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

type Props = { title: string; onPress: () => void; icon?: IconName; disabled?: boolean };

// Kleine knop, bv. "Bewerk album". Staat op een eigen regel, nooit naast
// lange tekst (design.md §3).
export function SmallButton({ title, onPress, icon, disabled = false }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { borderColor: colors.primary },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon && <Icon name={icon} size={18} color={colors.primary} />}
      <Text variant="smallButton" color="primary">
        {title}
      </Text>
    </Pressable>
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
