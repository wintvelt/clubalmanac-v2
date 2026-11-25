import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { SEG_TAB_PADDING, segmentedTabsLayout } from "../lib/segmentedTabs";
import { radius, size, space, useTheme } from "../theme";
import { Text } from "./Text";

type Props<K extends string> = {
  tabs: readonly { key: K; title: string }[];
  selected: K;
  onSelect: (key: K) => void;
};

// Groepstabs (design.md §5, §7): gekozen is een `segOn`-pil met vette
// `onSegOn`-tekst. Minstens 44 pt hoog; bij grote tekst breekt een titel over
// regels, hij wordt nooit afgekapt (WP16 besluit 5: twee tabs, dus geen 2×2).
// WP41: met vier tabs (Albums, Films, Leden, Geld) twee rijen van twee zodra
// de tekst groot is (design.md §3, fontScale ≥ 1,2). WP41b: met vier op één
// regel een kleinere marge en een iets kleinere letter (lib/segmentedTabs).
export function SegmentedTabs<K extends string>({ tabs, selected, onSelect }: Props<K>) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const layout = segmentedTabsLayout(tabs.length, fontScale);
  const grid = layout === "grid";
  const compact = layout === "compact";
  return (
    <View accessibilityRole="tablist" style={[styles.bar, grid && styles.grid, { backgroundColor: colors.segBg }]}>
      {tabs.map((tab) => {
        const on = tab.key === selected;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(tab.key)}
            style={({ pressed }) => [
              styles.tab,
              grid && styles.gridTab,
              compact && styles.compactTab,
              on && { backgroundColor: colors.segOn },
              pressed && !on && styles.pressed,
            ]}
          >
            <Text
              variant={compact ? (on ? "segTabCompactActive" : "segTabCompact") : on ? "bodyStrong" : "body"}
              color={on ? "onSegOn" : "text"}
              style={styles.title}
            >
              {tab.title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", padding: space.xs, gap: space.xs, borderRadius: radius.pill },
  grid: { flexWrap: "wrap", borderRadius: radius.card },
  gridTab: { flexBasis: "40%" },
  compactTab: { paddingHorizontal: SEG_TAB_PADDING.compact },
  tab: {
    flex: 1,
    minHeight: size.segTab,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SEG_TAB_PADDING.row,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  title: { textAlign: "center" },
  pressed: { opacity: 0.6 },
});
