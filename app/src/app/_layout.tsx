import { Stack, ThemeProvider } from "expo-router";
import App from "../../App";
import { AuthGate } from "../AuthGate";
import { useAuthState } from "../data/authStateContext";
import {
  CloseButton,
  useNavigationTheme,
  useStackScreenOptions,
} from "../navigation/stackOptions";

// Wortel van de router: providers (App.tsx), dan de auth-poort, dan één
// stack met de tabs, de modaal en het inlogscherm. Routes en deep links:
// WP15a §Routes.
export default function RootLayout() {
  return (
    <App>
      <AuthGate>
        <RootStack />
      </AuthGate>
    </App>
  );
}

// De guards volgen dezelfde toestand als de poort (WP15a invarianten 4, 11).
// Een scherm achter een guard die dichtgaat, verdwijnt uit de geschiedenis:
// na uitloggen is er geen terugknop of veeggebaar terug de app in, en na
// inloggen begint de app op Home met lege stacks.
function RootStack() {
  const ready = useAuthState() === "ready";
  const screenOptions = useStackScreenOptions();
  return (
    <ThemeProvider value={useNavigationTheme()}>
      <Stack screenOptions={{ ...screenOptions, headerShown: false }}>
        <Stack.Protected guard={ready}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="toevoegen"
            dangerouslySingular
            options={{
              presentation: "modal",
              headerShown: true,
              title: "Foto's toevoegen",
              headerRight: () => <CloseButton />,
            }}
          />
          <Stack.Screen name="+not-found" options={{ headerShown: true, title: "Niet gevonden" }} />
        </Stack.Protected>
        <Stack.Protected guard={!ready}>
          <Stack.Screen name="inloggen" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
