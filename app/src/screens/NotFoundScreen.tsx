import { router } from "expo-router";
import { Button } from "../components/Button";
import { StatusScreen } from "./StatusScreen";

// Ingelogd op een pad dat niet bestaat (WP15a §Routes).
export function NotFoundScreen() {
  return (
    <StatusScreen
      title="Niet gevonden"
      message="Deze pagina bestaat niet (meer). Ga terug naar Home."
    >
      <Button title="Naar Home" icon="home" onPress={() => router.replace("/")} />
    </StatusScreen>
  );
}
