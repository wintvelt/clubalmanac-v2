import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type FlatList,
  Platform,
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
import {
  DetailOverlayHeader,
  DetailStatusBar,
  PhoneDetailLayout,
  useDetailHeaderOptions,
  useDetailPlainOptions,
  usePhoneDetailLayout,
  usePhotoDetailStand,
} from "./DetailStand";
import { PhotoAlbums, PhotoDetailLayout, usePageInView, ZoomablePhoto } from "./PhotoDetailScreen";
import {
  ActionFeedback,
  SharingProgress,
  ActionsButton,
  usePhotoMenu,
  type Feedback,
  type MenuContext,
} from "./PhotoMenu";
import { WebPager } from "../components/WebPager";

// WP17c kernvondst 5: het detail vanuit Mijn foto's. Swipen door je eigen
// foto's, in de volgorde en met de schakelaar van het raster (dezelfde live
// query); aan het eind komt de volgende stap erbij. "Acties": profielfoto,
// draaien, verwijderen (A-invariant 13). Onder de foto de datum, de plaats en
// in welke albums hij staat.
export function MyPhotoDetailScreen() {
  const { photoId, n, los } = useLocalSearchParams<{ photoId: string; n?: string; los?: string }>();
  // WP46: zonder foto's de gewone kop (niet transparent, niet verborgen).
  const plain = useDetailPlainOptions();
  if (useAuthState() === "reconnecting") {
    return (
      <Screen underHeader>
        <Stack.Screen options={plain} />
      </Screen>
    );
  }
  const loaded = Math.max(MY_PHOTOS_STEP, Number(n) || MY_PHOTOS_STEP);
  return (
    <QueryBoundary
      fallback={(_error, reset) => (
        <Screen underHeader>
          <Stack.Screen options={{ ...plain, title: "Foto" }} />
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
  // WP46: de stand (normaal, schermvullend, liggend met of zonder kop).
  const stand = usePhotoDetailStand();
  const headerOptions = useDetailHeaderOptions(stand);
  const phone = usePhoneDetailLayout(stand);
  const [measuredPage, setMeasuredPage] = useState<{ width: number; height: number } | null>(null);
  const page = stand.allowed ? phone.page : measuredPage;
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

  const pager = usePageInView(flatList, index, ids.length, page?.width);

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

  const title = photo ? formatPhotoDate(photo) : "Foto";
  const actions =
    hasActions && menuPhoto ? (
      <ActionsButton onPress={() => menu.open(menuPhoto)} onDark={stand.view.black} />
    ) : undefined;
  const header = (
    <Stack.Screen
      options={{
        title,
        headerRight: actions ? () => actions : undefined,
        ...headerOptions,
      }}
    />
  );
  const feedbackNode = menu.sharing ? (
    <SharingProgress />
  ) : (
    feedback && <ActionFeedback feedback={feedback} onClose={() => setFeedback(null)} />
  );
  const infoNode = infoPhoto && (
    <Animated.View style={swipe.infoStyle}>
      <PhotoInfo photo={infoPhoto} />
    </Animated.View>
  );
  const photos =
    page &&
    shown &&
    (Platform.OS === "web" ? (
      // Webapp-fix 3: op het web één foto tegelijk, zonder horizontale lijst.
      <WebPager
        index={index}
        count={ids.length}
        onChange={showPage}
        photoId={current}
        onNearEnd={list.loadMore}
        photoAt={(i) => {
          const p = shown[i];
          return p && { photoId: p._id, hasFormats: p.hasFormats };
        }}
        renderPage={(i) => {
          const p = shown[i];
          return p ? <ZoomablePhoto key={p._id} photoId={p._id} photo={p} box={page} /> : null;
        }}
      />
    ) : (
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
        // WP46: een veeg die begint, stopt een wachtende enkele tik.
        onScrollBeginDrag={pager.onDragStart}
        onContentSizeChange={pager.onContentSizeChange}
        onEndReached={list.loadMore}
        onEndReachedThreshold={3}
        // WP37: weg-vegen stopt een filmpje.
        // WP46: een andere stand geeft de pagina's een andere maat.
        extraData={`${current}:${page.width}x${page.height}`}
        renderItem={({ item }) => (
          <ZoomablePhoto
            photoId={item._id}
            photo={item}
            box={page}
            active={item._id === current}
            onTap={stand.onTap}
            onFullscreenExit={stand.restoreStatusBar}
          />
        )}
      />
    ));

  // WP46: op de telefoon de standen; op de iPad en het web zoals voorheen.
  if (stand.allowed) {
    return (
      <>
        {header}
        <DetailStatusBar stand={stand} />
        <PhoneDetailLayout
          layout={phone}
          photos={photos}
          info={infoNode}
          feedback={feedbackNode}
          scrollKey={feedback ?? menu.sharing}
          loading={shown === undefined ? <LoadingState label="Foto laden…" /> : undefined}
          header={<DetailOverlayHeader stand={stand} title={title} right={actions} />}
        />
      </>
    );
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={[styles.fill, { backgroundColor: colors.bg }]}>
      {header}
      {shown === undefined ? (
        <LoadingState label="Foto laden…" />
      ) : (
        <PhotoDetailLayout
          onPage={setMeasuredPage}
          scrollKey={feedback ?? menu.sharing}
          photos={photos}
          below={
            <>
              {feedbackNode && <View style={styles.feedback}>{feedbackNode}</View>}
              {infoNode}
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
      <View
        accessible
        accessibilityLabel={`${photo.video ? "Jouw filmpje" : "Jouw foto"}, ${[formatPhotoDate(photo), photo.locationLabel].filter(Boolean).join(", ")}`}
      >
        <Text variant="bodyStrong">{photo.video ? "Jouw filmpje" : "Jouw foto"}</Text>
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
