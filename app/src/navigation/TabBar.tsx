import { router } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Pressable, StyleSheet, View } from "react-native";
import { Gradient } from "../components/Gradient";
import { Icon, type IconName } from "../components/Icon";
import { Text } from "../components/Text";
import { border, plusButton, radius, size, space, useTheme } from "../theme";

// De ingelogde tabbalk (design.md §5, §7; WP15a invarianten 2, 9, 16): Home ·
// Mijn foto's · + · Profiel · Instellingen, elk met icoon en label. De + is
// een actie, geen tab: hij opent de modaal "Foto's toevoegen". Uitgelogd
// (WP15b): Inloggen · Info, zonder +.

type TabMeta = { label: string; icon: IconName; weight: number };

// Route-namen uit src/app/(tabs)/. Bredere kolommen voor de lange labels,
// zodat ze bij xxxLarge passen (design.md §10, bevinding 3).
const TABS: Record<string, TabMeta> = {
  "(home)": { label: "Home", icon: "home", weight: 1 },
  "mijn-fotos": { label: "Mijn foto's", icon: "photos", weight: 1.25 },
  profiel: { label: "Profiel", icon: "user", weight: 1 },
  instellingen: { label: "Instellingen", icon: "gear", weight: 1.3 },
  inloggen: { label: "Inloggen", icon: "login", weight: 1 },
  info: { label: "Info", icon: "info", weight: 1 },
};
const PLUS_WEIGHT = 1.15;

export function TabBar({
  state,
  emitter,
  navigateToTab,
  insets,
  plus = true,
}: BottomTabBarProps & { plus?: boolean }) {
  const { colors } = useTheme();

  const tabs = state.routes.map((route, index) => {
    const meta = TABS[route.name] ?? { label: route.name, icon: "info", weight: 1 };
    const focused = index === state.index;
    // Een tik op de actieve tab brengt de stack van die tab terug naar het
    // begin (de native stack luistert naar tabPress). Een andere tab opent
    // zoals je hem verliet.
    const onPress = () => {
      const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigateToTab(route.key);
    };
    return <TabItem key={route.key} meta={meta} focused={focused} onPress={onPress} />;
  });
  const half = Math.ceil(tabs.length / 2);

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.tabbar,
          borderTopColor: colors.line,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <View accessibilityRole="tablist" style={styles.row}>
        {plus ? (
          <>
            {tabs.slice(0, half)}
            <PlusButton />
            {tabs.slice(half)}
          </>
        ) : (
          tabs
        )}
      </View>
    </View>
  );
}

function TabItem({
  meta,
  focused,
  onPress,
}: {
  meta: TabMeta;
  focused: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const tint = focused ? colors.primary : colors.tabInactive;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={meta.label}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      style={({ pressed }) => [styles.item, { flex: meta.weight }, pressed && styles.pressed]}
    >
      <View style={[styles.pill, focused && { backgroundColor: colors.tabPill }]}>
        <Icon name={meta.icon} color={tint} filled={focused} />
      </View>
      <Label text={meta.label} focused={focused} color={tint} />
    </Pressable>
  );
}

// Verhoogd, in het verloop. Eén modaal, ook bij dubbel tikken: de route is
// "singular" (src/app/_layout.tsx).
function PlusButton() {
  const { colors, scheme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Foto's toevoegen"
      onPress={() => router.push("/toevoegen")}
      style={({ pressed }) => [styles.item, { flex: PLUS_WEIGHT }, pressed && styles.pressed]}
    >
      <View
        style={[
          styles.plus,
          { backgroundColor: colors.gradEnd },
          scheme === "light" && {
            borderWidth: border.plusLight,
            borderColor: plusButton.ringLight,
          },
        ]}
      >
        <Gradient from={colors.gradStart} to={colors.gradEnd} radius={size.plus / 2} />
        <Icon name="plus" size={34} color={colors.onGradient} filled />
      </View>
      <Label text="Toevoegen" focused={false} color={colors.tabInactive} />
    </Pressable>
  );
}

// Groeit hoogstens 1,2× mee (tokens). Past een label dan nog niet, dan krimpt
// het iets in plaats van af te breken: er valt niets weg.
function Label({ text, focused, color }: { text: string; focused: boolean; color: string }) {
  return (
    <Text
      variant={focused ? "tabLabelActive" : "tabLabel"}
      style={{ color }}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.8}
    >
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth },
  // Op iPad en liggend blijft de balk, met de knoppen in het midden.
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    minHeight: size.tabbar,
  },
  item: {
    alignItems: "center",
    gap: 2,
    paddingTop: space.s,
    paddingBottom: space.xs,
    paddingHorizontal: 2,
  },
  pill: {
    width: size.tabPillWidth,
    height: size.tabPillHeight,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  // Steekt uit boven de balk; neemt binnen de balk de hoogte van de pil in.
  plus: {
    width: size.plus,
    height: size.plus,
    marginTop: -size.plusRise,
    borderRadius: size.plus / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: plusButton.shadow.color,
    shadowOffset: { width: 0, height: plusButton.shadow.offsetY },
    shadowRadius: plusButton.shadow.radius,
    shadowOpacity: plusButton.shadow.opacity,
  },
  pressed: { opacity: 0.75 },
});
