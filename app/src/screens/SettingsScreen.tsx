import { router } from "expo-router";
import { SignOutButton } from "../auth/SignOutButton";
import { ListRow, ListSection } from "../components/ListRow";
import { Screen } from "../components/Screen";
import { Text } from "../components/Text";

// Gegroepeerde lijst (design.md §9). De rest van de inhoud is WP15b; in 15a
// staan hier "Over de app" (om de terugknop te testen) en Uitloggen.
export function SettingsScreen() {
  return (
    <Screen underHeader>
      <ListSection>
        <ListRow icon="info" title="Over de app" onPress={() => router.push("/instellingen/over")} />
      </ListSection>
      <Text color="muted">Meer instellingen komen in een volgende versie.</Text>
      <SignOutButton />
    </Screen>
  );
}
