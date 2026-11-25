import { router } from "expo-router";
import { Image } from "expo-image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, Switch, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { FounderButton } from "../components/FounderButton";
import { Icon } from "../components/Icon";
import { QueryBoundary } from "../components/QueryBoundary";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useOriginalPosterLoad } from "../data/images";
import { listenOriginals, originalsSnapshot, setOriginalsWifiOnly } from "../data/originals";
import { useLiveQuery } from "../data/useLiveQuery";
import { FOUNDER_BUTTONS, groupFilmView, type Platform as FilmPlatform } from "../lib/filmProject";
import { filmProjectPath, newFilmProjectPath } from "../lib/groupRoutes";
import { formatDuration } from "../lib/videos";
import { photoLayers, radius, size, space, useTheme } from "../theme";

// WP38c: de delen van het filmproject die meer dan één scherm gebruikt: de
// balk en de knop in de groep, de schakelaar "Alleen via wifi" (toevoegscherm
// en projectpagina, één stand: 38c-15), en de poster van een inzending.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38c.

/** Het platform voor de pure regels van src/lib/filmProject.ts. */
export const FILM_PLATFORM: FilmPlatform = Platform.OS === "web" ? "web" : "ios";

/** Elke zoveel tijd opnieuw "nu", voor teksten die met de klok verschuiven. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** De wachtrij van dit toestel (38b), live: de stand volgt hem zonder verversen (38c-16). */
export function useOriginals() {
  return useSyncExternalStore(listenOriginals, originalsSnapshot);
}

// --- groep: de knop en de balk (38c-3, 38c-20) ----------------------------------------

type GroupFilmProps = { groupId: Id<"groups">; isFounder: boolean };

/**
 * Besluit 1 na A, feedback na besluit 27: "Filmproject starten" met een
 * filmrol links en de gele sleutel achter de tekst, naast "Bewerk groep".
 * Alleen de oprichter, in de app, als de projecten geladen zijn en er geen
 * open project is. Een fout bij laden: geen knop.
 */
export function StartFilmProjectButton(props: GroupFilmProps) {
  return (
    <QueryBoundary fallback={() => null}>
      <StartButton {...props} />
    </QueryBoundary>
  );
}

function StartButton({ groupId, isFounder }: GroupFilmProps) {
  const projects = useLiveQuery(api.filmProjects.listForGroup, { groupId });
  const now = useNow(60_000);
  const view = groupFilmView({ platform: FILM_PLATFORM, isFounder, projects, now });
  if (!view.start) return null;
  return (
    <FounderButton button={FOUNDER_BUTTONS.start} onPress={() => router.push(newFilmProjectPath(groupId))} />
  );
}

/** Een balk per project, het open project eerst; tik opent de projectpagina. Een fout bij laden: geen balk. */
export function FilmProjectBanners(props: GroupFilmProps) {
  return (
    <QueryBoundary fallback={() => null}>
      <Banners {...props} />
    </QueryBoundary>
  );
}

function Banners({ groupId, isFounder }: GroupFilmProps) {
  const projects = useLiveQuery(api.filmProjects.listForGroup, { groupId });
  const now = useNow(60_000);
  const { banners } = groupFilmView({ platform: FILM_PLATFORM, isFounder, projects, now });
  if (banners.length === 0) return null;
  return (
    <View style={styles.banners}>
      {banners.map((b) => (
        <FilmBanner
          key={b.projectId}
          title={b.title}
          text={b.text}
          onPress={() => router.push(filmProjectPath(groupId, b.projectId))}
        />
      ))}
    </View>
  );
}

function FilmBanner({ title, text, onPress }: { title: string; text: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${text}`}
      accessibilityHint="Opent het filmproject"
      onPress={onPress}
      style={({ pressed }) => [
        styles.banner,
        { backgroundColor: colors.surface, borderColor: colors.cta },
        pressed && { backgroundColor: colors.line },
      ]}
    >
      <View style={[styles.bannerIcon, { backgroundColor: colors.cta }]}>
        <Icon name="film" size={22} color={colors.onCta} filled />
      </View>
      <View style={styles.grow}>
        <Text variant="albumName">{title}</Text>
        <Text variant="albumMeta" color="muted">
          {text}
        </Text>
      </View>
      <Icon name="chevron" size={20} color={colors.muted} />
    </Pressable>
  );
}

// --- "Alleen via wifi" (besluit 6, 38c-15) ---------------------------------------------

/**
 * Eén stand voor het toestel, uit de runner van 38b. Omzetten gaat via
 * `setOriginalsWifiOnly`; lukt uitzetten niet, dan springt hij terug op aan
 * (de runner zet de stand).
 */
// Feedback build 89, punt 1 (mockup 2): een kaart, label en schakelaar op één
// lijn en verticaal gecentreerd. Het label staat in een eigen vak dat de hoogte
// van de rij krijgt en zijn tekst centreert, de schakelaar in een vak ernaast.
export function WifiOnlySwitch() {
  const { colors } = useTheme();
  const snap = useOriginals();
  const [busy, setBusy] = useState(false);
  return (
    <View style={[styles.switchCard, { backgroundColor: colors.surface }]}>
      <View style={styles.switchLabel}>
        <Text>Alleen via wifi</Text>
      </View>
      <View style={styles.switchBox}>
        <Switch
          accessibilityLabel="Alleen via wifi"
          value={snap.wifiOnly}
          disabled={busy || !snap.loaded}
          onValueChange={(on) => {
            setBusy(true);
            void setOriginalsWifiOnly(on)
              .catch(() => false)
              .finally(() => setBusy(false));
          }}
        />
      </View>
    </View>
  );
}

// --- de poster van een inzending -------------------------------------------------------

/**
 * Via `/beeld/inzending/<id>` (38c-19). Lukt het laden niet (net teruggetrokken
 * of verwijderd: 404), dan een lege tegel, geen fout. Met de lengte erop.
 */
export function OriginalPoster({
  originalId,
  durationMs,
  side = 64,
}: {
  originalId: string | null;
  durationMs: number | null;
  side?: number;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.poster, { width: side, height: side, backgroundColor: colors.line }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {originalId ? (
        <PosterImage originalId={originalId} />
      ) : (
        <View style={styles.center}>
          <Icon name="film" size={24} color={colors.muted} />
        </View>
      )}
      {durationMs !== null && durationMs > 0 && (
        <View style={styles.duration}>
          <View style={[StyleSheet.absoluteFill, styles.layer]} />
          <Text variant="badge" style={styles.durationText} maxFontSizeMultiplier={1.3}>
            {formatDuration(durationMs)}
          </Text>
        </View>
      )}
    </View>
  );
}

function PosterImage({ originalId }: { originalId: string }) {
  const { source, attempt, onError } = useOriginalPosterLoad(originalId, "klein");
  if (!source) return null;
  return (
    <Image
      key={attempt}
      source={source}
      cachePolicy="memory"
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      accessible={false}
      onError={onError}
    />
  );
}

const styles = StyleSheet.create({
  banners: { gap: space.s },
  banner: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: space.m,
    paddingVertical: space.m,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  bannerIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  grow: { flex: 1, gap: 2 },
  switchCard: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
    borderRadius: radius.listBlock,
  },
  switchLabel: { flex: 1, alignSelf: "stretch", justifyContent: "center" },
  switchBox: { alignSelf: "stretch", justifyContent: "center" },
  poster: { borderRadius: 10, overflow: "hidden" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  layer: { backgroundColor: photoLayers.pill.color, opacity: photoLayers.pill.opacity },
  duration: {
    position: "absolute",
    right: space.xs,
    bottom: space.xs,
    paddingHorizontal: space.xs,
    borderRadius: 6,
    overflow: "hidden",
  },
  durationText: { color: photoLayers.text },
});
