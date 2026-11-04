import { Pressable, StyleSheet, View } from "react-native";
import { photoLayers, radius, size, space } from "../theme";
import { Icon } from "./Icon";
import { Text } from "./Text";

type Props = { title: string; onPress: () => void };

// Terugknop op een cover (design.md §7): een zwevende pil linksboven, onder de
// statusbalk, minstens 44 pt hoog, wit op de pil-laag (§2). VoiceOver leest
// "Terug naar <scherm>" (§9).
export function BackPill({ title, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Terug naar ${title}`}
      onPress={onPress}
      hitSlop={space.xs}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      <View style={[StyleSheet.absoluteFill, styles.layer]} />
      <Icon name="back" size={20} color={photoLayers.text} />
      <Text variant="backPill" style={styles.text}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: size.touchMin,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingLeft: space.s,
    paddingRight: space.m + 2,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  layer: { backgroundColor: photoLayers.pill.color, opacity: photoLayers.pill.opacity },
  text: { color: photoLayers.text },
  pressed: { opacity: 0.7 },
});
