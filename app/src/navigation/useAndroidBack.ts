import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";
import { BackHandler, Platform } from "react-native";

/**
 * WP42 A3: de terugknop (en het terugvegen) van Android. Zolang `active` en
 * het scherm in beeld is, vangt `onBack` de terugknop op in plaats van dat
 * het scherm sluit; zonder `onBack` doet terug dan niets. Op iOS en het web
 * doet dit niets: daar regelt `gestureEnabled` hetzelfde.
 */
export function useAndroidBack(active: boolean, onBack?: () => void): void {
  const handler = useRef(onBack);
  handler.current = onBack;
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android" || !active) return undefined;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        handler.current?.();
        return true;
      });
      return () => sub.remove();
    }, [active]),
  );
}
