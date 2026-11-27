import { useIsFocused, useNavigation, type NativeStackNavigationOptions } from "expo-router";
import { getDefaultHeaderHeight, HeaderBackButton, HeaderHeightContext } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ScrollViewInstance,
} from "react-native";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import { useReduceMotion, useScreenReader } from "../data/accessibility";
import {
  initialStand,
  nextStand,
  orientationOf,
  standView,
  type Orientation,
  type Stand,
  type StandView,
} from "../lib/photoDetailStand";
import { PHONE_FULLSCREEN } from "../navigation/stackOptions";
import { useTabBarDocked } from "../navigation/tabBarState";
import { Text } from "../components/Text";
import { photoLayers, size, space, useTheme } from "../theme";
import { useHideTabBar } from "./SelectionBar";

// WP46: het foto-detail schermvullend op de telefoon (album en Mijn foto's).
// De standen zelf staan in src/lib/photoDetailStand.ts; hier wat ze met het
// scherm doen: de kop, de tabbalk, de statusbalk, de achtergrond en waar de
// foto staat.
//
// Waarom zo (A-invarianten 2–4, 11):
// - De kop is op de telefoon altijd "transparent": het scherm loopt eronder
//   door, ook als hij er is. Zo verandert het vlak van het scherm nooit als
//   de kop komt of gaat; de app legt de foto zelf neer. In de normale stand
//   heeft de kop de gewone achtergrond en begint de foto eronder, zoals
//   voorheen.
// - Schermvullend rekent de foto met de maat van het venster en het veilige
//   gebied, niet met wat het scherm meet: de tabbalk die wegzakt verandert de
//   foto dan niet meer. Terug naar normaal gebruikt de maat die het scherm had
//   met de tabbalk op zijn plek (onthouden), zodat de foto niet nog eens
//   verspringt als de tabbalk weer staat.
// - Alles van één wissel komt uit één render: de maat van de pagina's van de
//   lijst wordt hier uitgerekend, niet na een meting.
// - Eén eigenaar van de statusbalk: expo-status-bar, zoals in App.tsx. Het
//   detail zet hem alleen zolang het in beeld is.
// - Op Android is de kop over de foto (zwart, met kop) een eigen kop van de
//   app (DetailOverlayHeader), niet de native kop. De native kop komt daar
//   pas bij de tik in beeld en kreeg dan de inzet links en rechts niet mee:
//   liggend met de navigatie met drie knoppen lag de balk over de kop en
//   Acties (gate Android, fix-cyclus 2). De eigen kop staat altijd binnen het
//   veilige gebied (A-invariant 3). iOS houdt de native kop.

const BLACK = "#000000";
// De kop over de foto (liggend): dezelfde laag als de pillen op een foto.
const HEADER_OVER_PHOTO = "rgba(15, 23, 42, 0.62)";

export type DetailStand = {
  allowed: boolean;
  orientation: Orientation;
  view: StandView;
  inView: boolean;
  /** Een tik op een foto (niet op een filmpje, niet bij een schermlezer). */
  onTap: (() => void) | undefined;
  /** Na het volledig scherm van de speler: de statusbalk weer zoals de stand vraagt. */
  restoreStatusBar: () => void;
  /** Android: de kop over de foto is de eigen kop (DetailOverlayHeader), niet de native. */
  overlayHeader: boolean;
};

// Zie de toelichting bovenaan: alleen Android.
const OVERLAY_HEADER = Platform.OS === "android";

export function usePhotoDetailStand(): DetailStand {
  const frame = useSafeAreaFrame();
  const orientation = orientationOf(frame);
  const screenReader = useScreenReader();
  const inView = useIsFocused();
  const [stored, setStored] = useState<Stand>(() => initialStand(orientation));
  // Draaien geldt in dezelfde render: geen beeld met de stand van vóór het draaien.
  let stand = stored;
  if (stand.orientation !== orientation) {
    stand = nextStand(stand, { type: "rotate", orientation });
    setStored(stand);
  }
  const view = standView(stand, { fullscreenAllowed: PHONE_FULLSCREEN, screenReader });
  const live = useRef({ orientation, screenReader });
  live.current = { orientation, screenReader };

  const tap = useCallback(() => {
    // Met een schermlezer wisselt een tik niets (besluit A7); zo staat er
    // later ook geen verborgen stand klaar.
    if (live.current.screenReader) return;
    const now = live.current.orientation;
    setStored((s) =>
      nextStand(s.orientation === now ? s : nextStand(s, { type: "rotate", orientation: now }), { type: "tap" }),
    );
  }, []);

  useHideTabBar(PHONE_FULLSCREEN && !view.tabBar && inView);

  // De speler kan de statusbalk in zijn eigen volledig scherm veranderen
  // zonder dat de stapel van StatusBar dat weet; daarom hier één keer
  // rechtstreeks. Dat verzet ook de standaard van de stapel; DetailStatusBar
  // zet die terug op zichtbaar zodra het detail uit beeld gaat.
  const hidden = !view.statusBar;
  const restoreStatusBar = useCallback(() => {
    if (PHONE_FULLSCREEN && inView) StatusBar.setHidden(hidden, "none");
  }, [hidden, inView]);

  return {
    allowed: PHONE_FULLSCREEN,
    orientation,
    view,
    inView,
    onTap: PHONE_FULLSCREEN ? tap : undefined,
    restoreStatusBar,
    overlayHeader: PHONE_FULLSCREEN && OVERLAY_HEADER && view.black && view.header,
  };
}

/** De statusbalk van het detail, alleen zolang het in beeld is (A-invariant 11). */
// Gaat het detail uit beeld of verdwijnt het (terug, een andere tab, een
// scherm erboven, uitloggen, herverbinden, de laatste foto weg), dan staat de
// statusbalk er meteen weer, en is de standaard van de stapel weer zichtbaar
// (App.tsx zet zelf geen `hidden`; zie restoreStatusBar).
export function DetailStatusBar({ stand }: { stand: DetailStand }) {
  const reduceMotion = useReduceMotion();
  const active = stand.allowed && stand.inView;
  useEffect(() => {
    if (!active) return;
    return () => StatusBar.setHidden(false, "none");
  }, [active]);
  if (!active) return null;
  return <StatusBar hidden={!stand.view.statusBar} animated={!reduceMotion} hideTransitionAnimation="fade" />;
}

/** Wat de stand aan de kop en de achtergrond van het scherm doet. */
export function useDetailHeaderOptions(stand: DetailStand): NativeStackNavigationOptions {
  const { colors } = useTheme();
  if (!stand.allowed) return {};
  const black = stand.view.black;
  return {
    headerTransparent: true,
    headerShown: stand.view.header && !stand.overlayHeader,
    headerStyle: { backgroundColor: black ? HEADER_OVER_PHOTO : colors.bg },
    headerTintColor: black ? photoLayers.text : colors.primary,
    headerTitleStyle: { color: black ? photoLayers.text : colors.text },
    contentStyle: { backgroundColor: black ? BLACK : colors.bg },
  };
}

/**
 * Voor een detail dat (nog) geen foto's toont (herverbinden, een fout): de
 * gewone kop, niet transparent, met de gewone kleuren.
 */
export function useDetailPlainOptions(): NativeStackNavigationOptions {
  const { colors } = useTheme();
  return {
    headerShown: true,
    headerTransparent: false,
    headerStyle: { backgroundColor: colors.bg },
    headerTintColor: colors.primary,
    headerTitleStyle: { color: colors.text },
    contentStyle: { backgroundColor: colors.bg },
  };
}

/**
 * Android: de kop over de foto in de zwarte stand (liggend met kop, of met
 * een schermlezer). Zoals de native kop (terug, de titel, Acties) en met
 * dezelfde laag, maar de knoppen en de titel binnen het veilige gebied, ook
 * met de navigatiebalk links of rechts. Buiten die stand niets.
 */
export function DetailOverlayHeader({
  stand,
  title,
  right,
}: {
  stand: DetailStand;
  title: string;
  right?: ReactNode;
}) {
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  if (!stand.overlayHeader) return null;
  return (
    <View
      style={[
        styles.overlayHeader,
        {
          height: getDefaultHeaderHeight(frame, false, insets.top),
          paddingTop: insets.top,
          paddingLeft: insets.left + (navigation.canGoBack() ? space.xs : space.l),
          paddingRight: insets.right + space.l,
        },
      ]}
    >
      {navigation.canGoBack() ? (
        <HeaderBackButton
          onPress={() => navigation.goBack()}
          tintColor={photoLayers.text}
          displayMode="minimal"
          accessibilityLabel="Terug"
        />
      ) : null}
      <Text
        variant="navTitle"
        numberOfLines={1}
        accessibilityRole="header"
        maxFontSizeMultiplier={1.3}
        style={[styles.overlayTitle, { color: photoLayers.text }]}
      >
        {title}
      </Text>
      {right}
    </View>
  );
}

// WP32 invariant 9 en 10, B1–B3: het fotogebied heeft een vaste maat, die
// alleen meeverandert met de venstermaat, de tekstgrootte en (WP46) de stand.
// Eronder een eigen scrollgebied voor de melding na een actie en het
// informatieblok: hoe hoog dat ook wordt (albumregels die later laden, een
// plaats over twee regels, grote tekst), de foto verspringt niet en er valt
// niets weg. WP17c: ook voor het detail in Mijn foto's.
export function photoInfoHeight(areaHeight: number, fontScale: number): number {
  return Math.round(Math.min(areaHeight * 0.5, Math.max(areaHeight * 0.22, INFO_BASE_HEIGHT * fontScale)));
}

// Avatar, naam, datum · plaats en één albumregel bij de gewone tekstgrootte.
const INFO_BASE_HEIGHT = 150;

type Rect = { left: number; top: number; width: number; height: number };

export type PhoneLayout = {
  onLayout: (e: LayoutChangeEvent) => void;
  /** De maat van een pagina van de lijst, of `null` zolang die nog niet bekend is. */
  page: { width: number; height: number } | null;
  photo: Rect | null;
  /** Het infoblok onder de foto (alleen de normale stand). */
  info: Rect | null;
  /** De melding na een actie over de foto (schermvullend). */
  overlayBottom: number;
  insetLeft: number;
  insetRight: number;
  black: boolean;
};

export function usePhoneDetailLayout(stand: DetailStand): PhoneLayout {
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  // Zoals Screen.tsx: buiten een stack (het web) geen fout, maar 0.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const docked = useTabBarDocked();
  const [screen, setScreen] = useState<{ width: number; height: number } | null>(null);
  const { view } = stand;
  const normal = !view.black;

  // Gemeten met de tabbalk op zijn plek, per breedte (rechtop of liggend).
  const dockedHeights = useRef(new Map<number, number>());
  const headerHeights = useRef(new Map<number, number>());
  const live = useRef({ docked, normal, inView: stand.inView });
  live.current = { docked, normal, inView: stand.inView };

  if (normal && view.header && headerHeight > 0) headerHeights.current.set(frame.width, headerHeight);

  // Schermvullend op iOS de bovenrand van het veilige gebied vasthouden zolang
  // de stand en de venstermaat gelijk blijven: gaat de statusbalk weg, dan
  // wordt die rand op een iPhone met een thuisknop 0, en zou de foto 20 pt
  // schuiven. Niet op Android: daar zou liggend een zwarte band van de oude
  // statusbalk blijven staan.
  const frozenTop = useRef<{ key: string; top: number } | null>(null);
  const frameKey = `${frame.width}x${frame.height}`;
  if (!view.black || Platform.OS !== "ios") frozenTop.current = null;
  else if (frozenTop.current?.key !== frameKey) frozenTop.current = { key: frameKey, top: insets.top };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const now = live.current;
    if (now.docked && now.normal && now.inView) dockedHeights.current.set(width, height);
    setScreen((before) => (before && before.width === width && before.height === height ? before : { width, height }));
  };

  let photo: Rect | null = null;
  let info: Rect | null = null;
  if (view.black) {
    const top = frozenTop.current?.top ?? insets.top;
    photo = {
      left: insets.left,
      top,
      width: Math.max(0, frame.width - insets.left - insets.right),
      height: Math.max(0, frame.height - top - insets.bottom),
    };
  } else {
    // De hoogte met de tabbalk op zijn plek: onthouden, anders gemeten (een
    // meting van een andere breedte telt niet: net gedraaid). Staat de tabbalk
    // nog niet op zijn plek, dan neemt hij geen ruimte in en telt de app hem
    // zelf af (dezelfde schatting als de tabbalk zelf). Bij het openen wacht
    // de foto op de eerste meting, zoals voorheen.
    const measured = screen && screen.width === frame.width ? screen.height : null;
    const screenHeight =
      dockedHeights.current.get(frame.width) ??
      (docked ? measured : (measured ?? frame.height) - (size.tabbar + insets.bottom));
    if (screenHeight !== null) {
      // Is de kop er net weer (na schermvullend), dan kent de stack zijn
      // hoogte nog niet: de laatst gemeten, anders de standaard.
      const top =
        headerHeights.current.get(frame.width) ??
        (headerHeight > 0 ? headerHeight : getDefaultHeaderHeight(frame, false, insets.top));
      const width = Math.max(0, frame.width - insets.left - insets.right);
      const areaHeight = Math.max(0, screenHeight - top);
      const infoHeight = photoInfoHeight(areaHeight, fontScale);
      photo = { left: insets.left, top, width, height: Math.max(0, areaHeight - infoHeight) };
      info = { left: insets.left, top: top + photo.height, width, height: infoHeight };
    }
  }

  const pageWidth = photo?.width;
  const pageHeight = photo?.height;
  const page = useMemo(
    () => (pageWidth !== undefined && pageHeight !== undefined ? { width: pageWidth, height: pageHeight } : null),
    [pageWidth, pageHeight],
  );

  return {
    onLayout,
    page,
    photo,
    info,
    overlayBottom: insets.bottom,
    insetLeft: insets.left,
    insetRight: insets.right,
    black: view.black,
  };
}

/**
 * De indeling op de telefoon. De foto's staan altijd in hetzelfde vak (de
 * lijst blijft dezelfde bij elke wissel); alleen zijn plek en maat wisselen.
 */
export function PhoneDetailLayout({
  layout,
  photos,
  info,
  feedback,
  scrollKey,
  loading,
  header,
}: {
  layout: PhoneLayout;
  photos: ReactNode;
  info: ReactNode;
  feedback: ReactNode;
  // Verandert dit (een nieuwe melding), dan scrolt het blok naar boven.
  scrollKey?: unknown;
  loading?: ReactNode;
  // Android: de eigen kop over de foto (DetailOverlayHeader).
  header?: ReactNode;
}) {
  const { colors } = useTheme();
  const infoScroll = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    infoScroll.current?.scrollTo({ y: 0, animated: true });
  }, [scrollKey]);

  return (
    <View
      style={[styles.fill, { backgroundColor: layout.black ? BLACK : colors.bg }]}
      onLayout={layout.onLayout}
    >
      {loading ??
        (layout.photo && (
          <>
            <View style={[styles.abs, layout.photo]}>{photos}</View>
            {layout.info ? (
              <ScrollView
                ref={infoScroll}
                style={[styles.abs, layout.info, styles.infoScroll, { borderTopColor: colors.line }]}
                contentContainerStyle={styles.infoScrollContent}
              >
                {feedback && <View style={styles.feedback}>{feedback}</View>}
                {info}
              </ScrollView>
            ) : (
              feedback && (
                <View
                  pointerEvents="box-none"
                  style={[
                    styles.overlay,
                    { left: layout.insetLeft, right: layout.insetRight, bottom: layout.overlayBottom },
                  ]}
                >
                  <View style={styles.feedback}>{feedback}</View>
                </View>
              )
            )}
          </>
        ))}
      {header}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  abs: { position: "absolute" },
  infoScroll: { borderTopWidth: StyleSheet.hairlineWidth },
  infoScrollContent: { paddingBottom: space.m },
  overlay: { position: "absolute", paddingBottom: space.m },
  overlayHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    backgroundColor: HEADER_OVER_PHOTO,
  },
  overlayTitle: { flex: 1 },
  feedback: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
    paddingTop: space.m,
  },
});
