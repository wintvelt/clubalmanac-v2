import { Stack } from "expo-router";
import { INFO_PAGES } from "../../../lib/infoPages";
import { useStackScreenOptions } from "../../../navigation/stackOptions";

// Een deep link naar /instellingen/over opent met Instellingen eronder, dus
// met een werkende terugknop (WP15a invariant 15).
export const unstable_settings = { anchor: "index" };

export default function Layout() {
  return (
    <Stack screenOptions={useStackScreenOptions()}>
      <Stack.Screen name="index" options={{ title: "Instellingen" }} />
      {INFO_PAGES.map((page) => (
        <Stack.Screen key={page.slug} name={page.slug} options={{ title: page.title }} />
      ))}
    </Stack>
  );
}
