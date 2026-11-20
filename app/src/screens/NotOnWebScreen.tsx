import { router } from "expo-router";
import { Button } from "../components/Button";
import { StatusScreen } from "./StatusScreen";

// WP35 A-invariant W5: op het web is de app alleen-lezen. Een scherm dat iets
// wijzigt (uploaden, bewerken, uitnodigen, melden, account verwijderen) is via
// de adresbalk nog te openen; dan deze pagina, zonder actie en zonder crash.
// De route-bestanden `*.web.tsx` naast de iOS-routes tonen hem.
export function NotOnWebScreen() {
  return (
    <StatusScreen
      title="Alleen in de app"
      message="Dit kan op het web nog niet. Gebruik hiervoor de app Clubalmanac op de iPhone."
    >
      <Button
        title="Terug"
        icon="back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      />
    </StatusScreen>
  );
}
