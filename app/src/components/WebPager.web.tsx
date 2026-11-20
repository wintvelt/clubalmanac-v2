import { useEffect, useRef, type RefObject } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { photoLayers } from "../theme";
import { Icon } from "./Icon";

// WP35: bladeren in het foto-detail op het web. react-native-web geeft geen
// `onMomentumScrollEnd` (en geen sleep-gebeurtenissen), dus het scherm hoort
// niet welke foto er na het swipen staat. Deze laag luistert naar het scrollen
// van de lijst zelf en meldt de foto als het scrollen stilstaat. Met een muis
// is er niet te swipen: knoppen links en rechts, en de pijltjestoetsen.
export type WebPagerProps = {
  list: RefObject<unknown>;
  index: number;
  count: number;
  pageWidth: number;
  onSettle: (index: number) => void;
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

export function WebPager({ list, index, count, pageWidth, onSettle }: WebPagerProps) {
  const settle = useRef(onSettle);
  settle.current = onSettle;

  useEffect(() => {
    const node = scrollNode(list);
    if (!node || pageWidth <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const i = Math.round(node.scrollLeft / pageWidth);
        settle.current(Math.max(0, Math.min(count - 1, i)));
      }, SETTLE_MS);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
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
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "ArrowLeft") goRef.current(indexRef.current - 1);
      if (e.key === "ArrowRight") goRef.current(indexRef.current + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
