import { Tabs } from "expo-router/js-tabs";
import { TabBar } from "../../navigation/TabBar";

// De uitgelogde tabbalk (WP15b): Inloggen · Info. De uitnodiging komt met
// WP19. Geen +: dat is een actie voor wie ingelogd is. Zonder vaste eerste
// route kiest Expo Router "info" (alfabetisch), en dan opent een koude start
// uitgelogd op Info in plaats van op Inloggen.
export const unstable_settings = { anchor: "inloggen" };

export default function SignedOutTabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} plus={false} />}
      backBehavior="initialRoute"
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="inloggen" />
      <Tabs.Screen name="info" />
    </Tabs>
  );
}
