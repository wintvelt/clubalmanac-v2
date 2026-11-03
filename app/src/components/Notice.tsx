import { useEffect, type ReactNode } from "react";
import { AccessibilityInfo, StyleSheet, useWindowDimensions, View } from "react-native";
import { border, radius, size, space, useTheme } from "../theme";
import { Icon } from "./Icon";
import { Text } from "./Text";

type Props = {
  kind: "error" | "success";
  // Vette kop: wat er gebeurde. Mag ontbreken als de melding één zin is.
  title?: string;
  // Wat je nu kunt doen.
  message?: string;
  // Bv. de knop "Opnieuw" bij een fout bij laden.
  children?: ReactNode;
};

// Eén patroon voor fout en bevestiging (invariant 5, design.md §6). Staat
// direct onder de knop die hem veroorzaakte en blijft tot de volgende actie.
// Kleur is nooit het enige signaal: altijd icoon en tekst. Bij grote tekst
// staat het icoon boven de tekst, zodat de titel de volle breedte krijgt en
// niet midden in een woord breekt (design.md §10, bevinding 14).
export function Notice({ kind, title, message, children }: Props) {
  const { colors } = useTheme();
  const tint = kind === "error" ? colors.danger : colors.success;
  const stacked = useWindowDimensions().fontScale >= LARGE_TEXT_SCALE;

  useEffect(() => {
    const spoken = [title, message].filter(Boolean).join(". ");
    if (spoken) AccessibilityInfo.announceForAccessibility(spoken);
  }, [title, message]);

  return (
    <View
      accessibilityRole={kind === "error" ? "alert" : "summary"}
      accessibilityLiveRegion="polite"
      style={[
        styles.notice,
        stacked && styles.stacked,
        { backgroundColor: colors.surface, borderColor: tint },
      ]}
    >
      <Icon name={kind === "error" ? "alert" : "check"} size={size.noticeIcon} color={tint} />
      <View style={stacked ? styles.bodyStacked : styles.body}>
        {title && <Text variant="bodyStrong">{title}</Text>}
        {message && <Text variant={title ? "meta" : "body"}>{message}</Text>}
        {children}
      </View>
    </View>
  );
}

// Dezelfde grens als de groepstabs (design.md §3).
const LARGE_TEXT_SCALE = 1.2;

const styles = StyleSheet.create({
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.m,
    paddingVertical: space.m + 2,
    paddingHorizontal: space.l,
    borderWidth: border.notice,
    borderRadius: radius.listBlock,
  },
  stacked: { flexDirection: "column" },
  body: { flex: 1, gap: space.xs },
  bodyStacked: { alignSelf: "stretch", gap: space.xs },
});
