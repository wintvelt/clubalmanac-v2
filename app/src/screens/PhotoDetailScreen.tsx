import type { FunctionReturnType } from "convex/server";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Id } from "../../../convex/_generated/dataModel";
import { PhotoImage, ProfileAvatar } from "../components/Photo";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useAuthState } from "../data/authStateContext";
import { useLiveQuery } from "../data/useLiveQuery";
import { formatPhotoDate, nextAfterRemoval, sortAlbumPhotos } from "../lib/photos";
import { size, space, useTheme } from "../theme";
import { AlbumReadFailed } from "./AlbumParts";
import {
  ActionFeedback,
  ActionsButton,
  menuActions,
  useMenuContext,
  usePhotoMenu,
  type Feedback,
  type MenuPhoto,
} from "./PhotoMenu";

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
  const { groupId, albumId, photoId } = useLocalSearchParams<{
    groupId: string;
    albumId: string;
    photoId: string;
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
      <DetailContent groupId={gid} albumId={aid} initialPhotoId={String(photoId)} />
    </QueryBoundary>
  );
}

function DetailContent({
  groupId,
  albumId,
  initialPhotoId,
}: {
  groupId: Id<"groups">;
  albumId: Id<"albums">;
  initialPhotoId: string;
}) {
  const { colors } = useTheme();
  const entries = useLiveQuery(api.albums.listPhotos, { albumId });
  const album = useLiveQuery(api.albums.getWithCover, { albumId });
  const me = useLiveQuery(api.users.profile, {});
  const ctx = useMenuContext(groupId, album?.createdBy, me?._id);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const shown = useMemo(() => (entries ? sortAlbumPhotos(entries) : undefined), [entries]);
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
  const menu = usePhotoMenu({ groupId, albumId, ctx, photoIds: ids, onFeedback: setFeedback });
  const menuPhoto: MenuPhoto | undefined = entry && {
    photoId: entry.albumPhoto.photoId,
    ownerId: entry.photo.ownerId,
    addedBy: entry.albumPhoto.addedBy,
  };
  const hasActions = menuActions(ctx, menuPhoto).length > 0;

  useEffect(() => {
    if (page && shown && shown.length > 0) list.current?.scrollToIndex({ index, animated: false });
  }, [index, page?.width]); // eslint-disable-line react-hooks/exhaustive-deps

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!page || page.width !== width || page.height !== height) setPage({ width, height });
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!page) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / page.width);
    const id = ids[i];
    if (id && id !== current) {
      setCurrent(id);
      setFeedback(null);
    }
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
        <>
          <View style={styles.fill} onLayout={onLayout}>
            {page && (
              <FlatList
                ref={list}
                data={shown}
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
                renderItem={({ item }) => <ZoomablePhoto entry={item} box={page} />}
              />
            )}
          </View>
          {feedback && (
            <View style={styles.feedback}>
              <ActionFeedback feedback={feedback} onClose={() => setFeedback(null)} />
            </View>
          )}
          {entry && <PhotoInfo entry={entry} />}
        </>
      )}
    </SafeAreaView>
  );
}

const MAX_ZOOM = 3;
const DOUBLE_TAP_MS = 280;

// Knijpen zoomt (iOS-ScrollView), dubbeltikken wisselt tussen 1× en 2,5×.
function ZoomablePhoto({ entry, box }: { entry: Shown; box: { width: number; height: number } }) {
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
        accessibilityLabel={`Foto van ${formatPhotoDate(entry.photo)}`}
        accessibilityHint="Dubbeltik om in of uit te zoomen"
      >
        <PhotoImage
          photoId={entry.albumPhoto.photoId}
          format="groot"
          exifOrientation={entry.photo.exifOrientation}
          hasFormats={entry.photo.hasFormats}
          box={box}
          fit="contain"
        />
      </Pressable>
    </ScrollView>
  );
}

// Eigenaar (avatar via het beeldpad, anders de letter), datum en plaats.
function PhotoInfo({ entry }: { entry: Shown }) {
  const { colors } = useTheme();
  const name = entry.owner?.name ?? null;
  const date = formatPhotoDate(entry.photo);
  return (
    <View
      style={[styles.info, { borderTopColor: colors.line }]}
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
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  info: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: size.screenMargin,
    paddingVertical: space.m,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  infoText: { flex: 1, gap: space.xs },
  feedback: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
    paddingTop: space.m,
  },
});
