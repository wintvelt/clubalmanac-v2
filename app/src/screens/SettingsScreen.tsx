import { router } from "expo-router";
import { SignOutButton } from "../auth/SignOutButton";
import { ListRow, ListSection } from "../components/ListRow";
import { Screen } from "../components/Screen";
import { READ_ONLY } from "../data/readOnly";
import { InfoList } from "./InfoList";

// Gegroepeerde lijst (design.md §9). WP15b A-punt 5: de Info-regels, precies
// als uitgelogd, en Uitloggen. De instellingen van de oude app vervallen of
// horen bij een later WP.
// WP20 besluit 4: ideeën en problemen, onder de Info-regels.
export function SettingsScreen() {
  return (
    <Screen underHeader>
      <InfoList signedIn />
      {/* WP35 W5: ideeën en problemen melden zijn acties; op het web weg. */}
      {!READ_ONLY && (
        <ListSection>
          <ListRow icon="idea" title="Ideeën" onPress={() => router.push("/instellingen/ideeen")} />
          <ListRow icon="problem" title="Probleem melden" onPress={() => router.push("/instellingen/problemen")} />
        </ListSection>
      )}
      <SignOutButton />
    </Screen>
  );
}
