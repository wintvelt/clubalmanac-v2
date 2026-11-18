import { useSyncExternalStore } from "react";
import { AccessibilityInfo, AppState } from "react-native";

// WP33 F1: "Beperk beweging" en VoiceOver, live. Zet de user een instelling om
// terwijl de app openstaat, dan geldt die meteen (de gebeurtenis van iOS), en
// anders zodra de app weer actief wordt (opnieuw gelezen). De hook van
// Reanimated leest de instelling alleen bij de start; daarom niet die.

type Setting = { value: boolean; listeners: Set<() => void> };

const reduceMotion: Setting = { value: false, listeners: new Set() };
const screenReader: Setting = { value: false, listeners: new Set() };

function set(setting: Setting, value: boolean) {
  if (setting.value === value) return;
  setting.value = value;
  for (const listener of setting.listeners) listener();
}

let started = false;

function start() {
  if (started) return;
  started = true;
  const read = () => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => set(reduceMotion, v), () => {});
    AccessibilityInfo.isScreenReaderEnabled().then((v) => set(screenReader, v), () => {});
  };
  read();
  AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => set(reduceMotion, v));
  AccessibilityInfo.addEventListener("screenReaderChanged", (v) => set(screenReader, v));
  AppState.addEventListener("change", (state) => {
    if (state === "active") read();
  });
}

// Zo vroeg mogelijk lezen: de eerste animatie kent de instelling dan al.
start();

function subscribe(setting: Setting) {
  return (listener: () => void) => {
    setting.listeners.add(listener);
    return () => {
      setting.listeners.delete(listener);
    };
  };
}

const subscribeReduceMotion = subscribe(reduceMotion);
const subscribeScreenReader = subscribe(screenReader);

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribeReduceMotion, () => reduceMotion.value);
}

export function useScreenReader(): boolean {
  return useSyncExternalStore(subscribeScreenReader, () => screenReader.value);
}

// Buiten React (een tik op de pil): de waarde van nu.
export function screenReaderOn(): boolean {
  return screenReader.value;
}
