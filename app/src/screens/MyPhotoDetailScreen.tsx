import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import { PhotoAlbums, ZoomablePhoto } from "./PhotoDetailScreen";
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

  useEffect(() => {
    if (page && shown && shown.length > 0) flatList.current?.scrollToIndex({ index, animated: false });
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
          title: photo ? formatPhotoDate(photo) : "Foto",
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
                ref={flatList}
                data={shown}
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
            )}
          </View>
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
          {photo && <PhotoInfo photo={photo} />}
        </>
      )}
    </SafeAreaView>
  );
}

// Datum en plaats, en in welke albums (geen eigenaar: het is jouw foto).
function PhotoInfo({ photo }: { photo: MyPhoto }) {
  const { colors } = useTheme();
  const meta = [formatPhotoDate(photo), photo.locationLabel].filter(Boolean).join(" · ");
  return (
    <View style={[styles.info, { borderTopColor: colors.line }]}>
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
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  feedback: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
    paddingTop: space.m,
  },
});
