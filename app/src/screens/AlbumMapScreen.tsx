import type { FunctionReturnType } from "convex/server";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, type Region as MapRegion } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Id } from "../../../convex/_generated/dataModel";
import { Notice } from "../components/Notice";
import { PhotoImage } from "../components/Photo";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { SmallButton } from "../components/SmallButton";
import { LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useAuthState } from "../data/authStateContext";
import { useLiveQuery } from "../data/useLiveQuery";
import { photoSubsetPath } from "../lib/groupRoutes";
import { sortAlbumPhotos } from "../lib/photos";
import { clusterSpots, MIDDLE_NL, mapRegion, type Region } from "../lib/placeShare";
import { size, space, useTheme } from "../theme";
import { AlbumReadFailed } from "./AlbumParts";

type Entry = FunctionReturnType<typeof api.albums.listPhotos>[number];
type Spot = FunctionReturnType<typeof api.albums.listLocations>[number];

// WP17d: de kaart van een album (pariteit v1). Apple Maps, de foto's als
// miniatuur-speld; dicht bij elkaar één speld met een aantal. De kaart past
// zich aan de foto's aan. Een tik op een speld opent het detail, swipen door
// die foto's. "N zonder locatie" opent de foto's zonder plek. De plekken komen
// uit albums.listLocations (alleen voor wie het album ziet, besluit 1: exact).
// Geen locatie van het toestel (A-invariant 7). Live: een plek die verandert of
// weggaat, verschuift of verdwijnt hier ook.
export function AlbumMapScreen() {
  const { groupId, albumId } = useLocalSearchParams<{ groupId: string; albumId: string }>();
  const gid = String(groupId) as Id<"groups">;
  const aid = String(albumId) as Id<"albums">;
  if (useAuthState() === "reconnecting") return <Screen underHeader>{null}</Screen>;
  return (
    <QueryBoundary
      key={aid}
      fallback={(error, reset) => (
        <Screen underHeader>
          <AlbumReadFailed groupId={gid} what="album" error={error} reset={reset} />
        </Screen>
      )}
    >
      <MapContent groupId={gid} albumId={aid} />
    </QueryBoundary>
  );
}

function photos(n: number): string {
  return n === 1 ? "1 foto" : `${n} foto's`;
}

function MapContent({ groupId, albumId }: { groupId: Id<"groups">; albumId: Id<"albums"> }) {
  const album = useLiveQuery(api.albums.getWithCover, { albumId });
  const spots = useLiveQuery(api.albums.listLocations, { albumId });
  const entries = useLiveQuery(api.albums.listPhotos, { albumId });
  if (spots === undefined || entries === undefined) {
    return (
      <>
        <Stack.Screen options={{ title: "Kaart" }} />
        <LoadingState label="Kaart laden…" />
      </>
    );
  }
  return <AlbumMap groupId={groupId} albumId={albumId} albumName={album?.name} spots={spots} entries={entries} />;
}

function AlbumMap({
  groupId,
  albumId,
  albumName,
  spots,
  entries,
}: {
  groupId: Id<"groups">;
  albumId: Id<"albums">;
  albumName: string | undefined;
  spots: Spot[];
  entries: Entry[];
}) {
  const { colors } = useTheme();
  // De volgorde van het raster, zodat swipen in het detail klopt.
  const ordered = useMemo(
    () => sortAlbumPhotos(entries).filter((e): e is Entry & { photo: NonNullable<Entry["photo"]> } => e.photo !== null),
    [entries],
  );
  const byId = useMemo(() => new Map(ordered.map((e) => [e.albumPhoto.photoId as string, e])), [ordered]);
  const placed = useMemo(() => spots.filter((s) => byId.has(s.photoId)), [spots, byId]);
  const unplaced = useMemo(() => {
    const has = new Set(placed.map((s) => s.photoId as string));
    return ordered.filter((e) => !has.has(e.albumPhoto.photoId)).map((e) => e.albumPhoto.photoId as string);
  }, [ordered, placed]);
  const [initial] = useState<Region>(() => mapRegion(placed) ?? MIDDLE_NL);
  const [region, setRegion] = useState<Region>(initial);
  const clusters = useMemo(() => clusterSpots(placed, region), [placed, region]);
  const order = useMemo(() => new Map(ordered.map((e, i) => [e.albumPhoto.photoId as string, i])), [ordered]);

  // De kaart past zich aan de foto's aan, met ruimte voor de miniaturen aan de rand.
  const map = useRef<MapView>(null);
  const fit = () => {
    if (placed.length < 2) return;
    map.current?.fitToCoordinates(
      placed.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
      { edgePadding: EDGE, animated: false },
    );
  };

  const title = `${photos(placed.length)} uit '${albumName ?? "album"}'`;
  const open = (ids: string[]) => {
    if (ids.length === 0) return;
    const sorted = [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    router.push(photoSubsetPath(groupId, albumId, sorted));
  };

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={[styles.fill, { backgroundColor: colors.bg }]}>
      <Stack.Screen options={{ title }} />
      <MapView
        ref={map}
        style={styles.fill}
        initialRegion={initial}
        onMapReady={fit}
        onRegionChangeComplete={(r: MapRegion) => setRegion(r)}
        showsPointsOfInterests={false}
        accessibilityLabel={`Kaart met ${title}`}
      >
        {clusters.map((c) => {
          const first = byId.get(c.items[0]!.photoId)!;
          const ids = c.items.map((s) => s.photoId as string);
          return (
            <Marker
              key={ids.join(",")}
              coordinate={{ latitude: c.latitude, longitude: c.longitude }}
              onPress={() => open(ids)}
              tracksViewChanges
              accessibilityLabel={ids.length === 1 ? "1 foto" : `${ids.length} foto's`}
            >
              <View style={[styles.thumb, { borderColor: colors.surface, backgroundColor: colors.line }]}>
                <PhotoImage
                  photoId={first.albumPhoto.photoId}
                  format="klein"
                  exifOrientation={first.photo.exifOrientation}
                  hasFormats={first.photo.hasFormats}
                  box={{ width: THUMB, height: THUMB }}
                  radius={6}
                />
                {ids.length > 1 ? (
                  <View style={[styles.badge, { backgroundColor: colors.cta }]}>
                    <Text variant="albumMeta" color="onCta" maxFontSizeMultiplier={1.2}>
                      {ids.length}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Marker>
          );
        })}
      </MapView>
      {placed.length === 0 || unplaced.length > 0 ? (
        <View style={[styles.panel, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
          <View style={styles.column}>
            {placed.length === 0 ? (
              <Notice kind="error" title="Geen locaties" message="Geen van de foto's in dit album heeft een locatie." />
            ) : null}
            {unplaced.length > 0 ? (
              <SmallButton title={`${photos(unplaced.length)} zonder locatie`} icon="photos" onPress={() => open(unplaced)} />
            ) : null}
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const THUMB = 48;
const EDGE = { top: THUMB + 24, right: THUMB, bottom: THUMB, left: THUMB };

const styles = StyleSheet.create({
  fill: { flex: 1 },
  panel: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: space.m },
  column: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
    gap: space.m,
  },
  thumb: { width: THUMB + 6, height: THUMB + 6, borderRadius: 9, borderWidth: 3 },
  badge: {
    position: "absolute",
    top: -10,
    right: -10,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
});
