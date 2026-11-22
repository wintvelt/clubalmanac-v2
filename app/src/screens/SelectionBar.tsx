import { useIsFocused, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
  type HostInstance,
  type LayoutChangeEvent,
} from "react-native";
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "../components/Icon";
import {
  AnimatedPressable,
  CrossFade,
  FadeIn,
  selectionBarRise,
  useBarSwap,
  usePressMotion,
} from "../components/Motion";
import { Text } from "../components/Text";
import { screenReaderOn } from "../data/accessibility";
import { snapTabBarBack, useTabBarDocked } from "../navigation/tabBarState";
import type { SelectionAction } from "../lib/photoActions";
import {
  selectionButtons,
  selectionHeader,
  type SelectionButton,
  type SelectionHeader,
  type SelectionPlace,
} from "../lib/selectionBar";
import { size, space, useTheme } from "../theme";

// WP40: de selectiestand in het album en in Mijn foto's (antwoord 4: één balk
// voor beide schermen). Bovenin de titel ("3 geselecteerd") met Annuleren,
// onderin één slanke rij knoppen met icoon en label. Titel en knoppen komen
// uit de pure logica (src/lib/selectionBar.ts). Wat de acties doen, blijft in
// useSelectionActions (WP17b, WP17c; invariant 1).

// A7: de titel van de kop. VoiceOver krijgt hem bij elke wijziging te horen
// (aantal of "Bezig…"); `accessibilityLiveRegion` doet dat op iOS niet.
// `announceStart: false`: bij het aanzetten niet, omdat de focus dan al naar
// de titel gaat (het album); anders hoor je hem twee keer.
export function useSelectionHeader({
  count,
  busy,
  active,
  announceStart = true,
}: {
  count: number;
  busy: boolean;
  active: boolean;
  announceStart?: boolean;
}): SelectionHeader {
  const header = selectionHeader({ count, busy });
  const announced = useRef(false);
  useEffect(() => {
    if (!active) {
      announced.current = false;
      return;
    }
    const first = !announced.current;
    announced.current = true;
    if (first && !announceStart) return;
    AccessibilityInfo.announceForAccessibility(header.title);
  }, [active, header.title, announceStart]);
  return header;
}

// WP40 gate ronde 1 (G1, G4, G5): tijdens de selectie geen tabbalk; de
// selectiebalk staat op zijn plek. De optie hoort bij de tab (de navigator
// boven de stack van het scherm), en de eigen TabBar volgt hem. Uit bij het
// einde van de selectie en als het scherm verdwijnt (de cleanup), zodat je
// altijd weg kunt. Een layout-effect: de wissel komt zo dicht mogelijk bij die
// van de balken.
// Gate ronde 2 (H6): verdwijnt het scherm of gaat het uit beeld, dan komt de
// tabbalk meteen helemaal terug, zonder wissel. Alleen na Annuleren of een
// actie, met het scherm in beeld, wisselen de balken.
const HIDDEN_TAB_BAR = { display: "none" } as const;

export function useHideTabBar(hidden: boolean) {
  const navigation = useNavigation();
  const inView = useIsFocused();
  const live = useRef({ mounted: true, inView });
  live.current.inView = inView;
  // Vóór het effect hieronder: bij het weghalen van het scherm loopt deze
  // cleanup eerst.
  useLayoutEffect(() => {
    live.current.mounted = true;
    return () => {
      live.current.mounted = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (!hidden) return;
    const tabs = navigation.getParent();
    if (!tabs) return;
    tabs.setOptions({ tabBarStyle: HIDDEN_TAB_BAR });
    return () => {
      if (!live.current.mounted || !live.current.inView) snapTabBarBack();
      tabs.setOptions({ tabBarStyle: undefined });
    };
  }, [hidden, navigation]);
}

// --- Gate ronde 2: de selectiebalk wisselt met de tabbalk (H1–H5) --------------
//
// De selectiebalk ligt over de onderkant van het scherm, op de plek van de
// tabbalk. Hij schuift omhoog bij Selecteer en zakt weg na de selectie, met
// dezelfde wissel als de tabbalk (useBarSwap). Zolang hij er is, en tot de
// tabbalk weer op zijn plek staat, krijgt de lijst onderaan zijn hoogte erbij
// (`barSpace`): zo komt de laatste rij boven de balk, en wat onder een balk
// vandaan komt is het raster zelf (H2). Pas als de tabbalk op zijn plek staat,
// mag de melding onderaan er weer staan (`panelFree`, H4).
export function useSelectionBottom(selecting: boolean) {
  const swap = useBarSwap(selecting);
  const docked = useTabBarDocked();
  const insets = useSafeAreaInsets();
  const present = selecting || swap.rest !== "out";
  const [height, setHeight] = useState(0);
  // Van Selecteer tot de tabbalk na de selectie weer op zijn plek staat.
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (selecting) setSettling(true);
    else if (!present && docked) setSettling(false);
  }, [selecting, present, docked]);
  const estimate = SELECTION_BAR_ESTIMATE + insets.bottom;
  return {
    swap,
    selecting,
    present,
    estimate,
    setHeight,
    barSpace: selecting || settling ? height || estimate : 0,
    panelFree: !selecting && !settling,
  };
}

export type SelectionBottom = ReturnType<typeof useSelectionBottom>;

// De hoogte van de balk tot hij gemeten is, zonder de thuisbalk.
const SELECTION_BAR_ESTIMATE = size.touchMin + 2 * space.xs + StyleSheet.hairlineWidth;

// De balk zelf (`children`, een SelectionBar) in de wissel. Na de selectie
// blijft hij staan zoals hij was tot hij weg is, maar doet hij niets meer en
// slaat VoiceOver hem over (H3). Als laatste in het scherm: bovenop de lijst,
// en VoiceOver leest hem na het raster.
export function SelectionBarSwap({ bottom, children }: { bottom: SelectionBottom; children: ReactNode }) {
  const last = useRef(children);
  if (bottom.selecting) last.current = children;
  const { progress } = bottom.swap;
  const measured = useSharedValue(0);
  const estimate = bottom.estimate;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * (measured.value || estimate) }],
  }));
  useAnimatedReaction(
    () => progress.value * (measured.value || estimate),
    (rise, before) => {
      if (before !== null || rise > 0) selectionBarRise.value = rise;
    },
  );
  useEffect(
    () => () => {
      selectionBarRise.value = 0;
    },
    [],
  );
  if (!bottom.present) return null;
  const active = bottom.selecting;
  return (
    <Animated.View
      style={[styles.swap, style]}
      pointerEvents={active ? "box-none" : "none"}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      onLayout={(e) => {
        const height = Math.ceil(e.nativeEvent.layout.height);
        measured.value = height;
        bottom.setHeight(height);
      }}
    >
      {last.current}
    </Animated.View>
  );
}

// Wacht even: het element moet er staan (en een scroll terug klaar zijn)
// voordat VoiceOver erheen kan.
const FOCUS_DELAY = 400;

// Zet de focus van VoiceOver op een element, als VoiceOver aan staat.
export function focusLater(ref: RefObject<HostInstance | null>, delay = FOCUS_DELAY) {
  if (!screenReaderOn()) return;
  setTimeout(() => {
    const node = ref.current;
    if (node) AccessibilityInfo.sendAccessibilityEvent(node, "focus");
  }, delay);
}

const ICONS: Record<SelectionAction, IconName> = {
  addToAlbum: "album",
  removeFromAlbum: "minus",
  delete: "trash",
};

// A6: één rij, alle knoppen even breed, op de plek van de tabbalk. Geen uitlegregel en
// geen Annuleren (die staat in de kop). Grijs bij nul en tijdens een actie.
export function SelectionBar({
  place,
  count,
  busy,
  onAction,
}: {
  place: SelectionPlace;
  count: number;
  busy: boolean;
  // "addToAlbum" opent eerst het kiesscherm; dat regelt het scherm.
  onAction: (action: SelectionAction) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const buttons = selectionButtons({ place, count, busy });
  // Gate ronde 1 (G1, G2): op de plek van de tabbalk, dus de knoppen boven de
  // thuisbalk en de achtergrond tot de onderrand. De wissel met de tabbalk zit
  // in SelectionBarSwap (gate ronde 2).
  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.surface, borderTopColor: colors.line, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.row}>
        {buttons.map((button) => (
          <BarButton key={button.action} button={button} onPress={() => onAction(button.action)} />
        ))}
      </View>
    </View>
  );
}

function BarButton({ button, onPress }: { button: SelectionButton; onPress: () => void }) {
  const { colors } = useTheme();
  const press = usePressMotion("button");
  const tint = button.disabled ? colors.muted : button.danger ? colors.danger : colors.primary;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={button.accessibilityLabel}
      accessibilityState={{ disabled: button.disabled }}
      disabled={button.disabled}
      onPress={press.withRelease(onPress)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[styles.button, press.dim && styles.pressed, press.style]}
    >
      <Icon name={ICONS[button.action]} size={22} color={tint} />
      {/* Zoals de tabbalk: hoogstens 1,2× groter, nooit afgekapt of afgebroken. */}
      <Text
        variant="barLabel"
        style={{ color: tint }}
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {button.title}
      </Text>
    </AnimatedPressable>
  );
}

// Een tekstknop in de kop: "Annuleren", en in Mijn foto's ook "Selecteer"
// (besluit 3). Zelfde vorm als "Sluiten" op modale schermen (design.md §7).
export function HeaderTextButton({
  title,
  onPress,
  disabled = false,
  ref,
  onLayout,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  // Voor de focus van VoiceOver (N2).
  ref?: Ref<HostInstance>;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  return (
    <Pressable
      ref={ref}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={space.s}
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
    >
      <Text variant="button" color={disabled ? "muted" : "primary"}>
        {title}
      </Text>
    </Pressable>
  );
}

// De titel en Annuleren op één regel, minstens 44 pt hoog. `centered`: de
// titel in het midden, zoals de iOS-navigatiebalk; anders links (de zijkolom).
// Geen vaste maten naast tekst die meeschaalt: links staat een lege ruimte zo
// breed als Annuleren (gemeten), de titel krijgt wat ertussen past en krimpt
// zo nodig. Bij het verschijnen gaat de focus van VoiceOver naar de titel (N2).
function HeaderRow({
  header,
  onCancel,
  centered,
}: {
  header: SelectionHeader;
  onCancel: () => void;
  centered: boolean;
}) {
  const [cancelWidth, setCancelWidth] = useState(0);
  const title = useRef<HostInstance>(null);
  useEffect(() => {
    focusLater(title);
  }, []);
  return (
    <View style={styles.headerRow}>
      {centered ? <View style={{ width: cancelWidth }} /> : null}
      <View
        ref={title}
        accessible
        accessibilityRole="header"
        accessibilityLabel={header.title}
        style={styles.title}
        pointerEvents="none"
      >
        {/* Gate ronde 2 (H12): het aantal wisselt zacht. */}
        <CrossFade
          value={header.title}
          render={(title) => (
            <Text
              variant="navTitle"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={centered ? styles.titleTextCentered : undefined}
            >
              {title}
            </Text>
          )}
        />
      </View>
      <HeaderTextButton
        title="Annuleren"
        onPress={onCancel}
        disabled={header.cancelDisabled}
        onLayout={(e) => setCancelWidth(Math.ceil(e.nativeEvent.layout.width))}
      />
    </View>
  );
}

// Het album (smal) heeft geen iOS-kop (antwoord 1). Deze balk ligt over de
// lijst, alleen in de selectiestand, en duwt niets omlaag. Hij is dicht: de
// foto's schuiven eronder, niet erdoorheen. `onHeight`: de hoogte, voor het
// scrollen naar het raster (A3).
export function SelectionTopBar({
  header,
  onCancel,
  onHeight,
}: {
  header: SelectionHeader;
  onCancel: () => void;
  onHeight?: (height: number) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <FadeIn
      style={[
        styles.topBar,
        {
          paddingTop: insets.top,
          // Liggend: Annuleren niet in de afgeronde hoek of naast de camera.
          paddingLeft: insets.left,
          paddingRight: insets.right,
          backgroundColor: colors.bg,
          borderBottomColor: colors.line,
        },
      ]}
      onLayout={(e: LayoutChangeEvent) => onHeight?.(e.nativeEvent.layout.height)}
    >
      <View style={styles.topBarColumn}>
        <HeaderRow header={header} onCancel={onCancel} centered />
      </View>
    </FadeIn>
  );
}

// A8: in de brede layout staan aantal en Annuleren bovenin de zijkolom, op de
// plek van de pil "Groep".
export function SelectionSideHeader({ header, onCancel }: { header: SelectionHeader; onCancel: () => void }) {
  return (
    <FadeIn>
      <HeaderRow header={header} onCancel={onCancel} centered={false} />
    </FadeIn>
  );
}

// Gate ronde 2 (H12, H13): de titel in de iOS-kop van Mijn foto's, met dezelfde
// zachte wissel als in het album. Zoals de gewone iOS-titel: 17 pt halfvet in
// de tekstkleur, in het midden, en net als die niet mee met de tekstgrootte.
// VoiceOver leest hem als kop, met de nieuwe titel.
export function SelectionNavTitle({ title }: { title: string }) {
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={title}>
      <CrossFade
        value={title}
        style={styles.navTitle}
        overlayStyle={styles.navTitleOverlay}
        render={(text) => (
          <Text variant="navTitle" numberOfLines={1} allowFontScaling={false} style={styles.titleTextCentered}>
            {text}
          </Text>
        )}
      />
    </View>
  );
}

// De hoogte van de balk bovenin zonder statusbalk, tot hij gemeten is.
export const SELECTION_TOP_BAR = size.touchMin;

const NAV_TITLE_OVERHANG = 80;

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth },
  row: {
    flexDirection: "row",
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
  },
  button: {
    flex: 1,
    minWidth: size.touchMin,
    minHeight: size.touchMin,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: space.xs,
    paddingHorizontal: 2,
  },
  pressed: { opacity: 0.6 },
  headerButton: { minHeight: size.touchMin, justifyContent: "center", paddingHorizontal: space.xs },
  headerRow: { minHeight: size.touchMin, flexDirection: "row", alignItems: "center" },
  title: { flex: 1, minWidth: 0, paddingHorizontal: space.xs },
  titleTextCentered: { textAlign: "center" },
  navTitle: { alignItems: "center" },
  // De oude titel mag breder zijn dan de nieuwe: hij steekt aan beide kanten uit.
  navTitleOverlay: { position: "absolute", top: 0, bottom: 0, left: -NAV_TITLE_OVERHANG, right: -NAV_TITLE_OVERHANG },
  swap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Over de volle breedte, zoals de iOS-navigatiebalk in Mijn foto's.
  topBarColumn: { paddingHorizontal: size.screenMargin },
});
