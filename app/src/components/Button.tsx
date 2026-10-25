import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { border, radius, size, space, useTheme } from "../theme";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

type Props = {
  title: string;
  onPress: () => void;
  // Hoofdknop (`cta`, één per scherm) of tweede knop (rand in `primary`).
  variant?: "cta" | "secondary";
  icon?: IconName;
  busy?: boolean;
  // Tekst naast de spinner, bv. "Code versturen…". Zonder: de titel.
  busyTitle?: string;
  // Uit: alleen met uitleg erboven waarom (design.md §5).
  disabled?: boolean;
};

export function Button({
  title,
  onPress,
  variant = "cta",
  icon,
  busy = false,
  busyTitle,
  disabled = false,
}: Props) {
  const { colors } = useTheme();
  const inactive = busy || disabled;
  const cta = variant === "cta";
  const fg = cta ? colors.onCta : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy ? (busyTitle ?? title) : title}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        cta
          ? { backgroundColor: colors.cta }
          : { borderWidth: border.secondaryButton, borderColor: colors.primary },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.content}>
        {busy ? (
          <ActivityIndicator color={fg} />
        ) : (
          icon && <Icon name={icon} size={22} color={fg} />
        )}
        <Text variant="button" style={{ color: fg }}>
          {busy ? (busyTitle ?? title) : title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: size.button,
    borderRadius: radius.button,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
    justifyContent: "center",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s,
    flexWrap: "wrap",
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
});
