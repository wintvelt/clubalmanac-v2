import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View, type HostInstance, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { screenReaderOn, useReduceMotion, useScreenReader } from "../data/accessibility";
import {
  appearFeedback,
  headerFade,
  headerMotion,
  infoOpacity,
  newlyArrived,
  pressFeedback,
  pressRelease,
  type HeaderLayout,
} from "../lib/motion";

// WP33: de bouwstenen voor de subtiele animaties. Alle maten komen uit
// src/lib/motion.ts (F4). "Beperk beweging" lezen we zelf, live (F1); de
// animaties van Reanimated volgen daarom niet ook nog de instelling bij de
// start (ReduceMotion.Never): met de instelling aan is de duur al 0.

const OWN = ReduceMotion.Never;

export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// --- Indrukken (invarianten 5 en 6, B1–B6, besluit 5) -------------------------
//
// Voor een Pressable: de hele knop of tegel krimpt bij indrukken; een tegel
// wordt ook iets donkerder en de cover erin zoomt in. Een snelle tik gaat eerst
// door tot de eindstand en veert dan terug (B6); wie langer drukt, ziet hem
// terugveren bij loslaten of annuleren (scrollen, B4). De actie zelf blijft bij
// loslaten en wacht niet op de animatie (B5): alles loopt op de UI-thread.
// `dim` is het dimmen van een knop van vóór WP33, alleen met "Beperk beweging"
// (F2).
export function usePressMotion(kind: "button" | "tile") {
  const reduceMotion = useReduceMotion();
  const f = pressFeedback(kind, reduceMotion);
  // 0 = los, 1 = helemaal ingedrukt. Schaal, zoom en donkerte lopen mee.
  const progress = useSharedValue(0);
  const pressedAt = useRef(0);
  const down = useRef(false);
  const [pressed, setPressed] = useState(false);
  const onPressIn = () => {
    down.current = true;
    setPressed(true);
    pressedAt.current = Date.now();
    progress.value = f.inDuration > 0 ? withTiming(1, { duration: f.inDuration, easing: EASE, reduceMotion: OWN }) : 1;
  };
  // Eén keer per indrukken: bij de tik zelf (withRelease), anders bij
  // onPressOut (lang drukken, annuleren).
  const release = () => {
    if (!down.current) return;
    down.current = false;
    setPressed(false);
    const { delay, duration } = pressRelease(Date.now() - pressedAt.current, kind, reduceMotion);
    progress.value =
      duration > 0
        ? withSequence(
            withTiming(1, { duration: delay, easing: Easing.linear, reduceMotion: OWN }),
            withTiming(0, { duration, easing: EASE, reduceMotion: OWN }),
          )
        : 0;
  };
  // Pressable stuurt onPressOut pas minstens 130 ms na indrukken, met een timer
  // op de JS-thread; opent de tik een scherm, dan loopt die timer uit en bleef
  // de tegel te lang ingedrukt. Daarom begint het terugveren al bij de tik, vóór
  // de actie, die er niet op wacht (B5, B6).
  const withRelease =
    <A extends unknown[]>(action: ((...args: A) => void) | undefined) =>
    (...args: A) => {
      release();
      action?.(...args);
    };
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 + (f.scale - 1) * progress.value }] }));
  const coverStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + (f.coverZoom - 1) * progress.value }] }));
  const shadeStyle = useAnimatedStyle(() => ({ opacity: f.shade * progress.value }));
  return { style, coverStyle, shadeStyle, dim: pressed && f.dim, pressed, onPressIn, onPressOut: release, withRelease };
}

const EASE = Easing.out(Easing.quad);

type PressMotion = ReturnType<typeof usePressMotion>;

// De cover van een tegel: zoomt binnen zijn afgeronde vak (B1).
export function TileZoom({
  zoom,
  size,
  radius,
  children,
}: {
  zoom: PressMotion["coverStyle"];
  size: number;
  radius: number;
  children: ReactNode;
}) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: "hidden" }}>
      <Animated.View style={zoom}>{children}</Animated.View>
    </View>
  );
}

// De donkere laag over een ingedrukte tegel (B1, B2). Als laatste kind van de
// tegel, zodat hij over alles valt; vangt geen tikken.
export function PressShade({ style, radius = 0 }: { style: PressMotion["shadeStyle"]; radius?: number }) {
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: "#000", borderRadius: radius }, style]}
    />
  );
}

// --- Verschijnen (invarianten 8 en 9, D1–D5) -----------------------------------
//
// Fadet één keer in, bij het mounten, alleen als `active`. Alleen
// doorzichtigheid: plek en maat staan meteen goed (D1).
export function FadeIn({
  active = true,
  style,
  children,
  ...rest
}: { active?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode } & Omit<
  React.ComponentProps<typeof Animated.View>,
  "style" | "children"
>) {
  const reduceMotion = useReduceMotion();
  const [start] = useState(() => (active ? appearFeedback(reduceMotion) : { fromOpacity: 1, duration: 0 }));
  const opacity = useSharedValue(start.fromOpacity);
  useEffect(() => {
    if (start.fromOpacity < 1) opacity.value = withTiming(1, { duration: start.duration, reduceMotion: OWN });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View {...rest} style={[style, animated]}>
      {children}
    </Animated.View>
  );
}

// Welke items van een lijst nu binnenkomen (D4): alleen bij een wijziging van
// de ids, niet bij elke render. Opent het scherm met de gegevens er al, dan
// komt er niets binnen.
export function useArrivals(ids: readonly string[] | undefined): ReadonlySet<string> {
  const key = ids?.join("|");
  const [state, setState] = useState<{ key: string | undefined; shown: readonly string[] | undefined; fresh: ReadonlySet<string> }>(
    () => ({ key, shown: ids, fresh: EMPTY }),
  );
  if (state.key !== key) {
    const fresh = new Set(newlyArrived(state.shown, ids));
    setState({ key, shown: ids ?? state.shown, fresh });
    return fresh;
  }
  return state.fresh;
}

const EMPTY: ReadonlySet<string> = new Set();

// --- De kop van Groep en Album (invarianten 1–4, A1–A6) ------------------------

// De scrollpositie van het scherm eromheen (Screen, de lijst van Album).
export const ScrollOffsetContext = createContext<SharedValue<number> | null>(null);

type Frame = {
  offset: SharedValue<number> | null;
  layout: HeaderLayout;
  reduceMotion: boolean;
  root: RefObject<HostInstance | null>;
};
const FrameContext = createContext<Frame | null>(null);

// Ruimte boven de kop, voor de cover die bij trekken meerekt.
const PULL_ROOM = 2000;

// De cover (of het verloop) gaat langzamer omhoog dan de inhoud en zoomt uit;
// bij trekken blijft hij aan de bovenkant vast en rekt hij mee. Hij eindigt
// precies waar de inhoud begint. `children` staan erop (de pil, de
// letter-tegel), in een HeaderItem.
export function MotionHeader({
  minHeight,
  style,
  backdrop,
  zoom,
  children,
}: {
  minHeight: number;
  style?: StyleProp<ViewStyle>;
  // De cover met scrim, of het verloop: vult de kop (de maat in rust).
  backdrop: (box: { width: number; height: number }) => ReactNode;
  // Een foto zoomt; het verloop niet (invariant 3, A6).
  zoom: boolean;
  children?: ReactNode;
}) {
  const offset = useContext(ScrollOffsetContext);
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Bij grote tekst kan de kop hoger worden dan het vaste vlak (A5).
  const [measured, setMeasured] = useState(0);
  const height = Math.max(minHeight, measured);
  const topInset = insets.top;
  const root = useRef<HostInstance>(null);
  const backdropStyle = useAnimatedStyle(() => {
    const y = offset ? offset.value : 0;
    const m = headerMotion(y, { height, topInset }, { cover: zoom, reduceMotion });
    // Trekken: het vlak rekt; het beeld schaalt mee vanuit het midden.
    const stretch = height > 0 && m.coverHeight > height ? m.coverHeight / height : 1;
    const shift = Math.max(0, (m.coverHeight - height) / 2);
    return { transform: [{ translateY: m.coverTop + y + shift }, { scale: m.coverZoom * stretch }] };
  });
  return (
    <FrameContext.Provider value={{ offset, layout: { height, topInset }, reduceMotion, root }}>
      <View
        ref={root}
        style={[{ width: "100%", minHeight }, style]}
        onLayout={(e) => setMeasured(Math.ceil(e.nativeEvent.layout.height))}
      >
        <View style={[styles.clip, { top: -PULL_ROOM, height: height + PULL_ROOM }]} pointerEvents="none">
          <Animated.View style={[{ position: "absolute", top: PULL_ROOM, left: 0, width, height }, backdropStyle]}>
            {backdrop({ width, height })}
          </Animated.View>
        </View>
        {children}
      </View>
    </FrameContext.Provider>
  );
}

// Is het element in de kop nu zichtbaar genoeg om op te tikken (A3)? Met
// VoiceOver altijd: die bedient de pil zoals nu.
const HeaderItemVisible = createContext<() => boolean>(() => true);

export function useHeaderItemVisible(): () => boolean {
  return useContext(HeaderItemVisible);
}

// Een element in de kop (de pil, de letter-tegel): beweegt met de cover mee,
// vervaagt en krimpt licht, en is weg voordat het onder de statusbalk komt.
// Met VoiceOver aan vervaagt het niet: iOS slaat een onzichtbaar element over,
// en de pil is op Album de enige terugknop (invariant 14, besluit 4).
export function HeaderItem({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const frame = useContext(FrameContext);
  const ref = useRef<HostInstance>(null);
  const [top, setTop] = useState<number | null>(null);
  const offset = frame?.offset ?? null;
  const layout = frame?.layout ?? { height: 0, topInset: 0 };
  const reduceMotion = frame?.reduceMotion ?? true;
  const screenReader = useScreenReader();
  const animated = useAnimatedStyle(() => {
    const y = offset ? offset.value : 0;
    const m = headerMotion(y, layout, { cover: false, reduceMotion });
    const f =
      top === null || screenReader ? { opacity: 1, scale: 1 } : headerFade(y, top, layout, { reduceMotion });
    return { opacity: f.opacity, transform: [{ translateY: m.coverTop + y }, { scale: f.scale }] };
  });
  // De plek in rust, ten opzichte van de bovenkant van de kop.
  const measure = () => {
    const root = frame?.root.current;
    const node = ref.current;
    if (!root || !node) return;
    node.measureLayout(root, (_x, y) => {
      // De verschuiving van nu telt niet mee: die komt van het scrollen.
      const now = offset ? offset.value : 0;
      const shift = headerMotion(now, layout, { cover: false, reduceMotion }).coverTop + now;
      setTop(Math.round(y - shift));
    });
  };
  const visible = () => {
    if (screenReaderOn() || top === null) return true;
    const y = offset ? offset.value : 0;
    return headerFade(y, top, layout, { reduceMotion }).opacity > 0.5;
  };
  return (
    <HeaderItemVisible.Provider value={visible}>
      <Animated.View ref={ref} style={[style, animated]} onLayout={measure}>
        {children}
      </Animated.View>
    </HeaderItemVisible.Provider>
  );
}

// --- Foto-detail (invariant 7, C1–C5) ------------------------------------------
//
// Het informatieblok vervaagt mee met de swipe. De gegevens wisselen halverwege
// twee foto's, waar het blok onzichtbaar is, en wisselen terug als de foto
// terugveert. `index`: de foto in beeld volgens het scherm (wisselt als de
// swipe stilstaat). Tot de user swipet, telt `index` (de lijst springt bij het
// openen zonder scroll-gebeurtenis naar zijn foto). Met "Beperk beweging"
// blijft het blok zichtbaar en wisselt het als de swipe stilstaat, zoals nu.
export function useSwipeInfo(index: number, count: number, pageWidth: number) {
  const reduceMotion = useReduceMotion();
  const offset = useSharedValue(0);
  // Tot de eerste sleep na een wissel volgt het blok `index`.
  const swiping = useSharedValue(false);
  const [infoIndex, setInfoIndex] = useState(index);
  useEffect(() => {
    setInfoIndex(index);
    swiping.value = false;
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  useAnimatedReaction(
    () => {
      if (reduceMotion || !swiping.value || pageWidth <= 0 || count <= 0) return -1;
      const i = Math.round(offset.value / pageWidth);
      return i < 0 ? 0 : i > count - 1 ? count - 1 : i;
    },
    (i, previous) => {
      if (i >= 0 && i !== previous) scheduleOnRN(setInfoIndex, i);
    },
  );

  const infoStyle = useAnimatedStyle(() => {
    if (!swiping.value || pageWidth <= 0) return { opacity: 1 };
    return { opacity: infoOpacity(offset.value / pageWidth, infoIndex, count, reduceMotion) };
  });

  // Voor de horizontale lijst (Animated.FlatList), op de UI-thread.
  const onScroll = useAnimatedScrollHandler({
    onBeginDrag: (e) => {
      // Bij het openen op een foto komt er geen scroll-gebeurtenis: neem bij
      // het begin van de swipe de echte positie over (C1, besluit 4).
      offset.value = e.contentOffset.x;
      swiping.value = true;
    },
    onScroll: (e) => {
      offset.value = e.contentOffset.x;
    },
  });

  return { infoIndex, infoStyle, onScroll };
}

// Voor een PhotoImage-fallback: meldt dat de cover niet laadt, zodat de kop
// zich gedraagt als een kop zonder cover (A6).
export function CoverFailed({ onFail, children }: { onFail: () => void; children: ReactNode }) {
  useEffect(onFail, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{children}</>;
}

const styles = StyleSheet.create({
  clip: { position: "absolute", left: 0, right: 0, overflow: "hidden" },
});
