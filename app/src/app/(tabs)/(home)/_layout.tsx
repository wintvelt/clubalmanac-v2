import { Stack } from "expo-router";
import { useStackScreenOptions } from "../../../navigation/stackOptions";

// WP16 §Routes: Mijn groepen → Groep → Album → Foto (WP17a) → Draaien (WP17b). Een deep link naar een groep
// opent met Mijn groepen eronder, dus de terugknop-pil werkt altijd.
export const unstable_settings = { anchor: "index" };

export default function Layout() {
  return (
    <Stack screenOptions={useStackScreenOptions()}>
      <Stack.Screen name="index" options={{ title: "Mijn groepen", headerShown: false }} />
      <Stack.Screen name="groep/[groupId]/index" options={{ title: "Groep", headerShown: false }} />
      <Stack.Screen name="groep/[groupId]/album/[albumId]/index" options={{ title: "Album", headerShown: false }} />
      <Stack.Screen name="groep/[groupId]/album/[albumId]/foto/[photoId]" options={{ title: "Foto" }} />
      <Stack.Screen name="groep/[groupId]/album/[albumId]/draaien/[photoId]" options={{ title: "Draaien" }} />
    </Stack>
  );
}
