import { Pressable, StyleSheet, View } from "react-native";
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
export function SegmentedTabs<K extends string>({ tabs, selected, onSelect }: Props<K>) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.bar, { backgroundColor: colors.segBg }]}>
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
              on && { backgroundColor: colors.segOn },
              pressed && !on && styles.pressed,
            ]}
          >
            <Text variant={on ? "bodyStrong" : "body"} color={on ? "onSegOn" : "text"} style={styles.title}>
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
  tab: {
    flex: 1,
    minHeight: size.segTab,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.m,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  title: { textAlign: "center" },
  pressed: { opacity: 0.6 },
});
