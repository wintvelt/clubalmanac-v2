import Constants from "expo-constants";
import { buildNumber, testFlightBuild } from "../../modules/clubalmanac-video";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking } from "react-native";
import { ListRow, ListSection } from "../components/ListRow";
import type { IconName } from "../components/Icon";
import { Text } from "../components/Text";
import { DEV_TOOLS } from "../data/devTools";
import { buildLabels, CONTACT_MAILTO, INFO_PAGES, infoPath, versionText, type InfoSlug } from "../lib/infoPages";

// WP15b A-punt 4: de Info-lijst, ingelogd (op Instellingen) en uitgelogd (op
// /info) precies hetzelfde. Geen user-gegevens, ook niet in de mailto
// (invariant 11). `signedIn` kiest alleen de route.

const ICONS: Record<InfoSlug, IconName> = { over: "info", privacy: "privacy", voorwaarden: "document" };

// Naam en versie, uit app.json; WP42 B18: met het buildnummer van de build.
// WP47: met "dev" (uit DEV_TOOLS) en "TestFlight" (de module, op het toestel
// bepaald). Versie, buildnummer en "dev" staan er meteen; "TestFlight" komt
// erbij zodra iOS antwoordt, en blijft weg bij "weet niet" (invariant 12).
export function AppIdentity() {
  const config = Constants.expoConfig;
  const [testFlight, setTestFlight] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void testFlightBuild().then((answer) => {
      if (alive) setTestFlight(answer);
    });
    return () => {
      alive = false;
    };
  }, []);
  const labels = buildLabels({ dev: DEV_TOOLS, testFlight });
  return (
    <>
      <Text variant="title" accessibilityRole="header">
        {config?.name ?? "Clubalmanac"}
      </Text>
      <Text color="muted">{versionText(config?.version, buildNumber(), labels)}</Text>
    </>
  );
}

export function InfoList({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      <AppIdentity />
      <ListSection>
        {INFO_PAGES.map((page) => (
          <ListRow
            key={page.slug}
            icon={ICONS[page.slug]}
            title={page.title}
            onPress={() => router.push(infoPath(page.slug, signedIn))}
          />
        ))}
        {/* WP20 besluit 5: ook uitgelogd de weg om een probleem te melden. */}
        <ListRow
          icon="mail"
          title="Contact of probleem melden"
          chevron={false}
          onPress={() => void Linking.openURL(CONTACT_MAILTO).catch(() => {})}
        />
      </ListSection>
    </>
  );
}
