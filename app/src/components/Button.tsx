import { ActivityIndicator, StyleSheet, View } from "react-native";
import { border, radius, size, space, useTheme } from "../theme";
import { Icon, type IconName } from "./Icon";
import { AnimatedPressable, usePressMotion } from "./Motion";
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
  // WP39 besluit 7: grijs zoals uit, maar wel te tikken (bv. "Kies eerst een
  // album", dat het kiesscherm opent). Alleen voor een hoofdknop.
  muted?: boolean;
};

export function Button({
  title,
  onPress,
  variant = "cta",
  icon,
  busy = false,
  busyTitle,
  disabled = false,
  muted = false,
}: Props) {
  const { colors } = useTheme();
  const inactive = busy || disabled;
  const cta = variant === "cta";
  // WP39 besluit 8: een hoofdknop die uit staat, is grijs (niet een
  // doorzichtige oranje knop); `muted` ziet er hetzelfde uit.
  const grey = cta && (disabled || muted);
  const fg = grey ? colors.muted : cta ? colors.onCta : colors.primary;
  // WP33 invariant 6: krimpt bij indrukken; uit of bezig krimpt hij niet (B4).
  const press = usePressMotion("button");
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={busy ? (busyTitle ?? title) : title}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={press.withRelease(onPress)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        styles.button,
        grey
          ? { backgroundColor: colors.line }
          : cta
            ? { backgroundColor: colors.cta }
            : { borderWidth: border.secondaryButton, borderColor: colors.primary },
        press.dim && styles.pressed,
        disabled && !cta && styles.disabled,
        press.style,
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
    </AnimatedPressable>
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
