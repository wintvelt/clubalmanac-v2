import { useAuth } from "@clerk/expo";
import { router, useNavigationContainerRef, usePathname } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { Gradient } from "../components/Gradient";
import { Icon, type IconName } from "../components/Icon";
import { AnimatedPressable, selectionBarRise, useBarSwap, usePressMotion } from "../components/Motion";
import { Text } from "../components/Text";
import { successTap } from "../data/haptics";
import { useGroupVisit, useHomeGroup } from "../data/homeGroupState";
import { homeDecisions, homeSessionKey } from "../lib/homeDecision";
import { groupPath } from "../lib/groupRoutes";
import { homeButton, trackTabOrigin, type HomeButtonTarget, type TabOrigin } from "../lib/homeGroup";
import { startAddPick } from "../data/webPick";
import { plusParams } from "../lib/upload";
import { border, plusButton, radius, size, space, useTheme } from "../theme";
import { setTabBarDocked, takeTabBarSnap } from "./tabBarState";

// De ingelogde tabbalk (design.md §5, §7; WP15a invarianten 2, 9, 16): Home ·
// Mijn foto's · + · Profiel · Instellingen, elk met icoon en label. De + is
// een actie, geen tab: hij opent de modaal "Toevoegen". Uitgelogd
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
  descriptors,
  emitter,
  navigateToTab,
  insets,
  plus = true,
}: BottomTabBarProps & { plus?: boolean }) {
  const { colors } = useTheme();
  const home = useHomeButton(plus, state, navigateToTab);
  // WP40 gate ronde 1 (G1): de gewone optie van de navigator om de tabbalk te
  // verbergen, `tabBarStyle: { display: "none" }`, op de tab in beeld. Het
  // album en Mijn foto's zetten hem in de selectiestand.
  const focusedKey = state.routes[state.index]?.key;
  const focusedOptions = focusedKey ? descriptors?.[focusedKey]?.options : undefined;
  const hidden = StyleSheet.flatten(focusedOptions?.tabBarStyle as StyleProp<ViewStyle>)?.display === "none";
  // Gate ronde 2 (H1–H6): verborgen zakt hij weg, en terug schuift hij omhoog,
  // met dezelfde wissel als de selectiebalk. Zolang hij niet op zijn plek
  // staat, neemt hij geen ruimte in (zoals de tabbalk van React Navigation bij
  // het toetsenbord): het scherm loopt er meteen onderdoor en de bovenkant
  // blijft staan. Verborgen is hij niet aan te tikken en niet voor VoiceOver
  // (H3). Een andere tab in beeld, of een scherm dat zonder wissel stopt (G3,
  // G4): meteen helemaal terug (H6).
  const shownKey = useRef(focusedKey);
  const swap = useBarSwap(!hidden, { instant: () => takeTabBarSnap() || shownKey.current !== focusedKey });
  useLayoutEffect(() => {
    shownKey.current = focusedKey;
  });
  const docked = !hidden && swap.rest === "in";
  useLayoutEffect(() => setTabBarDocked(docked), [docked]);
  useEffect(() => () => setTabBarDocked(true), []);
  const [barHeight, setBarHeight] = useState(size.tabbar + insets.bottom);
  // Tot helemaal uit beeld: de balk, de + erboven en zijn schaduw.
  const travel = barHeight + size.plusRise + PLUS_SHADOW_ROOM;
  const { progress } = swap;
  // Onderweg tekent hij zich alleen boven de selectiebalk (H2): de houder
  // schuift mee omhoog met de bovenrand daarvan en knipt eronder af.
  const clipStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: docked ? 0 : -selectionBarRise.value }] }),
    [docked],
  );
  const slideStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateY: docked ? 0 : selectionBarRise.value + (1 - progress.value) * travel }],
    }),
    [docked, travel],
  );

  const tabs = state.routes.map((route, index) => {
    const meta = TABS[route.name] ?? { label: route.name, icon: "info", weight: 1 };
    const focused = index === state.index;
    // WP32 invariant 6: de Home-knop heeft een eigen icoon, bestemming en label.
    if (route.name === HOME && home) {
      return (
        <TabItem
          key={route.key}
          meta={{ ...meta, icon: home.button.icon }}
          focused={focused}
          accessibilityLabel={home.button.accessibilityLabel}
          onPress={home.onPress}
        />
      );
    }
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
    <Animated.View
      pointerEvents={hidden ? "none" : "box-none"}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      style={[docked ? null : [styles.floating, { height: travel }], clipStyle]}
    >
      <Animated.View style={[docked ? null : styles.floatingBar, slideStyle]}>
        <View
          onLayout={(e) => {
            const height = Math.ceil(e.nativeEvent.layout.height);
            if (height > 0) setBarHeight((before) => (before === height ? before : height));
          }}
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
            {/* WP36 (besluit 3): de + ook op het web. */}
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
      </Animated.View>
    </Animated.View>
  );
}

// Ruimte boven de + voor zijn schaduw, zodat die niet wordt afgeknipt.
const PLUS_SHADOW_ROOM = 24;

function TabItem({
  meta,
  focused,
  onPress,
  accessibilityLabel = meta.label,
}: {
  meta: TabMeta;
  focused: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const tint = focused ? colors.primary : colors.tabInactive;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
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

// --- Home (WP32) ---------------------------------------------------------------

const HOME = "(home)";

type NavState = { key?: string; routes: { name: string; params?: object; state?: NavState }[] };

// De routes van de Home-stack, uit de hele navigatieboom.
function homeStackRoutes(root: NavState | undefined): NavState["routes"] | undefined {
  if (!root) return undefined;
  for (const route of root.routes) {
    if (route.name === HOME) return route.state?.routes ?? [];
    const found = homeStackRoutes(route.state);
    if (found) return found;
  }
  return undefined;
}

// Ingelogd (met +): de thuisgroep, de herkomst op deze tab (besluit 1) en een
// bezoek (besluit 2). Uitgelogd is er geen Home.
function useHomeButton(
  loggedIn: boolean,
  state: BottomTabBarProps["state"],
  navigateToTab: BottomTabBarProps["navigateToTab"],
) {
  const pathname = usePathname();
  const { userId, sessionId } = useAuth();
  const navigation = useNavigationContainerRef();
  const visiting = useGroupVisit(loggedIn ? pathname : null);
  const homeGroup = useHomeGroup(undefined, visiting);
  // Bijhouden in de render: het label klopt dan meteen bij een nieuw pad.
  const origin = useRef<TabOrigin>({ pathname: null, cameFrom: null });
  if (origin.current.pathname !== pathname) origin.current = trackTabOrigin(origin.current, pathname);

  if (!loggedIn) return null;
  const button = homeButton({ pathname, homeGroup, cameFrom: origin.current.cameFrom });
  const homeRoute = state.routes.find((r) => r.name === HOME);

  const go = (target: HomeButtonTarget) => {
    if (target.kind === "none" || !homeRoute) return;
    // WP33 invariant 10: Home gaat naar een ander scherm; op Mijn groepen zelf
    // doet Home niets, en tikt dus ook niet.
    successTap();
    // Na een tik op Home kiest Mijn groepen niet alsnog zelf (A2).
    homeDecisions.markDecided(homeSessionKey(userId, sessionId));
    const onHome = state.routes[state.index]?.name === HOME;
    const stack = homeStackRoutes(navigation.getRootState() as NavState | undefined) ?? [];
    if (!onHome) navigateToTab(homeRoute.key);
    if (target.kind === "myGroups") {
      if (stack.length > 1) router.dismissAll();
      return;
    }
    // A3: Mijn groepen met daarop de groepspagina; wat erboven lag gaat weg.
    const second = stack[1];
    const groupOnTop =
      second?.name === "groep/[groupId]/index" &&
      (second.params as { groupId?: string } | undefined)?.groupId === target.groupId;
    if (groupOnTop) {
      if (stack.length > 2) router.dismissTo(groupPath(target.groupId));
      return;
    }
    if (stack.length > 1) router.dismissAll();
    router.push(groupPath(target.groupId));
  };

  return { button, onPress: () => go(button.target) };
}

// Verhoogd, in het verloop. Eén modaal, ook bij dubbel tikken: de route is
// "singular" (src/app/_layout.tsx). WP18: op een albumroute (het album, een
// foto erin) gaat dat album mee als bestemming.
function PlusButton() {
  const { colors, scheme } = useTheme();
  const pathname = usePathname();
  // WP33 invariant 6: de +-knop krimpt bij indrukken.
  const press = usePressMotion("button");
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel="Toevoegen"
      onPress={press.withRelease(() => {
        // WP38 besluit 29.2: vanuit een album dat album; onder een groep de groep.
        const params = plusParams(pathname);
        // WP36 U9: op het web opent de kiezer in de tik; op iOS niets.
        startAddPick();
        router.push(Object.keys(params).length > 0 ? { pathname: "/toevoegen", params } : "/toevoegen");
      })}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[styles.item, { flex: PLUS_WEIGHT }, press.dim && styles.pressed, press.style]}
    >
      {/* Geen rand en geen achtergrond op dit vlak: een rand verschuift het
          verloop (absoluteFill begint binnen de rand) en een effen kleur komt
          ernaast tevoorschijn (WP16 fix-cyclus 2, F1). De rand ligt als eigen
          laag over het verloop, binnen dezelfde Ø 58. */}
      <View style={styles.plus}>
        <Gradient from={colors.gradStart} to={colors.gradEnd} radius={size.plus / 2} />
        {scheme === "light" && <View style={styles.plusRing} pointerEvents="none" />}
        <Icon name="plus" size={34} color={colors.onGradient} filled />
      </View>
      <Label text="Toevoegen" focused={false} color={colors.tabInactive} />
    </AnimatedPressable>
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
  // WP40 gate ronde 2: onderweg of verborgen, zonder ruimte in te nemen.
  floating: { position: "absolute", left: 0, right: 0, bottom: 0, overflow: "hidden" },
  floatingBar: { position: "absolute", left: 0, right: 0, bottom: 0 },
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
  plusRing: {
    position: "absolute",
    top: 0,
    left: 0,
    width: size.plus,
    height: size.plus,
    borderRadius: size.plus / 2,
    borderWidth: border.plusLight,
    borderColor: plusButton.ringLight,
  },
  pressed: { opacity: 0.75 },
});
