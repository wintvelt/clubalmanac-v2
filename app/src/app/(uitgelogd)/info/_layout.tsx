import { Stack } from "expo-router";
import { INFO_PAGES } from "../../../lib/infoPages";
import { useStackScreenOptions } from "../../../navigation/stackOptions";

// Uitgelogd: dezelfde Info-pagina's als onder Instellingen (WP15b). Een deep
// link naar /info/privacy opent met de lijst eronder, met een terugknop.
export const unstable_settings = { anchor: "index" };

export default function Layout() {
  return (
    <Stack screenOptions={useStackScreenOptions()}>
      <Stack.Screen name="index" options={{ title: "Info" }} />
      {INFO_PAGES.map((page) => (
        <Stack.Screen key={page.slug} name={page.slug} options={{ title: page.title }} />
      ))}
    </Stack>
  );
}
