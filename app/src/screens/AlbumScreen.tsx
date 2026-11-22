import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { router, Stack, useIsFocused, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedRef, useScrollOffset } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { Id } from "../../../convex/_generated/dataModel";
import { BackPill } from "../components/BackPill";
import { Gradient } from "../components/Gradient";
import { Icon } from "../components/Icon";
import { LetterTile } from "../components/LetterTile";
import { AnimatedPressable, CoverFailed, HeaderItem, MotionHeader, PressShade, ScrollOffsetContext, usePressMotion } from "../components/Motion";
import { SmallButton } from "../components/SmallButton";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { CoverScrim, PhotoImage } from "../components/Photo";
import { VideoBadge } from "../components/VideoPlayer";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useWideLayout } from "../components/wideLayout";
import { useReduceMotion } from "../data/accessibility";
import { useDeparting } from "../data/adminState";
import { READ_ONLY, WEB_UPLOAD } from "../data/readOnly";
import { startAddPick } from "../data/webPick";
import { useAuthState } from "../data/authStateContext";
import { useAppState } from "../data/useAppState";
import { useSharePhoto } from "../data/share";
import { useMyGroups } from "../data/homeGroupState";
import { useLiveQuery } from "../data/useLiveQuery";
import { groupRights } from "../lib/groupAdmin";
import { albumMapPath, editAlbumPath, groupPath, photoPath } from "../lib/groupRoutes";
import { displayYear } from "../lib/groups";
import { formatPhotoDate, keepNewMarkers, shouldMarkSeen, sortAlbumPhotos } from "../lib/photos";
import { filterEntries, MEDIA_FILTER_LABELS, mediaCountText, showMediaFilter, videoLabel, type MediaFilter } from "../lib/videos";
import { enterSelectionScroll, leaveSelectionScroll } from "../lib/selectionBar";
import { photoLayers, radius, size, space, useTheme } from "../theme";
import { AlbumChoiceSheet } from "./AlbumChoice";
import { AlbumReadFailed } from "./AlbumParts";
import { SELECTION_TOP_BAR, SelectionBar, SelectionSideHeader, SelectionTopBar, useSelectionHeader } from "./SelectionBar";
import { WideSide, WideSplit } from "./WideSide";
import { SIDE_WIDTH, WIDE_WINDOW_SIZE, wideGrid } from "../lib/wideLayout";
import {
  ActionFeedback,
  SharingProgress,
  BottomPanel,
  useMenuContext,
  usePhotoMenu,
  useSelectionActions,
  type Feedback,
  type MenuPhoto,
} from "./PhotoMenu";

type Entry = FunctionReturnType<typeof api.albums.listPhotos>[number];
type Album = FunctionReturnType<typeof api.albums.getWithCover>;

// WP17a: Album. Cover over de volle breedte, naam, jaar en "N foto's"; daaronder
// het raster (3 kolommen staand, meer op een breder scherm), nieuwste foto
// eerst, met de markeringen "nieuw" en "jouw foto". Het raster laadt alleen de
// tegels in beeld (FlatList). Geen lid (meer), of het album bestaat niet: de
// NOT_MEMBER-fout, opgevangen door de grens hieronder (invariant 7).
//
// WP17b: lang drukken op een foto opent het foto-menu; "Selecteer" zet vinkjes
// en een balk onderaan met "Uit album" en "Verwijderen", per foto (invariant 7).
// De melding na een actie staat onderaan en blijft tot de volgende actie.
//
// WP40: in de selectiestand een eigen kop met het aantal en Annuleren (geen
// terugknop, geen terugvegen), en onderin een slanke balk. Selecteer scrolt
// naar het raster; terug uit de selectie gaat de lijst terug, als je zelf niet
// gescrold hebt (A3, A4).
export function AlbumScreen() {
  const { groupId, albumId } = useLocalSearchParams<{ groupId: string; albumId: string }>();
  const gid = String(groupId) as Id<"groups">;
  const aid = String(albumId) as Id<"albums">;
  const reconnecting = useAuthState() === "reconnecting";
  // WP28b A-invariant 23: na album verwijderen geen "niet meer zien" tussendoor.
  const departing = useDeparting(aid);
  // In "reconnecting" toont Screen laden of een fout met "Opnieuw" en
  // "Uitloggen" (WP15a F1); de kop blijft staan.
  if (reconnecting) return <Screen header={<AlbumHeader groupId={gid} album={undefined} counts={undefined} />}>{null}</Screen>;
  return (
    <QueryBoundary
      key={aid}
      fallback={(error, reset) => (
        <Screen header={<AlbumHeader groupId={gid} album={undefined} counts={undefined} />}>
          {departing ? (
            <LoadingState label="Bezig…" />
          ) : (
            <AlbumReadFailed groupId={gid} what="album" error={error} reset={reset} />
          )}
        </Screen>
      )}
    >
      <AlbumContent groupId={gid} albumId={aid} />
    </QueryBoundary>
  );
}

// Kolommen: 3 staand op een telefoon, 4 liggend, 5 tot 6 op een iPad (pariteit).
export function columnsFor(width: number): number {
  if (width < 600) return 3;
  if (width < 900) return 4;
  if (width < 1100) return 5;
  return 6;
}

const GAP = 2;

function AlbumContent({ groupId, albumId }: { groupId: Id<"groups">; albumId: Id<"albums"> }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const album = useLiveQuery(api.albums.getWithCover, { albumId });
  const entries = useLiveQuery(api.albums.listPhotos, { albumId });
  const me = useLiveQuery(api.users.profile, {});
  const shown = useMemo(() => (entries ? sortAlbumPhotos(entries) : undefined), [entries]);
  const newIds = useNewMarkers(entries);
  useMarkSeen(albumId, shown);
  // WP37 besluit 1: Alle, Foto's, Video's; alleen in een album met een filmpje
  // (invariant 10). Het detail swipet door alles, zoals Foto's op de iPhone.
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("alle");
  const hasVideos = shown !== undefined && showMediaFilter(shown);
  const activeFilter: MediaFilter = hasVideos ? mediaFilter : "alle";
  const visible = useMemo(() => (shown ? filterEntries(shown, activeFilter) : undefined), [shown, activeFilter]);

  const ctx = useMenuContext(groupId, me?._id);
  // WP28b: "Bewerk album" voor een admin (A-invariant 18).
  const mine = useMyGroups();
  const founderId = mine?.find((g) => g._id === groupId)?.createdBy;
  // WP35 W5: op het web niets bewerken of selecteren; de kaart blijft.
  const canEdit = !READ_ONLY && ctx && founderId ? groupRights({ ...ctx, founderId }).editAlbum : false;
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const photoIds = useMemo(() => shown?.map((e) => e.albumPhoto.photoId as string) ?? [], [shown]);
  const place = useMemo(() => ({ groupId, albumId }), [groupId, albumId]);
  const menu = usePhotoMenu({ place, ctx, photoIds, onFeedback: setFeedback , sharePhoto: useSharePhoto() });
  // Een foto die verdwijnt, valt uit de selectie.
  const selected = useMemo(() => (shown ?? []).filter((e) => picked.has(e.albumPhoto.photoId)).map(menuPhotoOf), [shown, picked]);
  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setPicked(new Set());
  }, []);
  const [selectionBusy, setSelectionBusy] = useState(false);
  // WP17c: de album-keuze voor "Toevoegen aan album".
  const [choosing, setChoosing] = useState(false);
  const runSelection = useSelectionActions({
    albumId,
    ctx,
    onFeedback: setFeedback,
    onDone: stopSelecting,
    onBusyChange: setSelectionBusy,
  });
  const listState = useMemo(() => ({ selecting, picked, ctx }), [selecting, picked, ctx]);
  const header = useSelectionHeader({ count: selected.length, busy: selectionBusy, active: selecting });
  const toggle = (photoId: string) =>
    setPicked((before) => {
      const next = new Set(before);
      if (!next.delete(photoId)) next.add(photoId);
      return next;
    });

  // WP35 (breed web-venster, liggende iPad): de kop staat links in een vaste
  // kolom, zonder bewegende kop (WP33); rechts tegels van vaste maat, zoveel
  // als er passen. De native kop is hier altijd verborgen: de pil is de enige
  // terugknop.
  const wide = useWideLayout();
  const grid = wide ? wideGrid(width - SIDE_WIDTH - 2 * size.screenMargin, GAP) : null;
  const columns = grid ? grid.columns : columnsFor(width);
  const tile = grid ? grid.tile : Math.floor((width - GAP * (columns - 1)) / columns);
  // "Selecteer", "Kaart" en "Bewerk album": onder de titel, in de kop of de kolom.
  // WP36 (besluit 3, U11): op het web ook "Toevoegen", voor elk lid
  // van de groep (zoals de + op iOS); de kiezer opent in de tik (U9).
  const webAdd = WEB_UPLOAD && ctx !== undefined;
  // WP40 A5: tijdens de selectie onzichtbaar, maar de rij houdt haar plek; zo
  // verspringen de foto's niet als hij weggaat en terugkomt.
  const action =
    canEdit || webAdd || (ctx && shown && shown.length > 0) ? (
      <Hide hidden={selecting} style={styles.barRow}>
        {webAdd ? (
          <SmallButton
            title="Toevoegen"
            icon="plus"
            onPress={() => {
              setFeedback(null);
              startAddPick();
              router.push({ pathname: "/toevoegen", params: { albumId } });
            }}
          />
        ) : null}
        {!READ_ONLY && ctx && shown && shown.length > 0 ? (
          <SmallButton
            title="Selecteer"
            icon="check"
            onPress={() => {
              setFeedback(null);
              setSelecting(true);
            }}
          />
        ) : null}
        {ctx && shown && shown.length > 0 ? (
          <SmallButton
            title="Kaart"
            icon="map"
            onPress={() => {
              setFeedback(null);
              router.push(albumMapPath(groupId, albumId));
            }}
          />
        ) : null}
        {canEdit ? (
          <SmallButton
            title="Bewerk album"
            icon="edit"
            onPress={() => {
              setFeedback(null);
              router.push(editAlbumPath(groupId, albumId));
            }}
          />
        ) : null}
      </Hide>
    ) : null;
  const filterBar = hasVideos ? (
    <SegmentedTabs
      tabs={(["alle", "fotos", "videos"] as const).map((key) => ({ key, title: MEDIA_FILTER_LABELS[key] }))}
      selected={activeFilter}
      onSelect={setMediaFilter}
    />
  ) : null;
  const headerAction =
    action || filterBar ? (
      <View style={styles.headerStack}>
        {action}
        {filterBar}
      </View>
    ) : null;
  const loading = shown === undefined || me === undefined;
  // WP33: de scrollpositie op de UI-thread, voor de bewegende kop.
  const listRef = useAnimatedRef<Animated.FlatList<Entry>>();
  const offset = useScrollOffset(listRef);
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  // WP40 A3, A4: wat nodig is om naar het raster te scrollen, en terug.
  const listHeaderHeight = useRef(0);
  const topBarHeight = useRef<number | null>(null);
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);
  const scrollMemo = useRef<{ before: number; entered: number | null } | null>(null);
  useEffect(() => {
    if (selecting) {
      const before = offset.value;
      scrollMemo.current = { before, entered: null };
      // A8: in de brede layout scrolt het raster niet.
      if (wide) return;
      // Twee frames: de kop en de balk staan dan, met hun maten.
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const bar = topBarHeight.current ?? insets.top + SELECTION_TOP_BAR;
          const target = enterSelectionScroll({
            offset: offset.value,
            gridTop: listHeaderHeight.current - bar,
            maxOffset: contentHeight.current - viewportHeight.current,
          });
          if (target === null || scrollMemo.current === null) return;
          scrollMemo.current = { before, entered: target };
          listRef.current?.scrollToOffset({ offset: target, animated: !reduceMotion });
        });
      });
      return () => cancelAnimationFrame(frame);
    }
    const memo = scrollMemo.current;
    scrollMemo.current = null;
    if (memo === null) return;
    const target = leaveSelectionScroll({ before: memo.before, entered: memo.entered, current: offset.value });
    if (target !== null) listRef.current?.scrollToOffset({ offset: target, animated: !reduceMotion });
    // Alleen bij aan of uit; de rest lees je op dat moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecting]);
  // A8: wisselt de layout tijdens de selectie (draaien, Split View), dan staat
  // de lijst ergens anders; terug uit de selectie blijft hij dan staan.
  useEffect(() => {
    if (scrollMemo.current) scrollMemo.current = { ...scrollMemo.current, entered: null };
  }, [wide, columns]);
  // Verdwijnt de inhoud tijdens de selectie (bv. "reconnecting"), dan mag
  // terugvegen weer: de optie blijft anders op het scherm staan.
  const navigation = useNavigation();
  const selectingNow = useRef(selecting);
  selectingNow.current = selecting;
  useEffect(
    () => () => {
      if (selectingNow.current) navigation.setOptions({ gestureEnabled: true });
    },
    [navigation],
  );

  return (
    <SafeAreaView edges={["left", "right"]} style={[styles.fill, { backgroundColor: colors.bg }]}>
      {/* De titel is de terugknop-tekst op het foto-detail. WP40: tijdens de
          selectie geen terugvegen; Annuleren is de weg terug. */}
      <Stack.Screen options={{ title: album?.name ?? "Album", gestureEnabled: !selecting }} />
      {/* Vóór de lijst, zodat VoiceOver hem eerst leest (kop, raster, balk). */}
      {selecting && !wide ? (
        <SelectionTopBar
          header={header}
          onCancel={stopSelecting}
          onHeight={(height) => {
            topBarHeight.current = height;
          }}
        />
      ) : null}
      <WideOrNot
        wide={wide}
        side={
          <WideSide
            back={selecting ? undefined : { title: "Groep", onPress: () => backToGroup(groupId) }}
            top={selecting ? <SelectionSideHeader header={header} onCancel={stopSelecting} /> : undefined}
            name={album?.name}
            cover={album?.cover}
            description={album?.description}
            meta={album ? albumMeta(album, mediaCounts(shown)) : undefined}
          >
            {headerAction}
          </WideSide>
        }
      >
      <ScrollOffsetContext.Provider value={offset}>
      <Animated.FlatList
        ref={listRef}
        key={columns}
        // WP33 F3: elk frame, voor de kop.
        scrollEventThrottle={16}
        data={loading ? [] : visible}
        numColumns={columns}
        keyExtractor={(e) => e.albumPhoto._id}
        columnWrapperStyle={columns > 1 ? { gap: GAP } : undefined}
        contentContainerStyle={wide ? [styles.list, styles.wideList] : styles.list}
        ItemSeparatorComponent={Separator}
        extraData={listState}
        onLayout={(e) => {
          viewportHeight.current = e.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_w, h) => {
          contentHeight.current = h;
        }}
        ListHeaderComponent={
          wide ? undefined : (
            <View
              onLayout={(e) => {
                listHeaderHeight.current = e.nativeEvent.layout.height;
              }}
            >
              <AlbumHeader
                groupId={groupId}
                album={album}
                counts={mediaCounts(shown)}
                action={headerAction}
                selecting={selecting}
              />
            </View>
          )
        }
        ListEmptyComponent={
          <View style={styles.column}>
            {loading ? (
              <LoadingState label="Foto's laden…" />
            ) : (
              <EmptyState icon="photos" title="Nog geen foto's" text="In dit album staan nog geen foto's." />
            )}
          </View>
        }
        renderItem={({ item }) => {
          const photo = menuPhotoOf(item);
          const hasMenu = !selecting && menu.hasActions(photo);
          return (
            <Tile
              entry={item}
              size={tile}
              isNew={newIds.has(item.albumPhoto.photoId)}
              isMine={me !== null && me !== undefined && item.photo.ownerId === me._id}
              selected={selecting ? picked.has(item.albumPhoto.photoId) : undefined}
              onPress={() =>
                selecting ? toggle(item.albumPhoto.photoId) : router.push(photoPath(groupId, albumId, item.albumPhoto.photoId))
              }
              onMenu={hasMenu ? () => menu.open(photo) : undefined}
            />
          );
        }}
        initialNumToRender={columns * 6}
        // WP35: in de brede web-layout minder schermen vooruit (beeldgeheugen
        // van de browser); op iOS niet nodig.
        windowSize={grid && Platform.OS === "web" ? WIDE_WINDOW_SIZE : 5}
        removeClippedSubviews
      />
      </ScrollOffsetContext.Provider>
      </WideOrNot>
      <AlbumChoiceSheet
        visible={choosing}
        fromAlbumId={albumId}
        onClose={() => setChoosing(false)}
        onChoose={(target) => {
          setChoosing(false);
          runSelection("addToAlbum", selected, target);
        }}
      />
      {selecting ? (
        <SelectionBar
          place="album"
          count={selected.length}
          busy={selectionBusy}
          onAction={(a) => (a === "addToAlbum" ? setChoosing(true) : runSelection(a, selected))}
        />
      ) : (
        menu.sharing ? (
          <BottomPanel>
            <SharingProgress />
          </BottomPanel>
        ) : (
          feedback && (
            <BottomPanel>
              <ActionFeedback feedback={feedback} onClose={() => setFeedback(null)} />
            </BottomPanel>
          )
        )
      )}
    </SafeAreaView>
  );
}

// WP35: in de brede layout de lijst rechts naast de vaste kolom; anders alleen
// de lijst.
function WideOrNot({ wide, side, children }: { wide: boolean; side: ReactNode; children: ReactNode }) {
  if (!wide) return <>{children}</>;
  return <WideSplit side={side}>{children}</WideSplit>;
}

function backToGroup(groupId: Id<"groups">) {
  if (router.canGoBack()) router.back();
  else router.replace(groupPath(groupId));
}

// Jaar en aantal foto's onder de titel; WP37 A-invariant 34: filmpjes apart.
function albumMeta(album: Album, counts: { photos: number; videos: number } | undefined): string {
  return [displayYear(album), counts === undefined ? null : mediaCountText(counts.photos, counts.videos)]
    .filter(Boolean)
    .join(" · ");
}

function mediaCounts(entries: readonly { photo: { video?: unknown } | null }[] | undefined) {
  if (entries === undefined) return undefined;
  const videos = entries.filter((e) => e.photo?.video !== undefined).length;
  return { photos: entries.length - videos, videos };
}

function menuPhotoOf(entry: Entry & { photo: NonNullable<Entry["photo"]> }): MenuPhoto {
  return {
    photoId: entry.albumPhoto.photoId,
    ownerId: entry.photo.ownerId,
    addedBy: entry.albumPhoto.addedBy,
    ownerName: entry.owner?.name,
    hasFormats: entry.photo.hasFormats,
    exifOrientation: entry.photo.exifOrientation,
    isVideo: entry.photo.video !== undefined,
  };
}

// WP40: onzichtbaar en niet aan te tikken, maar met zijn plek in de layout.
function Hide({ hidden, style, children }: { hidden: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <View
      style={[style, hidden && styles.hidden]}
      pointerEvents={hidden ? "none" : undefined}
      accessibilityElementsHidden={hidden || undefined}
      importantForAccessibility={hidden ? "no-hide-descendants" : undefined}
    >
      {children}
    </View>
  );
}

function Separator() {
  return <View style={{ height: GAP }} />;
}

// Invariant 12: een markering blijft staan zolang het scherm open is, ook als
// markSeen alles live "niet nieuw" maakt.
function useNewMarkers(entries: Entry[] | undefined): ReadonlySet<string> {
  const markers = useRef<ReadonlySet<string>>(new Set());
  return useMemo(() => {
    if (entries) markers.current = keepNewMarkers(markers.current, entries);
    return markers.current;
  }, [entries]);
}

// Vraag 6 (WP16 invariant 3): album gelezen zodra het in beeld is met minstens
// één geladen foto, en opnieuw als er een foto bijkomt terwijl het in beeld is.
function useMarkSeen(albumId: Id<"albums">, shown: { albumPhoto: { photoId: string } }[] | undefined) {
  const markSeen = useMutation(api.albums.markSeen);
  const focused = useIsFocused();
  const appState = useAppState();
  const inView = focused && appState === "active";
  const marked = useRef<Set<string> | null>(null);
  const photoIds = useMemo(() => shown?.map((e) => e.albumPhoto.photoId) ?? [], [shown]);
  const loaded = shown !== undefined;
  useEffect(() => {
    if (!shouldMarkSeen({ inView, loaded, photoIds, markedIds: marked.current })) return;
    const before = marked.current;
    marked.current = new Set([...(before ?? []), ...photoIds]);
    // Mislukt het, dan bij de volgende gelegenheid opnieuw.
    markSeen({ albumId }).catch(() => {
      marked.current = before;
    });
  }, [inView, loaded, photoIds, albumId, markSeen]);
}

function Tile({
  entry,
  size: tile,
  isNew,
  isMine,
  selected,
  onPress,
  onMenu,
}: {
  entry: Entry & { photo: NonNullable<Entry["photo"]> };
  size: number;
  isNew: boolean;
  isMine: boolean;
  // Alleen tijdens selecteren: wel of niet gekozen.
  selected?: boolean;
  onPress: () => void;
  // Het foto-menu (lang drukken; voor VoiceOver een actie "Acties").
  onMenu?: () => void;
}) {
  const video = entry.photo.video;
  const label = [
    video ? videoLabel(formatPhotoDate(entry.photo), video.durationMs) : `Foto van ${formatPhotoDate(entry.photo)}`,
    isNew && "nieuw",
    isMine && (video ? "jouw filmpje" : "jouw foto"),
  ]
    .filter(Boolean)
    .join(", ");
  // WP33 B2 (besluit 5): de tegel krimpt en wordt iets donkerder, ook tijdens
  // selecteren en bij lang drukken.
  const press = usePressMotion("tile");
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      accessibilityHint={onMenu ? "Lang drukken voor acties" : undefined}
      accessibilityActions={onMenu ? [{ name: "menu", label: "Acties" }] : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "menu") onMenu?.();
      }}
      onPress={press.withRelease(onPress)}
      onLongPress={onMenu}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[{ width: tile, height: tile }, press.style]}
    >
      <PhotoImage
        photoId={entry.albumPhoto.photoId}
        format="klein"
        exifOrientation={entry.photo.exifOrientation}
        hasFormats={entry.photo.hasFormats}
        box={{ width: tile, height: tile }}
        retryPress={press}
      />
      {isNew && <NewLabel />}
      {video && <VideoBadge durationMs={video.durationMs} />}
      {isMine && <MineBadge />}
      {selected !== undefined && <SelectMark selected={selected} />}
      <PressShade style={press.shadeStyle} />
    </AnimatedPressable>
  );
}

// design.md §5: de tekst "nieuw" op `cta`, op een foto met een witte rand.
function NewLabel() {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.newLabel, { backgroundColor: colors.cta }]}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Text variant="albumMeta" style={{ color: colors.onCta, fontWeight: "700" }} maxFontSizeMultiplier={1.3}>
        nieuw
      </Text>
    </View>
  );
}

// Een vinkje op de foto (design.md §9); niet gekozen: een lege cirkel.
export function SelectMark({ selected }: { selected: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[StyleSheet.absoluteFill, selected && styles.selectedLayer, { borderColor: colors.primary }]}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.selectMark}>
        <View style={[StyleSheet.absoluteFill, styles.mineLayer]} />
        <Icon name={selected ? "check" : "circle"} size={24} color={photoLayers.text} filled={selected} />
      </View>
    </View>
  );
}

function MineBadge() {
  return (
    <View style={styles.mine} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={[StyleSheet.absoluteFill, styles.mineLayer]} />
      <Icon name="user" size={16} color={photoLayers.text} filled />
    </View>
  );
}

// De kop: cover over de volle breedte (of het verloop met de letter), de
// terugknop-pil, en daaronder naam, jaar en aantal.
function AlbumHeader({
  groupId,
  album,
  counts,
  action,
  selecting = false,
}: {
  groupId: Id<"groups">;
  album: Album | undefined;
  counts: { photos: number; videos: number } | undefined;
  // WP17b: "Selecteer", op een eigen regel (design.md §3).
  action?: ReactNode;
  // WP40: in de selectiestand geen terugknop (Annuleren is de weg terug).
  selecting?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const minHeight = insets.top + Math.round(Math.min(width * 0.6, size.cover * 1.6));
  // Een cover die niet laadt: de kop zonder cover, ook zonder zoom (WP33 A6).
  const [failed, setFailed] = useState<string | null>(null);
  const photo = album?.cover && failed !== album.cover._id ? album.cover : null;
  const back = () => backToGroup(groupId);
  // N1 (audit, pariteit): zonder cover de letter van het album, zoals in de
  // albumlijst, onder de pil in de flow (WP16-kop).
  const tile =
    album !== undefined ? (
      <LetterTile name={album.name} size={size.groupTile * 1.5} radius={radius.albumTile} variant="largeTitle" />
    ) : null;
  const wash = <Gradient from={colors.washStart} to={colors.washEnd} />;
  return (
    <View style={{ marginBottom: space.l }}>
      {/* WP33: de kop beweegt bij scrollen en trekken; pil en letter vervagen. */}
      <MotionHeader
        minHeight={minHeight}
        style={{ paddingTop: insets.top + space.s }}
        zoom={photo !== null}
        backdrop={(box) =>
          photo ? (
            <>
              <PhotoImage
                photoId={photo._id}
                format="groot"
                exifOrientation={photo.exifOrientation}
                hasFormats={photo.hasFormats}
                box={box}
                fallback={<CoverFailed onFail={() => setFailed(photo._id)}>{wash}</CoverFailed>}
              />
              <CoverScrim height={box.height} />
            </>
          ) : (
            wash
          )
        }
      >
        <View style={styles.headerColumn}>
          <HeaderItem style={styles.pillItem}>
            <Hide hidden={selecting}>
              <BackPill title="Groep" onPress={back} />
            </Hide>
          </HeaderItem>
          {!photo && tile && (
            <View style={styles.headerTile}>
              <HeaderItem>{tile}</HeaderItem>
            </View>
          )}
        </View>
      </MotionHeader>
      {album !== undefined && (
        <View style={[styles.column, styles.intro]}>
          <Text variant="title" accessibilityRole="header">
            {album.name}
          </Text>
          {album.description ? <Text>{album.description}</Text> : null}
          <Text variant="meta" color="muted">
            {albumMeta(album, counts)}
          </Text>
          {action ? <View style={styles.headerAction}>{action}</View> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { paddingBottom: space.xxl },
  // WP35: de rasterkolom rechts in de brede layout.
  wideList: { padding: size.screenMargin, paddingTop: space.xl },
  column: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
  },
  intro: { gap: space.xs, paddingTop: space.l },
  center: { alignItems: "center", justifyContent: "center" },
  headerColumn: {
    flex: 1,
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
    paddingBottom: space.l,
    gap: space.l,
  },
  headerTile: { flex: 1, alignItems: "center", justifyContent: "center" },
  pillItem: { alignSelf: "flex-start" },
  newLabel: {
    position: "absolute",
    top: space.xs,
    left: space.xs,
    paddingHorizontal: space.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  mine: {
    position: "absolute",
    bottom: space.xs,
    right: space.xs,
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  headerAction: { paddingTop: space.s },
  headerStack: { gap: space.m },
  barRow: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  hidden: { opacity: 0 },
  selectedLayer: { borderWidth: 3 },
  selectMark: {
    position: "absolute",
    top: space.xs,
    right: space.xs,
    width: 30,
    height: 30,
    borderRadius: 15,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  mineLayer: { backgroundColor: photoLayers.pill.color, opacity: photoLayers.pill.opacity },
});
