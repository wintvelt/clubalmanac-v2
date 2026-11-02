import { Tabs } from "expo-router/js-tabs";
import { TabBar } from "../../navigation/TabBar";

// Vier tabs, elk met een eigen stack. De + zit in de TabBar zelf, als actie.
export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="(home)" />
      <Tabs.Screen name="mijn-fotos" />
      <Tabs.Screen name="profiel" />
      <Tabs.Screen name="instellingen" />
    </Tabs>
  );
}
