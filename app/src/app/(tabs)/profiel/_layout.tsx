import { Stack } from "expo-router";
import { useStackScreenOptions } from "../../../navigation/stackOptions";

export default function Layout() {
  return (
    <Stack screenOptions={useStackScreenOptions()}>
      <Stack.Screen name="index" options={{ title: "Profiel" }} />
      <Stack.Screen name="verwijderen" options={{ title: "Account verwijderen" }} />
    </Stack>
  );
}
