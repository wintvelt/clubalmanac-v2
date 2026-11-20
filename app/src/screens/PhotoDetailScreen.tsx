import type { FunctionReturnType } from "convex/server";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  type FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSwipeInfo } from "../components/Motion";
import { PhotoImage, ProfileAvatar } from "../components/Photo";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useAuthState } from "../data/authStateContext";
import { useSharePhoto } from "../data/share";
import { useLiveQuery } from "../data/useLiveQuery";
import { photoAlbumLines } from "../lib/myPhotos";
import { formatPhotoDate, nextAfterRemoval, sortAlbumPhotos } from "../lib/photos";
import { size, space, useTheme } from "../theme";
import { AlbumReadFailed } from "./AlbumParts";
import {
  ActionFeedback,
  SharingProgress,
  ActionsButton,
  useMenuContext,
  usePhotoMenu,
  type Feedback,
  type MenuPhoto,
} from "./PhotoMenu";
import { WebPager } from "../components/WebPager";

type Entry = FunctionReturnType<typeof api.albums.listPhotos>[number];
type Shown = Entry & { photo: NonNullable<Entry["photo"]> };

// WP17a: Foto-detail. Swipen door hetzelfde album, in de volgorde van het
// raster; knijpen of dubbeltikken om te zoomen (tot 3×). Onder de foto de
// eigenaar, de datum en de plaats. Alleen de foto in beeld en zijn buren
// worden geladen. De lijst is dezelfde live query als het album, dus een foto
// die verdwijnt, verdwijnt hier ook (edge cases); geen toegang meer geeft
// NOT_MEMBER (invariant 7).
//
// WP17b: rechtsboven "Acties" met wat de user op deze foto mag (invariant 1
// en 10). De melding na een actie staat onder de foto. Na verwijderen of uit
// het album halen gaat het detail naar de volgende foto (zie hierboven).
export function PhotoDetailScreen() {
  const { groupId, albumId, photoId, ids } = useLocalSearchParams<{
    groupId: string;
    albumId: string;
    photoId: string;
    ids?: string;
  }>();
  const gid = String(groupId) as Id<"groups">;
  const aid = String(albumId) as Id<"albums">;
  if (useAuthState() === "reconnecting") return <Screen underHeader>{null}</Screen>;
  return (
    <QueryBoundary
      key={aid}
      fallback={(error, reset) => (
        <Screen underHeader>
          <AlbumReadFailed groupId={gid} what="foto" error={error} reset={reset} />
        </Screen>
      )}
    >
      <DetailContent groupId={gid} albumId={aid} initialPhotoId={String(photoId)} subset={ids} />
    </QueryBoundary>
  );
}

// WP17d: `subset` (komma-gescheiden foto-ids, van een speld op de kaart of
// "zonder locatie"): swipen alleen door die foto's.
function DetailContent({
  groupId,
  albumId,
  initialPhotoId,
  subset,
}: {
  groupId: Id<"groups">;
  albumId: Id<"albums">;
  initialPhotoId: string;
  subset?: string;
}) {
  const { colors } = useTheme();
  const entries = useLiveQuery(api.albums.listPhotos, { albumId });
  const me = useLiveQuery(api.users.profile, {});
  const ctx = useMenuContext(groupId, me?._id);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const only = useMemo(() => (subset ? new Set(subset.split(",").filter(Boolean)) : null), [subset]);
  const shown = useMemo(() => {
    if (!entries) return undefined;
    const sorted = sortAlbumPhotos(entries);
    return only ? sorted.filter((e) => only.has(e.albumPhoto.photoId)) : sorted;
  }, [entries, only]);
  const ids = useMemo<string[]>(() => shown?.map((e) => e.albumPhoto.photoId) ?? [], [shown]);
  const [current, setCurrent] = useState(initialPhotoId);
  const [page, setPage] = useState<{ width: number; height: number } | null>(null);
  const list = useRef<FlatList<Shown>>(null);
  const previousIds = useRef<string[] | null>(null);

  // De foto in beeld verdwijnt: de volgende, of terug naar het album.
  useEffect(() => {
    if (shown === undefined) return;
    const before = previousIds.current ?? ids;
    previousIds.current = ids;
    const next = nextAfterRemoval(before, ids, current);
    if (next === null) {
      if (router.canGoBack()) router.back();
      return;
    }
    if (next !== current) setCurrent(next);
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps

  const index = Math.max(0, (ids as string[]).indexOf(current));
  const entry = shown?.[index];
  const place = useMemo(() => ({ groupId, albumId }), [groupId, albumId]);
  const menu = usePhotoMenu({ place, ctx, photoIds: ids, onFeedback: setFeedback , sharePhoto: useSharePhoto() });
  const menuPhoto: MenuPhoto | undefined = entry && {
    photoId: entry.albumPhoto.photoId,
    ownerId: entry.photo.ownerId,
    addedBy: entry.albumPhoto.addedBy,
    ownerName: entry.owner?.name,
    hasFormats: entry.photo.hasFormats,
    exifOrientation: entry.photo.exifOrientation,
  };
  const hasActions = menu.hasActions(menuPhoto);
  // WP33 invariant 7: het informatieblok vervaagt mee met de swipe en toont
  // de gegevens van de foto die het dichtst bij is (C1–C3).
  const swipe = useSwipeInfo(index, ids.length, page?.width ?? 0);
  const infoEntry = shown?.[swipe.infoIndex] ?? entry;

  useEffect(() => {
    if (page && shown && shown.length > 0) list.current?.scrollToIndex({ index, animated: false });
  }, [index, page?.width]); // eslint-disable-line react-hooks/exhaustive-deps

  const showPage = (i: number) => {
    const id = ids[i];
    if (id && id !== current) {
      setCurrent(id);
      setFeedback(null);
    }
  };
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!page) return;
    showPage(Math.round(e.nativeEvent.contentOffset.x / page.width));
  };

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={[styles.fill, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          title: entry ? formatPhotoDate(entry.photo) : "Foto",
          headerRight: hasActions && menuPhoto ? () => <ActionsButton onPress={() => menu.open(menuPhoto)} /> : undefined,
        }}
      />
      {shown === undefined ? (
        <LoadingState label="Foto laden…" />
      ) : (
        <PhotoDetailLayout
          onPage={setPage}
          scrollKey={feedback ?? menu.sharing}
          photos={
            page && (
              <>
              <Animated.FlatList
                ref={list}
                data={shown}
                onScroll={swipe.onScroll}
                scrollEventThrottle={16}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={(e) => e.albumPhoto._id}
                getItemLayout={(_, i) => ({ length: page.width, offset: page.width * i, index: i })}
                initialScrollIndex={index}
                initialNumToRender={1}
                windowSize={3}
                maxToRenderPerBatch={2}
                onMomentumScrollEnd={onMomentumEnd}
                renderItem={({ item }) => <ZoomablePhoto photoId={item.albumPhoto.photoId} photo={item.photo} box={page} />}
              />
              {/* WP35: op het web bladeren met knoppen en pijltjes; op iOS niets. */}
              <WebPager list={list} index={index} count={ids.length} pageWidth={page.width} onSettle={showPage} />
              </>
            )
          }
          below={
            <>
              {menu.sharing ? (
                <View style={styles.feedback}>
                  <SharingProgress />
                </View>
              ) : (
                feedback && (
                  <View style={styles.feedback}>
                    <ActionFeedback feedback={feedback} onClose={() => setFeedback(null)} />
                  </View>
                )
              )}
              {infoEntry && (
                <Animated.View style={swipe.infoStyle}>
                  <PhotoInfo entry={infoEntry} />
                </Animated.View>
              )}
            </>
          }
        />
      )}
    </SafeAreaView>
  );
}

// WP32 invariant 9 en 10, B1–B3: het fotogebied heeft een vaste maat, die
// alleen meeverandert met de venstermaat en de tekstgrootte. Eronder een eigen
// scrollgebied voor de melding na een actie en het informatieblok: hoe hoog
// dat ook wordt (albumregels die later laden, een plaats over twee regels,
// grote tekst), de foto verspringt niet en er valt niets weg.
// WP17c: ook voor het detail in Mijn foto's.
export function photoInfoHeight(areaHeight: number, fontScale: number): number {
  return Math.round(Math.min(areaHeight * 0.5, Math.max(areaHeight * 0.22, INFO_BASE_HEIGHT * fontScale)));
}

// Avatar, naam, datum · plaats en één albumregel bij de gewone tekstgrootte.
const INFO_BASE_HEIGHT = 150;

export function PhotoDetailLayout({
  photos,
  below,
  onPage,
  scrollKey,
}: {
  photos: ReactNode;
  below: ReactNode;
  // De maat van het fotogebied, voor de pagina's van de lijst.
  onPage: (page: { width: number; height: number }) => void;
  // Verandert dit (een nieuwe melding), dan scrolt het blok naar boven.
  scrollKey?: unknown;
}) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const infoScroll = useRef<ScrollViewInstance>(null);
  const infoHeight = area ? photoInfoHeight(area.height, fontScale) : 0;
  const box = area ? { width: area.width, height: Math.max(0, area.height - infoHeight) } : null;

  useEffect(() => {
    if (box) onPage(box);
  }, [box?.width, box?.height]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    infoScroll.current?.scrollTo({ y: 0, animated: true });
  }, [scrollKey]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!area || area.width !== width || area.height !== height) setArea({ width, height });
  };

  return (
    <View style={styles.fill} onLayout={onLayout}>
      {box && (
        <>
          <View style={box}>{photos}</View>
          <ScrollView
            ref={infoScroll}
            style={[{ height: infoHeight, borderTopColor: colors.line }, styles.infoScroll]}
            contentContainerStyle={styles.infoScrollContent}
          >
            {below}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const MAX_ZOOM = 3;
const DOUBLE_TAP_MS = 280;

type ZoomPhoto = Shown["photo"];

// Knijpen zoomt (iOS-ScrollView), dubbeltikken wisselt tussen 1× en 2,5×.
// WP17c: ook voor het detail in Mijn foto's.
export function ZoomablePhoto({
  photoId,
  photo,
  box,
}: {
  photoId: Id<"photos">;
  photo: ZoomPhoto;
  box: { width: number; height: number };
}) {
  const [zoom, setZoom] = useState(1);
  const lastTap = useRef(0);
  const onPress = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      setZoom((z) => (z > 1.01 ? 1 : 2.5));
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  };
  return (
    <ScrollView
      style={box}
      contentContainerStyle={box}
      maximumZoomScale={MAX_ZOOM}
      minimumZoomScale={1}
      zoomScale={zoom}
      centerContent
      bouncesZoom
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={64}
      onScrollEndDrag={(e) => setZoom(e.nativeEvent.zoomScale ?? 1)}
      onMomentumScrollEnd={(e) => setZoom(e.nativeEvent.zoomScale ?? 1)}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="image"
        accessibilityLabel={`Foto van ${formatPhotoDate(photo)}`}
        accessibilityHint="Dubbeltik om in of uit te zoomen"
      >
        <PhotoImage
          photoId={photoId}
          format="groot"
          exifOrientation={photo.exifOrientation}
          hasFormats={photo.hasFormats}
          box={box}
          fit="contain"
          neutralLoading
        />
      </Pressable>
    </ScrollView>
  );
}

// Eigenaar (avatar via het beeldpad, anders de letter), datum en plaats.
function PhotoInfo({ entry }: { entry: Shown }) {
  const name = entry.owner?.name ?? null;
  const date = formatPhotoDate(entry.photo);
  return (
    <View style={styles.infoBlock}>
    <View
      style={styles.info}
      accessible
      accessibilityLabel={[name ? `Foto van ${name}` : null, date, entry.photo.locationLabel].filter(Boolean).join(", ")}
    >
      <ProfileAvatar
        userId={entry.owner?._id}
        name={name}
        size={size.avatar}
        exifOrientation={entry.owner?.profileOrientation}
        version={entry.owner?.profileVersion}
        hasFormats={entry.owner?.profileHasFormats}
      />
      <View style={styles.infoText}>
        <Text variant="bodyStrong" color={name ? "text" : "muted"}>
          {name ?? "Naam onbekend"}
        </Text>
        <Text variant="albumMeta" color="muted">
          {[date, entry.photo.locationLabel].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </View>
    <PhotoAlbums photoId={entry.albumPhoto.photoId} />
    </View>
  );
}

// WP17c invariant 4, open vraag 3: bij elke foto in welke albums hij staat,
// alleen albums uit je eigen groepen; staand, niet aantikbaar. Geen albums:
// niets. Een eigen grens: verdwijnt de foto of de toegang, dan valt alleen
// deze regel weg, niet het detail.
export function PhotoAlbums({ photoId, inset = true }: { photoId: Id<"photos">; inset?: boolean }) {
  return (
    <QueryBoundary key={photoId} fallback={() => null}>
      <PhotoAlbumsContent photoId={photoId} inset={inset} />
    </QueryBoundary>
  );
}

function PhotoAlbumsContent({ photoId, inset }: { photoId: Id<"photos">; inset: boolean }) {
  const list = useLiveQuery(api.albums.listForPhoto, { photoId });
  const lines = useMemo(() => (list ? photoAlbumLines(list) : []), [list]);
  if (lines.length === 0) return null;
  return (
    <View
      style={[styles.albums, inset && styles.albumsInset]}
      accessible
      accessibilityLabel={`In ${lines.length === 1 ? "album" : "albums"}: ${lines.join(", ")}`}
    >
      <Text variant="albumMeta" color="muted">
        {lines.length === 1 ? "In album:" : "In albums:"}
      </Text>
      {lines.map((line) => (
        <Text key={line} variant="albumMeta">
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  infoScroll: { flexGrow: 0, flexShrink: 0, borderTopWidth: StyleSheet.hairlineWidth },
  infoScrollContent: { paddingBottom: space.m },
  infoBlock: { paddingVertical: space.m, gap: space.s },
  info: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: size.screenMargin,
  },
  albums: { gap: space.xs / 2 },
  albumsInset: { paddingHorizontal: size.screenMargin },
  infoText: { flex: 1, gap: space.xs },
  feedback: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
    paddingTop: space.m,
  },
});
