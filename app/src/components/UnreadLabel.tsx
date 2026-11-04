import { StyleSheet, View } from "react-native";
import { unreadBadge } from "../lib/groups";
import { radius, space, useTheme } from "../theme";
import { Text } from "./Text";

// Het "nieuw"-label (design.md §5): "3 nieuw" op `cta`, nooit alleen een
// stip. Het getal komt van de backend en staat er volledig (WP16 invariant 1).
// VoiceOver leest "3 nieuwe foto's". 0 geeft niets.
export function UnreadLabel({ count }: { count: number }) {
  const { colors } = useTheme();
  const badge = unreadBadge(count);
  if (!badge) return null;
  return (
    <View
      accessible
      accessibilityLabel={badge.accessibilityLabel}
      style={[styles.label, { backgroundColor: colors.cta }]}
    >
      <Text variant="badge" color="onCta">
        {badge.text} nieuw
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    alignSelf: "flex-start",
    paddingHorizontal: space.s + 2,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
});
