import { useIsFocused, useNavigation } from "expo-router";
import { useEffect, useRef, type RefObject } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { pagerSettle } from "../lib/webPager";
import { photoLayers } from "../theme";
import { Icon } from "./Icon";

// WP35: bladeren in het foto-detail op het web. react-native-web geeft geen
// `onMomentumScrollEnd` (en geen sleep-gebeurtenissen), dus het scherm hoort
// niet welke foto er na het swipen staat. Deze laag luistert naar het scrollen
// van de lijst zelf en meldt de foto als het scrollen stilstaat. Met een muis
// is er niet te swipen: knoppen links en rechts, en de pijltjestoetsen. De
// pijltjes werken alleen in het scherm dat in beeld is (niet in een detail
// onder een ander scherm of in een andere tab). De adresbalk volgt de foto in
// beeld (`photoId`), zonder een nieuwe stap in de geschiedenis per foto, zodat
// verversen of de link delen deze foto geeft.
//
// Alleen een gebaar van de user (aanraken, trackpad) bladert. Schuift de lijst
// zonder gebaar (de beginpositie, of Safari die de scroll-snap opnieuw zet als
// de gerenderde foto's wisselen), dan gaat hij terug naar de foto in beeld;
// anders ontstond op de iPhone een lus van wisselende foto's (src/lib/webPager.ts).
export type WebPagerProps = {
  list: RefObject<unknown>;
  index: number;
  count: number;
  pageWidth: number;
  onSettle: (index: number) => void;
  /** De foto in beeld; de route-parameter `photoId` volgt hem. */
  photoId?: string;
};

// Zo lang na het laatste scroll-event staat de lijst stil.
const SETTLE_MS = 120;

type ScrollableList = {
  getScrollableNode?: () => unknown;
  scrollToIndex?: (p: { index: number; animated: boolean }) => void;
};

function scrollNode(list: RefObject<unknown>): HTMLElement | null {
  const node = (list.current as ScrollableList | null)?.getScrollableNode?.();
  return node instanceof HTMLElement ? node : null;
}

export function WebPager({ list, index, count, pageWidth, onSettle, photoId }: WebPagerProps) {
  const settle = useRef(onSettle);
  settle.current = onSettle;
  const focused = useIsFocused();
  const navigation = useNavigation();

  // De adresbalk: setParams van dít scherm vervangt de URL (geen nieuwe stap).
  const shownId = useRef(photoId);
  useEffect(() => {
    if (!photoId || shownId.current === photoId) return;
    shownId.current = photoId;
    navigation.setParams({ photoId } as never);
  }, [photoId, navigation]);

  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    const node = scrollNode(list);
    if (!node || pageWidth <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Een gebaar loopt van de aanraking tot het scrollen erna stilstaat (ook
    // het uitlopen na loslaten).
    let touching = false;
    let gesture = false;
    const onTouchStart = () => {
      touching = true;
      gesture = true;
    };
    const onTouchEnd = () => {
      touching = false;
    };
    const onWheel = () => {
      gesture = true;
    };
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const step = pagerSettle({
          gesture,
          scrollLeft: node.scrollLeft,
          pageWidth,
          index: indexRef.current,
          count,
        });
        if (!touching) gesture = false;
        if (step.kind === "show") settle.current(step.index);
        if (step.kind === "restore") node.scrollLeft = step.left;
      }, SETTLE_MS);
    };
    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchend", onTouchEnd, { passive: true });
    node.addEventListener("touchcancel", onTouchEnd, { passive: true });
    node.addEventListener("wheel", onWheel, { passive: true });
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("scroll", onScroll);
    };
  }, [list, pageWidth, count]);

  const go = (to: number) => {
    if (to < 0 || to > count - 1) return;
    // Zonder animatie: een vloeiende scroll hangt van animatie-frames af en
    // valt in een tabblad op de achtergrond stil; de snap klopt zo altijd.
    (list.current as ScrollableList | null)?.scrollToIndex?.({ index: to, animated: false });
    // Meteen melden: niet wachten tot het scrollen stilstaat.
    settle.current(to);
  };
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "ArrowLeft") goRef.current(indexRef.current - 1);
      if (e.key === "ArrowRight") goRef.current(indexRef.current + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused]);

  if (count < 2) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {index > 0 && (
        <Arrow side="left" label="Vorige foto" icon="back" onPress={() => go(index - 1)} />
      )}
      {index < count - 1 && (
        <Arrow side="right" label="Volgende foto" icon="chevron" onPress={() => go(index + 1)} />
      )}
    </View>
  );
}

function Arrow({
  side,
  label,
  icon,
  onPress,
}: {
  side: "left" | "right";
  label: string;
  icon: "back" | "chevron";
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.arrow, side === "left" ? styles.left : styles.right, pressed && styles.pressed]}
    >
      <Icon name={icon} size={24} color={photoLayers.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  arrow: {
    position: "absolute",
    top: "50%",
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    // De laag van de terugknop op een foto (photoLayers.pill).
    backgroundColor: "rgba(15, 23, 42, 0.62)",
  },
  left: { left: 12 },
  right: { right: 12 },
  pressed: { opacity: 0.7 },
});
