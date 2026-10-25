import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { size, space, useTheme } from "../theme";
import { Gradient } from "./Gradient";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

// Laden en leeg (design.md §6). Beide staan in het inhoudsgebied; de kop van
// het scherm blijft staan.

export function LoadingState({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.loading} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={colors.primary} />
      {label && <Text color="muted">{label}</Text>}
    </View>
  );
}

type EmptyProps = {
  icon: IconName;
  title: string;
  // Eén zin uitleg.
  text: string;
  // De zichtbare hoofdknop, bv. "Nieuw album".
  children?: ReactNode;
};

export function EmptyState({ icon, title, text, children }: EmptyProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={styles.badge}>
        <Gradient from={colors.gradStart} to={colors.gradEnd} radius={size.emptyIcon / 2} />
        <Icon name={icon} size={40} color={colors.onGradient} />
      </View>
      <Text variant="emptyTitle" style={styles.center} accessibilityRole="header">
        {title}
      </Text>
      <Text color="muted" style={styles.center}>
        {text}
      </Text>
      {children && <View style={styles.action}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: "center", gap: space.m + 2, paddingVertical: 56, paddingHorizontal: space.l },
  empty: { alignItems: "center", gap: space.s + 2, paddingVertical: space.xxl, paddingHorizontal: space.xl },
  badge: {
    width: size.emptyIcon,
    height: size.emptyIcon,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.xs,
  },
  center: { textAlign: "center" },
  action: { alignSelf: "stretch", marginTop: space.s },
});
