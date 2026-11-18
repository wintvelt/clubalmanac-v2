import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type FlatList,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSwipeInfo } from "../components/Motion";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useAuthState } from "../data/authStateContext";
import { useSharePhoto } from "../data/share";
import { useLiveQuery } from "../data/useLiveQuery";
import { formatPhotoDate, nextAfterRemoval } from "../lib/photos";
import { size, space, useTheme } from "../theme";
import { LoadError } from "./GroupParts";
import { MY_PHOTOS_STEP, menuPhotoOf, useMyPhotos, type MyPhoto } from "./MyPhotosScreen";
import { PhotoAlbums, PhotoDetailLayout, ZoomablePhoto } from "./PhotoDetailScreen";
import {
  ActionFeedback,
  SharingProgress,
  ActionsButton,
  usePhotoMenu,
  type Feedback,
  type MenuContext,
} from "./PhotoMenu";

// WP17c kernvondst 5: het detail vanuit Mijn foto's. Swipen door je eigen
// foto's, in de volgorde en met de schakelaar van het raster (dezelfde live
// query); aan het eind komt de volgende stap erbij. "Acties": profielfoto,
// draaien, verwijderen (A-invariant 13). Onder de foto de datum, de plaats en
// in welke albums hij staat.
export function MyPhotoDetailScreen() {
  const { photoId, n, los } = useLocalSearchParams<{ photoId: string; n?: string; los?: string }>();
  if (useAuthState() === "reconnecting") return <Screen underHeader>{null}</Screen>;
  const loaded = Math.max(MY_PHOTOS_STEP, Number(n) || MY_PHOTOS_STEP);
  return (
    <QueryBoundary
      fallback={(_error, reset) => (
        <Screen underHeader>
          <Stack.Screen options={{ title: "Foto" }} />
          <LoadError title="Deze foto laden lukt niet" onRetry={reset} />
        </Screen>
      )}
    >
      <DetailContent initialPhotoId={String(photoId)} withoutAlbum={los === "1"} loaded={loaded} />
    </QueryBoundary>
  );
}

function DetailContent({
  initialPhotoId,
  withoutAlbum,
  loaded,
}: {
  initialPhotoId: string;
  withoutAlbum: boolean;
  loaded: number;
}) {
  const { colors } = useTheme();
  const list = useMyPhotos(withoutAlbum, loaded);
  const shown = list.photos;
  const me = useLiveQuery(api.users.profile, {});
  const ctx = useMemo<MenuContext | undefined>(() => (me ? { me: me._id, role: "member" } : undefined), [me]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const ids = useMemo<string[]>(() => shown?.map((p) => p._id) ?? [], [shown]);
  const [current, setCurrent] = useState(initialPhotoId);
  const [page, setPage] = useState<{ width: number; height: number } | null>(null);
  const flatList = useRef<FlatList<MyPhoto>>(null);
  const previousIds = useRef<string[] | null>(null);

  // De foto in beeld verdwijnt (verwijderd, of met de schakelaar in een
  // album gezet): de volgende, of terug naar het raster.
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

  const index = Math.max(0, ids.indexOf(current));
  const photo = shown?.[index];
  const menu = usePhotoMenu({ place: null, ctx, photoIds: ids, onFeedback: setFeedback , sharePhoto: useSharePhoto() });
  const menuPhoto = photo ? menuPhotoOf(photo) : undefined;
  const hasActions = menu.hasActions(menuPhoto);
  // WP33 invariant 7, C5: het informatieblok vervaagt mee met de swipe.
  const swipe = useSwipeInfo(index, ids.length, page?.width ?? 0);
  const infoPhoto = shown?.[swipe.infoIndex] ?? photo;

  useEffect(() => {
    if (page && shown && shown.length > 0) flatList.current?.scrollToIndex({ index, animated: false });
  }, [index, page?.width]); // eslint-disable-line react-hooks/exhaustive-deps

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
          title: photo ? formatPhotoDate(photo) : "Foto",
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
              <Animated.FlatList
                ref={flatList}
                data={shown}
                onScroll={swipe.onScroll}
                scrollEventThrottle={16}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={(p) => p._id}
                getItemLayout={(_, i) => ({ length: page.width, offset: page.width * i, index: i })}
                initialScrollIndex={index}
                initialNumToRender={1}
                windowSize={3}
                maxToRenderPerBatch={2}
                onMomentumScrollEnd={onMomentumEnd}
                onEndReached={list.loadMore}
                onEndReachedThreshold={3}
                renderItem={({ item }) => <ZoomablePhoto photoId={item._id} photo={item} box={page} />}
              />
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
              {infoPhoto && (
                <Animated.View style={swipe.infoStyle}>
                  <PhotoInfo photo={infoPhoto} />
                </Animated.View>
              )}
            </>
          }
        />
      )}
    </SafeAreaView>
  );
}

// Datum en plaats, en in welke albums (geen eigenaar: het is jouw foto).
function PhotoInfo({ photo }: { photo: MyPhoto }) {
  const meta = [formatPhotoDate(photo), photo.locationLabel].filter(Boolean).join(" · ");
  return (
    <View style={styles.info}>
      <View accessible accessibilityLabel={`Jouw foto, ${[formatPhotoDate(photo), photo.locationLabel].filter(Boolean).join(", ")}`}>
        <Text variant="bodyStrong">Jouw foto</Text>
        <Text variant="albumMeta" color="muted">
          {meta}
        </Text>
      </View>
      <PhotoAlbums photoId={photo._id} inset={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  info: {
    gap: space.s,
    paddingHorizontal: size.screenMargin,
    paddingVertical: space.m,
  },
  feedback: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
    paddingTop: space.m,
  },
});
