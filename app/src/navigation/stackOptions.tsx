import {
  DarkTheme,
  DefaultTheme,
  router,
  type NativeStackNavigationOptions,
  type Theme as NavigationTheme,
} from "expo-router";
import { Pressable, StyleSheet } from "react-native";
import { Text } from "../components/Text";
import { size, space, useTheme } from "../theme";

// Het thema van de navigator volgt de iOS-modus, net als de app (WP-Design
// invariant 3). Zonder dit blijven de native navigatiebalk en zijn glazen
// knoppen licht in donker.
export function useNavigationTheme(): NavigationTheme {
  const { scheme, colors } = useTheme();
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.bg,
      card: colors.bg,
      text: colors.text,
      border: colors.line,
      notification: colors.cta,
    },
  };
}

// Gewone schermen in een stack: de iOS-navigatiebalk met een zichtbare
// terugknop met de naam van het vorige scherm (design.md §7; WP15a
// invariant 3). Vegen vanaf de rand werkt ook, maar is nooit de enige weg.
export function useStackScreenOptions(): NativeStackNavigationOptions {
  const { colors } = useTheme();
  return {
    headerStyle: { backgroundColor: colors.bg },
    headerTintColor: colors.primary,
    headerTitleStyle: { color: colors.text },
    headerShadowVisible: false,
    headerBackButtonDisplayMode: "default",
    contentStyle: { backgroundColor: colors.bg },
  };
}

// Modale schermen: "Sluiten" rechtsboven (design.md §7). Zonder scherm eronder
// (bv. een deep link bij een koude start) gaat het naar Home.
export function CloseButton() {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      hitSlop={space.s}
      style={({ pressed }) => [styles.close, pressed && styles.pressed]}
    >
      <Text variant="button" color="primary">
        Sluiten
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  close: { minHeight: size.touchMin, justifyContent: "center", paddingHorizontal: space.xs },
  pressed: { opacity: 0.6 },
});
