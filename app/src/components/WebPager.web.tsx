import { useIsFocused, useNavigation } from "expo-router";
import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { usePhotoLoad } from "../data/images";
import { neighbours, stepIndex, swipeIndex } from "../lib/webPager";
import { photoLayers } from "../theme";
import { Icon } from "./Icon";
import type { WebPagerProps } from "./WebPager";

// WP35, webapp-fix 3 (besluit Wouter): het foto-detail op het web toont één
// foto tegelijk, zonder horizontale scrollcontainer. In WebKit liep de
// horizontale lijst zelf weg terwijl beelden binnenkwamen (scrollLeft sprong
// elke seconde naar een andere foto, eindeloos beelden ophalen). Nu verandert
// alleen de user de foto:
// - de knoppen ‹ › links en rechts;
// - de pijltoetsen, alleen in het scherm dat in beeld is;
// - een veeg (aanraken, of slepen met de muis) over de drempel
//   (src/lib/webPager.ts).
// De buren worden voorgeladen, maar veranderen de index nooit. De adresbalk
// volgt de foto in beeld (`photoId`), zonder een nieuwe stap in de
// geschiedenis per foto: verversen of de link delen geeft deze foto, terug
// gaat naar het album.
export type { WebPagerProps };

export function WebPager({ index, count, onChange, photoId, renderPage, photoAt, onNearEnd }: WebPagerProps) {
  const focused = useIsFocused();
  const navigation = useNavigation();
  const change = useRef(onChange);
  change.current = onChange;
  const state = useRef({ index, count });
  state.current = { index, count };

  const go = (to: number) => {
    const { index: i, count: n } = state.current;
    const next = stepIndex(i, to - i, n);
    if (next !== i) change.current(next);
  };
  const goRef = useRef(go);
  goRef.current = go;

  // De adresbalk: setParams van dít scherm vervangt de URL (geen nieuwe stap).
  const shownId = useRef(photoId);
  useEffect(() => {
    if (!photoId || shownId.current === photoId) return;
    shownId.current = photoId;
    navigation.setParams({ photoId } as never);
  }, [photoId, navigation]);

  useEffect(() => {
    if (onNearEnd && count > 0 && index >= count - 3) onNearEnd();
  }, [index, count]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "ArrowLeft") goRef.current(state.current.index - 1);
      if (e.key === "ArrowRight") goRef.current(state.current.index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused]);

  // Vegen: van neerzetten tot loslaten, één vinger (twee is knijpen).
  // react-native-web: de ref van een View is het DOM-element.
  const area = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = area.current;
    if (!node || typeof node.addEventListener !== "function") return;
    // Verticaal en knijpen doet de browser; horizontaal is van ons.
    node.style.touchAction = "pan-y pinch-zoom";
    let start: { x: number; y: number } | null = null;
    const finish = (x: number, y: number) => {
      if (!start) return;
      const { index: i, count: n } = state.current;
      const to = swipeIndex({ dx: x - start.x, dy: y - start.y, width: node.clientWidth, index: i, count: n });
      start = null;
      if (to !== i) change.current(to);
    };
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1) start = null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (t) finish(t.clientX, t.clientY);
    };
    const onTouchCancel = () => {
      start = null;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button === 0) start = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "mouse") finish(e.clientX, e.clientY);
    };
    // Geen sleep-plaatje van de foto bij slepen met de muis.
    const onDragStart = (e: DragEvent) => e.preventDefault();
    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: true });
    node.addEventListener("touchend", onTouchEnd, { passive: true });
    node.addEventListener("touchcancel", onTouchCancel, { passive: true });
    node.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    node.addEventListener("dragstart", onDragStart);
    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchCancel);
      node.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      node.removeEventListener("dragstart", onDragStart);
    };
  }, []);

  return (
    <View
      ref={(n: unknown) => {
        area.current = n as HTMLElement | null;
      }}
      style={styles.fill}
    >
      {renderPage(index)}
      {neighbours(index, count).map((i) => {
        const p = photoAt(i);
        return p ? <Preload key={p.photoId} photoId={p.photoId} hasFormats={p.hasFormats} /> : null;
      })}
      {count > 1 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {index > 0 && <Arrow side="left" label="Vorige foto" icon="back" onPress={() => go(index - 1)} />}
          {index < count - 1 && (
            <Arrow side="right" label="Volgende foto" icon="chevron" onPress={() => go(index + 1)} />
          )}
        </View>
      )}
    </View>
  );
}

// Haalt het beeld van een buurfoto alvast op (in het beeldgeheugen); toont niets.
function Preload({ photoId, hasFormats }: { photoId: string; hasFormats?: boolean }) {
  usePhotoLoad(photoId, "groot", hasFormats === true);
  return null;
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
  fill: { flex: 1, overflow: "hidden", userSelect: "none" },
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
