import { Stack } from "expo-router";
import { useStackScreenOptions } from "../../../navigation/stackOptions";

// WP17c: Mijn foto's → Foto (swipen door je eigen foto's) → Draaien.
export default function Layout() {
  return (
    <Stack screenOptions={useStackScreenOptions()}>
      <Stack.Screen name="index" options={{ title: "Mijn foto's" }} />
      <Stack.Screen name="foto/[photoId]" options={{ title: "Foto" }} />
      <Stack.Screen name="draaien/[photoId]" options={{ title: "Draaien" }} />
    </Stack>
  );
}
