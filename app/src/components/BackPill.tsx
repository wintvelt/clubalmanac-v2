import { StyleSheet, View } from "react-native";
import { photoLayers, radius, size, space } from "../theme";
import { Icon } from "./Icon";
import { AnimatedPressable, useHeaderItemVisible, usePressMotion } from "./Motion";
import { Text } from "./Text";

type Props = { title: string; onPress: () => void };

// Terugknop op een cover (design.md §7): een zwevende pil linksboven, onder de
// statusbalk, minstens 44 pt hoog, wit op de pil-laag (§2). VoiceOver leest
// "Terug naar <scherm>" (§9). WP33: krimpt bij indrukken; vervaagd in de kop
// doet een tik niets (A3), VoiceOver bedient hem wel.
export function BackPill({ title, onPress }: Props) {
  const press = usePressMotion("button");
  const visible = useHeaderItemVisible();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`Terug naar ${title}`}
      onPress={press.withRelease(() => {
        if (visible()) onPress();
      })}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={space.xs}
      style={[styles.pill, press.dim && styles.pressed, press.style]}
    >
      <View style={[StyleSheet.absoluteFill, styles.layer]} />
      <Icon name="back" size={20} color={photoLayers.text} />
      <Text variant="backPill" style={styles.text}>
        {title}
      </Text>
    </AnimatedPressable>
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
