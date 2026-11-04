import { Stack } from "expo-router";
import { useStackScreenOptions } from "../../../navigation/stackOptions";

// WP16 §Routes: Mijn groepen → Groep → Album. Een deep link naar een groep
// opent met Mijn groepen eronder, dus de terugknop-pil werkt altijd.
export const unstable_settings = { anchor: "index" };

export default function Layout() {
  return (
    <Stack screenOptions={useStackScreenOptions()}>
      <Stack.Screen name="index" options={{ title: "Mijn groepen", headerShown: false }} />
      <Stack.Screen name="groep/[groupId]/index" options={{ title: "Groep", headerShown: false }} />
      <Stack.Screen name="groep/[groupId]/album/[albumId]" options={{ title: "Album" }} />
    </Stack>
  );
}
