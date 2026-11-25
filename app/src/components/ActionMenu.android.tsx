import { useSyncExternalStore } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, size, space, useTheme } from "../theme";
import { Text } from "./Text";
import type { ActionMenuOptions } from "./ActionMenu";

export type { ActionMenuOptions } from "./ActionMenu";

// WP42 A1: het menu op Android. Een blad onderaan zoals Material het heeft
// (geen nagebootst iOS-blad): de titel, dan de opties in dezelfde volgorde en
// met dezelfde teksten als op iOS. Annuleren staat er niet als regel in, zoals
// bij Android-menu's: de terugknop of ernaast tikken sluit het menu, en dat
// telt als Annuleren (er gebeurt niets). Gevaarlijke opties staan in rood.
// Het menu staat één keer in de boom (`ActionMenuHost` in App.tsx); de
// schermen roepen `showActionMenu` aan zoals op iOS.

type Open = { options: ActionMenuOptions; onSelect: (index: number) => void };

let current: Open | null = null;
const listeners = new Set<() => void>();

function set(next: Open | null) {
  current = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function showActionMenu(options: ActionMenuOptions, onSelect: (index: number) => void): void {
  set({ options, onSelect });
}

export function dismissActionMenu(): void {
  set(null);
}

function choose(open: Open, index: number) {
  // Alleen als dit menu nog open is: een tweede tik doet niets.
  if (current !== open) return;
  set(null);
  open.onSelect(index);
}

export function ActionMenuHost() {
  const open = useSyncExternalStore(subscribe, () => current);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!open) return null;
  const { title, options, cancelButtonIndex, destructiveButtonIndex } = open.options;
  const cancel = () => choose(open, cancelButtonIndex);
  return (
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={cancel}
    >
      <View style={styles.fill}>
        <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={cancel} importantForAccessibility="no" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              paddingBottom: insets.bottom + space.s,
              paddingLeft: insets.left,
              paddingRight: insets.right,
              marginTop: insets.top + size.touchMin,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.line }]} />
          {title ? (
            <Text variant="fieldLabel" color="muted" style={styles.title} accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          <ScrollView bounces={false}>
            {options.map((label, index) =>
              index === cancelButtonIndex ? null : (
                <Pressable
                  key={index}
                  accessibilityRole="menuitem"
                  android_ripple={{ color: colors.line }}
                  onPress={() => choose(open, index)}
                  style={styles.row}
                >
                  <Text variant="listRow" color={index === destructiveButtonIndex ? "danger" : "text"}>
                    {label}
                  </Text>
                </Pressable>
              ),
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  scrim: { backgroundColor: "rgba(0, 0, 0, 0.4)" },
  sheet: {
    borderTopLeftRadius: radius.groupPhoto,
    borderTopRightRadius: radius.groupPhoto,
    paddingTop: space.s,
    flexShrink: 1,
  },
  handle: { alignSelf: "center", width: 32, height: 4, borderRadius: 2, marginBottom: space.s },
  title: { paddingHorizontal: size.screenMargin + space.s, paddingVertical: space.s },
  row: {
    minHeight: size.row,
    justifyContent: "center",
    paddingHorizontal: size.screenMargin + space.s,
    paddingVertical: space.s,
  },
});
