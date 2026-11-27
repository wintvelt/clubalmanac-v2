import { Stack } from "expo-router";
import { photoDetailRouteOptions, useStackScreenOptions } from "../../../navigation/stackOptions";

// WP17c: Mijn foto's → Foto (swipen door je eigen foto's) → Draaien.
export default function Layout() {
  return (
    <Stack screenOptions={useStackScreenOptions()}>
      <Stack.Screen name="index" options={{ title: "Mijn foto's" }} />
      <Stack.Screen name="foto/[photoId]" options={photoDetailRouteOptions} />
      <Stack.Screen name="draaien/[photoId]" options={{ title: "Draaien" }} />
      <Stack.Screen name="locatie/[photoId]" options={{ title: "Locatie wijzigen" }} />
    </Stack>
  );
}
