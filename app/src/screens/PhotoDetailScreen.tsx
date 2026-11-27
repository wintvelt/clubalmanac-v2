import type { FunctionReturnType } from "convex/server";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  type FlatList,
  Platform,
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
import { VideoPage } from "../components/VideoPlayer";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useAuthState } from "../data/authStateContext";
import { useSharePhoto } from "../data/share";
import { useLiveQuery } from "../data/useLiveQuery";
import { photoAlbumLines } from "../lib/myPhotos";
import { DOUBLE_TAP_MS, tapIntent } from "../lib/photoDetailStand";
import { formatPhotoDate, nextAfterRemoval, sortAlbumPhotos } from "../lib/photos";
import { size, space, useTheme } from "../theme";
import { AlbumReadFailed } from "./AlbumParts";
import {
  DetailOverlayHeader,
  DetailStatusBar,
  PhoneDetailLayout,
  photoInfoHeight,
  useDetailHeaderOptions,
  useDetailPlainOptions,
  usePhoneDetailLayout,
  usePhotoDetailStand,
} from "./DetailStand";
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
  // WP46: zonder foto's de gewone kop (niet transparent, niet verborgen).
  const plain = useDetailPlainOptions();
  if (useAuthState() === "reconnecting") {
    return (
      <Screen underHeader>
        <Stack.Screen options={plain} />
      </Screen>
    );
  }
  return (
    <QueryBoundary
      key={aid}
      fallback={(error, reset) => (
        <Screen underHeader>
          <Stack.Screen options={plain} />
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
  // WP46: de stand (normaal, schermvullend, liggend met of zonder kop).
  const stand = usePhotoDetailStand();
  const headerOptions = useDetailHeaderOptions(stand);
  const phone = usePhoneDetailLayout(stand);
  const [measuredPage, setMeasuredPage] = useState<{ width: number; height: number } | null>(null);
  const page = stand.allowed ? phone.page : measuredPage;
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
    isVideo: entry.photo.video !== undefined,
  };
  const hasActions = menu.hasActions(menuPhoto);
  // WP33 invariant 7: het informatieblok vervaagt mee met de swipe en toont
  // de gegevens van de foto die het dichtst bij is (C1–C3).
  const swipe = useSwipeInfo(index, ids.length, page?.width ?? 0);
  const infoEntry = shown?.[swipe.infoIndex] ?? entry;

  const pager = usePageInView(list, index, ids.length, page?.width);

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

  const title = entry ? formatPhotoDate(entry.photo) : "Foto";
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
  const infoNode = infoEntry && (
    <Animated.View style={swipe.infoStyle}>
      <PhotoInfo entry={infoEntry} />
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
        photoAt={(i) => {
          const e = shown[i];
          return e && { photoId: e.albumPhoto.photoId, hasFormats: e.photo.hasFormats };
        }}
        renderPage={(i) => {
          const e = shown[i];
          return e ? (
            <ZoomablePhoto key={e.albumPhoto._id} photoId={e.albumPhoto.photoId} photo={e.photo} box={page} />
          ) : null;
        }}
      />
    ) : (
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
        // WP46: een veeg die begint, stopt een wachtende enkele tik.
        onScrollBeginDrag={pager.onDragStart}
        onContentSizeChange={pager.onContentSizeChange}
        // WP37: weg-vegen stopt een filmpje (alleen de pagina in beeld speelt).
        // WP46: een andere stand geeft de pagina's een andere maat.
        extraData={`${current}:${page.width}x${page.height}`}
        renderItem={({ item }) => (
          <ZoomablePhoto
            photoId={item.albumPhoto.photoId}
            photo={item.photo}
            box={page}
            active={item.albumPhoto.photoId === current}
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

/**
 * De foto in beeld blijft in beeld als de pagina's een andere breedte krijgen
 * (draaien, een andere stand) en als de lijst naar een andere foto moet
 * (verwijderd, verdwenen). Geeft de handlers voor de horizontale lijst.
 *
 * WP46 fix-cyclus 2 (A-invariant 7): op Android voert de lijst een scroll uit
 * vóór hij de nieuwe maat van zijn inhoud heeft. Na draaien naar liggend werd
 * de scroll dan afgekapt op de oude, smallere inhoud, en stond er bij een
 * foto verder in de lijst een andere foto in beeld (en werd die bij vegen de
 * huidige). Daarom na een nieuwe breedte nog eens zodra de lijst zijn nieuwe
 * inhoud meldt, en een beeld later, tot de user zelf veegt. Elke scroll gaat
 * naar dezelfde plek; staat de lijst er al, dan verandert er niets (iOS).
 */
export function usePageInView<T>(
  list: RefObject<FlatList<T> | null>,
  index: number,
  count: number,
  pageWidth: number | undefined,
) {
  const live = useRef({ index, count, pageWidth });
  live.current = { index, count, pageWidth };
  // Na een nieuwe breedte: nog niet zeker dat de lijst op de foto staat. Al in
  // de render gezet, zodat ook een melding van de lijst vóór het effect telt.
  const realign = useRef(false);
  const widthSeen = useRef<number | undefined>(undefined);
  if (widthSeen.current !== pageWidth) {
    widthSeen.current = pageWidth;
    if (pageWidth) realign.current = true;
  }
  const frames = useRef<number[]>([]);

  const scrollToCurrent = useCallback(() => {
    const now = live.current;
    if (!now.pageWidth || now.count === 0 || now.index >= now.count) return;
    list.current?.scrollToIndex({ index: now.index, animated: false });
  }, [list]);
  // Nog `times` beelden achter elkaar, zolang de user niet veegt.
  const laterFrames = useCallback(
    (times: number, then?: () => void) => {
      const id = requestAnimationFrame(() => {
        frames.current = frames.current.filter((f) => f !== id);
        if (!realign.current) return;
        scrollToCurrent();
        if (times > 1) laterFrames(times - 1, then);
        else then?.();
      });
      frames.current.push(id);
    },
    [scrollToCurrent],
  );
  useEffect(
    () => () => {
      for (const id of frames.current) cancelAnimationFrame(id);
      frames.current = [];
    },
    [],
  );

  useEffect(() => {
    scrollToCurrent();
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pageWidth || !realign.current) return;
    scrollToCurrent();
    laterFrames(2);
  }, [pageWidth]); // eslint-disable-line react-hooks/exhaustive-deps

  // De inhoud heeft de nieuwe maat: nu kan de scroll niet meer afgekapt
  // worden. Nog eens een beeld later, voor als de melding er eerder was dan
  // de nieuwe maat op het scherm; daarna is het klaar.
  const onContentSizeChange = useCallback(
    (width: number) => {
      const now = live.current;
      // Nog de inhoud van de oude breedte: wachten op de volgende melding.
      if (!realign.current || !now.pageWidth || Math.abs(width - now.count * now.pageWidth) > now.pageWidth / 2) {
        return;
      }
      scrollToCurrent();
      laterFrames(1, () => {
        realign.current = false;
      });
    },
    [scrollToCurrent, laterFrames],
  );

  // De user veegt: vanaf nu bepaalt de veeg welke foto in beeld komt.
  const onDragStart = useCallback(() => {
    realign.current = false;
    cancelPendingPhotoTap();
  }, []);

  return { onContentSizeChange, onDragStart };
}

// WP32 B1–B3: het vaste fotogebied met het infoblok eronder (photoInfoHeight,
// src/screens/DetailStand.tsx). WP46: alleen nog op de iPad en het web; de
// telefoon gebruikt PhoneDetailLayout.
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

type ZoomPhoto = Shown["photo"];

// Knijpen zoomt (iOS-ScrollView), dubbeltikken wisselt tussen 1× en 2,5×.
// WP17c: ook voor het detail in Mijn foto's.
// WP46: een enkele tik op een foto wisselt de stand (`onTap`). Waar een
// dubbeltik zoomt (iOS), wacht de tik tot er geen tweede meer kan komen
// (A-invariant 6). Een tik op een filmpje doet niets met de stand (besluit 7):
// de speler doet zelf wat hij doet.
export function ZoomablePhoto(props: {
  photoId: Id<"photos">;
  photo: ZoomPhoto;
  box: { width: number; height: number };
  // WP37: staat deze pagina in beeld? Een filmpje erbuiten pauzeert.
  active?: boolean;
  // WP46: een enkele tik op de foto (niet bij een filmpje).
  onTap?: () => void;
  // WP46: de speler komt terug uit zijn eigen volledig scherm.
  onFullscreenExit?: () => void;
}) {
  // WP37: een filmpje speelt af in plaats van te zoomen (geen autoplay).
  if (props.photo.video) {
    return (
      <VideoPage
        photoId={props.photoId}
        photo={props.photo}
        box={props.box}
        active={props.active ?? true}
        label={`Filmpje van ${formatPhotoDate(props.photo)}`}
        onFullscreenExit={props.onFullscreenExit}
      />
    );
  }
  return <ZoomableImage photoId={props.photoId} photo={props.photo} box={props.box} onTap={props.onTap} />;
}

// Knijpen en de zoom van een dubbeltik bestaan alleen op iOS (WP17a).
const TAP_TARGET = Platform.OS === "ios" ? "zoomable" : "photo";

// WP46 A-invariant 6: langer ingedrukt is geen tik.
const LONG_PRESS_MS = 500;

// De enkele tik die nu wacht (hoogstens één tegelijk, in welke pagina ook).
let cancelPendingTap: (() => void) | null = null;

/** WP46: een veeg begint; een wachtende enkele tik wisselt de stand dan niet meer. */
export function cancelPendingPhotoTap(): void {
  cancelPendingTap?.();
}

function ZoomableImage({
  photoId,
  photo,
  box,
  onTap,
}: {
  photoId: Id<"photos">;
  photo: ZoomPhoto;
  box: { width: number; height: number };
  onTap?: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  // De eerste tik die nog wacht op een eventuele tweede.
  const pending = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const pressInAt = useRef(0);
  // Vast per pagina (alleen refs), zodat `cancelPendingTap` er naar kan wijzen.
  const clearPending = useCallback(() => {
    if (pending.current?.timer) clearTimeout(pending.current.timer);
    pending.current = null;
    if (cancelPendingTap === clearPending) cancelPendingTap = null;
  }, []);
  useEffect(() => clearPending, [clearPending]);
  const onPress = () => {
    const now = Date.now();
    if (now - pressInAt.current >= LONG_PRESS_MS) {
      clearPending();
      return;
    }
    const intent = tapIntent({ lastTapAt: pending.current?.at ?? null, now, target: TAP_TARGET });
    if (intent === "zoom") {
      clearPending();
      setZoom((z) => (z > 1.01 ? 1 : 2.5));
    } else if (intent === "wait") {
      clearPending();
      const timer = tapRef.current
        ? setTimeout(() => {
            clearPending();
            tapRef.current?.();
          }, DOUBLE_TAP_MS)
        : null;
      pending.current = { at: now, timer };
      if (timer) {
        cancelPendingTap?.();
        cancelPendingTap = clearPending;
      }
    } else if (intent === "stand") {
      clearPending();
      tapRef.current?.();
    }
  };
  // WP46 A-invariant 14: geen hint over dubbeltikken; met een schermlezer zoomt dat niet.
  const image = (
    <Pressable
      onPressIn={() => {
        pressInAt.current = Date.now();
      }}
      onPress={onPress}
      accessibilityRole="image" accessibilityLabel={`Foto van ${formatPhotoDate(photo)}`}>
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
  );
  // WP46 fix-cyclus 2: op Android zoomt de ScrollView niet (WP17a); daar
  // alleen de foto, zonder een tweede scrollgebied tussen de veeg van de
  // lijst en de tik op de foto.
  if (Platform.OS === "android") return <View style={box}>{image}</View>;
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
      // WP46: slepen in een ingezoomde foto is geen tik.
      onScrollBeginDrag={clearPending}
      onScrollEndDrag={(e) => setZoom(e.nativeEvent.zoomScale ?? 1)}
      onMomentumScrollEnd={(e) => setZoom(e.nativeEvent.zoomScale ?? 1)}
    >
      {image}
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
      accessibilityLabel={[name ? `${entry.photo.video ? "Filmpje" : "Foto"} van ${name}` : null, date, entry.photo.locationLabel].filter(Boolean).join(", ")}
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
