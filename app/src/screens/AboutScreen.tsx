import Constants from "expo-constants";
import { Screen } from "../components/Screen";
import { Text } from "../components/Text";

// App-naam en versie, uit app.json.
export function AboutScreen() {
  const config = Constants.expoConfig;
  return (
    <Screen underHeader>
      <Text variant="title" accessibilityRole="header">
        {config?.name ?? "Clubalmanac"}
      </Text>
      <Text color="muted">Versie {config?.version ?? "onbekend"}</Text>
    </Screen>
  );
}
