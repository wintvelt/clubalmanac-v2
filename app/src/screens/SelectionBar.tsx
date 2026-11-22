import { useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState, type Ref, type RefObject } from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
  type HostInstance,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "../components/Icon";
import { AnimatedPressable, FadeIn, usePressMotion } from "../components/Motion";
import { Text } from "../components/Text";
import { screenReaderOn } from "../data/accessibility";
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
const HIDDEN_TAB_BAR = { display: "none" } as const;

export function useHideTabBar(hidden: boolean) {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    if (!hidden) return;
    const tabs = navigation.getParent();
    if (!tabs) return;
    tabs.setOptions({ tabBarStyle: HIDDEN_TAB_BAR });
    return () => tabs.setOptions({ tabBarStyle: undefined });
  }, [hidden, navigation]);
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
  // thuisbalk en de achtergrond tot de onderrand. Geen infaden: tabbalk en
  // balk wisselen in één keer, zonder moment met geen van beide.
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
        <Text
          variant="navTitle"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={centered ? styles.titleTextCentered : undefined}
        >
          {header.title}
        </Text>
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

// De hoogte van de balk bovenin zonder statusbalk, tot hij gemeten is.
export const SELECTION_TOP_BAR = size.touchMin;

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
