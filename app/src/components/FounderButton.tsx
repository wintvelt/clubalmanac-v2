import { StyleSheet } from "react-native";
import type { FounderButton as FounderButtonSpec } from "../lib/filmProject";
import { border, radius, size, space, useTheme } from "../theme";
import { Icon } from "./Icon";
import { AnimatedPressable, usePressMotion } from "./Motion";
import { Text } from "./Text";

type Props = {
  // Tekst, icoon links en label uit FOUNDER_BUTTONS (src/lib/filmProject.ts).
  button: FounderButtonSpec;
  onPress: () => void;
  disabled?: boolean;
  // `danger` voor een gevaarlijke actie (Project sluiten, Alles verwijderen).
  tone?: "primary" | "danger";
  // Tekst tijdens bezig, bv. "Downloaden…". Het label blijft dat van de knop.
  busyTitle?: string;
  // Extra voor VoiceOver achter het label, bv. de naam van de inzender.
  labelSuffix?: string;
};

// WP38 (feedback Wouter na besluit 27, punt 1): een kleine knop die alleen de
// oprichter heeft. Zoals SmallButton, met links het icoon van de handeling en
// achter de tekst een gele sleutel (`key`, in `founderKey`). Het label noemt
// "oprichter"; de sleutel zelf is decoratief.
export function FounderButton({ button, onPress, disabled = false, tone = "primary", busyTitle, labelSuffix }: Props) {
  const { colors } = useTheme();
  const tint = tone === "danger" ? colors.danger : colors.primary;
  const press = usePressMotion("button");
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={labelSuffix ? `${button.accessibilityLabel}, ${labelSuffix}` : button.accessibilityLabel}
      accessibilityState={{ disabled, busy: busyTitle !== undefined }}
      disabled={disabled}
      onPress={press.withRelease(onPress)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[styles.button, { borderColor: tint }, press.dim && styles.pressed, disabled && styles.disabled, press.style]}
    >
      <Icon name={button.icon} size={18} color={tint} />
      <Text variant="smallButton" color={tone === "danger" ? "danger" : "primary"}>
        {busyTitle ?? button.title}
      </Text>
      <Icon name="key" size={18} color={colors.founderKey} />
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
