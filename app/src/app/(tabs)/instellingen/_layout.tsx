import { Stack } from "expo-router";
import { useStackScreenOptions } from "../../../navigation/stackOptions";

// Een deep link naar /instellingen/over opent met Instellingen eronder, dus
// met een werkende terugknop (WP15a invariant 15).
export const unstable_settings = { anchor: "index" };

export default function Layout() {
  return (
    <Stack screenOptions={useStackScreenOptions()}>
      <Stack.Screen name="index" options={{ title: "Instellingen" }} />
      <Stack.Screen name="over" options={{ title: "Over de app" }} />
    </Stack>
  );
}
