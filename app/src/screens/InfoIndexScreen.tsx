import { Screen } from "../components/Screen";
import { InfoList } from "./InfoList";

// De tab Info voor wie uitgelogd is (WP15b, /info).
export function InfoIndexScreen() {
  return (
    <Screen underHeader>
      <InfoList signedIn={false} />
    </Screen>
  );
}
