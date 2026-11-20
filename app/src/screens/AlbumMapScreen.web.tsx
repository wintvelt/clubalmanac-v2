import type { FunctionReturnType } from "convex/server";
import { router, Stack, useLocalSearchParams } from "expo-router";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StyleSheet, View } from "react-native";
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

// WP35 besluit 5: de albumkaart op het web, met OpenStreetMap via Leaflet. De
// web-variant van AlbumMapScreen.tsx (Apple Maps, react-native-maps), met
// dezelfde query, dezelfde volgorde en dezelfde clustering (src/lib/placeShare):
// dezelfde punten als op de iPhone, als miniatuur; dicht bij elkaar één punt
// met een aantal. Een tik op een punt opent het detail met die foto's; "N
// zonder locatie" opent de foto's zonder plek. Alleen bekijken.
//
// Tegels van tile.openstreetmap.org, binnen het gebruiksbeleid: de
// bronvermelding staat zichtbaar met een link, de browser stuurt een Referer
// mee (de hosting zet `strict-origin-when-cross-origin`), en er wordt niets
// vooraf of in bulk geladen. Geen sleutel, geen kosten.

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers';
const MAX_ZOOM = 19;

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

type Pin = { key: string; ids: string[]; marker: L.Marker; element: HTMLElement };

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
  // De volgorde van het raster, zodat bladeren in het detail klopt.
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

  const title = `${photos(placed.length)} uit '${albumName ?? "album"}'`;
  const open = (ids: string[]) => {
    if (ids.length === 0) return;
    const sorted = [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    router.push(photoSubsetPath(groupId, albumId, sorted));
  };
  // De markers houden de laatste `open` vast, niet die van hun eerste render.
  const openRef = useRef(open);
  openRef.current = open;

  // De kaart zelf: één keer, met de foto's in beeld (ruimte voor de
  // miniaturen aan de rand), zoals fitToCoordinates op iOS.
  const container = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const m = L.map(element, { zoomControl: true, attributionControl: true });
    L.tileLayer(TILE_URL, { maxZoom: MAX_ZOOM, attribution: ATTRIBUTION }).addTo(m);
    const start =
      placed.length >= 2
        ? L.latLngBounds(placed.map((s) => [s.latitude, s.longitude] as [number, number]))
        : L.latLngBounds(
            [initial.latitude - initial.latitudeDelta / 2, initial.longitude - initial.longitudeDelta / 2],
            [initial.latitude + initial.latitudeDelta / 2, initial.longitude + initial.longitudeDelta / 2],
          );
    m.fitBounds(start, { padding: [THUMB, THUMB], maxZoom: 17 });
    const report = () => {
      const b = m.getBounds();
      const c = b.getCenter();
      setRegion({
        latitude: c.lat,
        longitude: c.lng,
        latitudeDelta: b.getNorth() - b.getSouth(),
        longitudeDelta: b.getEast() - b.getWest(),
      });
    };
    m.on("moveend", report);
    report();
    // Het vak kan na het eerste beeld nog van maat veranderen (draaien, venster).
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(element);
    setMap(m);
    return () => {
      resize.disconnect();
      m.remove();
      setMap(null);
    };
    // Eén keer per scherm, zoals `initialRegion` op iOS.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Eén marker per cluster; de miniatuur zelf rendert React erin (portal).
  const [pins, setPins] = useState<Pin[]>([]);
  useEffect(() => {
    if (!map) return;
    const made: Pin[] = clusters.map((c) => {
      const ids = c.items.map((s) => s.photoId as string);
      const label = ids.length === 1 ? "1 foto" : `${ids.length} foto's`;
      const marker = L.marker([c.latitude, c.longitude], {
        icon: L.divIcon({
          className: "ca-map-pin",
          html: "",
          iconSize: [PIN, PIN],
          iconAnchor: [PIN / 2, PIN / 2],
        }),
        title: label,
        alt: label,
        keyboard: true,
      }).addTo(map);
      marker.on("click", () => openRef.current(ids));
      return { key: ids.join(","), ids, marker, element: marker.getElement()! };
    });
    setPins(made);
    return () => {
      for (const p of made) p.marker.remove();
    };
  }, [map, clusters]);

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={[styles.fill, { backgroundColor: colors.bg }]}>
      <Stack.Screen options={{ title }} />
      <View style={styles.fill} accessibilityLabel={`Kaart met ${title}`}>
        <div ref={container} style={{ flex: 1, minHeight: 0, width: "100%", position: "relative", zIndex: 0 }} />
      </View>
      {pins.map((p) => {
        const first = byId.get(p.ids[0]!);
        if (!first) return null;
        return createPortal(
          <View
            style={[styles.thumb, { borderColor: colors.surface, backgroundColor: colors.line }]}
            pointerEvents="none"
          >
            <PhotoImage
              photoId={first.albumPhoto.photoId}
              format="klein"
              exifOrientation={first.photo.exifOrientation}
              hasFormats={first.photo.hasFormats}
              box={{ width: THUMB, height: THUMB }}
              radius={6}
            />
            {p.ids.length > 1 ? (
              <View style={[styles.badge, { backgroundColor: colors.cta }]}>
                <Text variant="albumMeta" color="onCta" maxFontSizeMultiplier={1.2}>
                  {p.ids.length}
                </Text>
              </View>
            ) : null}
          </View>,
          p.element,
          p.key,
        );
      })}
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
const PIN = THUMB + 6;

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
  thumb: { width: PIN, height: PIN, borderRadius: 9, borderWidth: 3, cursor: "pointer" },
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
