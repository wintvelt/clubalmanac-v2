import { SignOutButton } from "../auth/SignOutButton";
import { Screen } from "../components/Screen";
import { InfoList } from "./InfoList";

// Gegroepeerde lijst (design.md §9). WP15b A-punt 5: de Info-regels, precies
// als uitgelogd, en Uitloggen. De instellingen van de oude app vervallen of
// horen bij een later WP.
export function SettingsScreen() {
  return (
    <Screen underHeader>
      <InfoList signedIn />
      <SignOutButton />
    </Screen>
  );
}
