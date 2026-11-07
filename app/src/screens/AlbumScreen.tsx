import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { router, Stack, useIsFocused, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { Id } from "../../../convex/_generated/dataModel";
import { BackPill } from "../components/BackPill";
import { Gradient } from "../components/Gradient";
import { Icon } from "../components/Icon";
import { LetterTile } from "../components/LetterTile";
import { SmallButton } from "../components/SmallButton";
import { CoverScrim, PhotoImage } from "../components/Photo";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useAuthState } from "../data/authStateContext";
import { useAppState } from "../data/useAppState";
import { useLiveQuery } from "../data/useLiveQuery";
import { groupPath, photoPath } from "../lib/groupRoutes";
import { displayYear } from "../lib/groups";
import { formatPhotoDate, keepNewMarkers, shouldMarkSeen, sortAlbumPhotos } from "../lib/photos";
import { photoLayers, radius, size, space, useTheme } from "../theme";
import { AlbumReadFailed } from "./AlbumParts";
import {
  ActionFeedback,
  BottomPanel,
  menuActions,
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
export function AlbumScreen() {
  const { groupId, albumId } = useLocalSearchParams<{ groupId: string; albumId: string }>();
  const gid = String(groupId) as Id<"groups">;
  const aid = String(albumId) as Id<"albums">;
  const reconnecting = useAuthState() === "reconnecting";
  // In "reconnecting" toont Screen laden of een fout met "Opnieuw" en
  // "Uitloggen" (WP15a F1); de kop blijft staan.
  if (reconnecting) return <Screen header={<AlbumHeader groupId={gid} album={undefined} count={undefined} />}>{null}</Screen>;
  return (
    <QueryBoundary
      key={aid}
      fallback={(error, reset) => (
        <Screen header={<AlbumHeader groupId={gid} album={undefined} count={undefined} />}>
          <AlbumReadFailed groupId={gid} what="album" error={error} reset={reset} />
        </Screen>
      )}
    >
      <AlbumContent groupId={gid} albumId={aid} />
    </QueryBoundary>
  );
}

// Kolommen: 3 staand op een telefoon, 4 liggend, 5 tot 6 op een iPad (pariteit).
function columnsFor(width: number): number {
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

  const ctx = useMenuContext(groupId, album?.createdBy, me?._id);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const photoIds = useMemo(() => shown?.map((e) => e.albumPhoto.photoId as string) ?? [], [shown]);
  const menu = usePhotoMenu({ groupId, albumId, ctx, photoIds, onFeedback: setFeedback });
  // Een foto die verdwijnt, valt uit de selectie.
  const selected = useMemo(() => (shown ?? []).filter((e) => picked.has(e.albumPhoto.photoId)).map(menuPhotoOf), [shown, picked]);
  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setPicked(new Set());
  }, []);
  const runSelection = useSelectionActions({ albumId, ctx, onFeedback: setFeedback, onDone: stopSelecting });
  const listState = useMemo(() => ({ selecting, picked, ctx }), [selecting, picked, ctx]);
  const toggle = (photoId: string) =>
    setPicked((before) => {
      const next = new Set(before);
      if (!next.delete(photoId)) next.add(photoId);
      return next;
    });

  const columns = columnsFor(width);
  const tile = Math.floor((width - GAP * (columns - 1)) / columns);
  const loading = shown === undefined || me === undefined;

  return (
    <SafeAreaView edges={["left", "right"]} style={[styles.fill, { backgroundColor: colors.bg }]}>
      {/* De titel is de terugknop-tekst op het foto-detail. */}
      <Stack.Screen options={{ title: album?.name ?? "Album" }} />
      <FlatList
        key={columns}
        data={loading ? [] : shown}
        numColumns={columns}
        keyExtractor={(e) => e.albumPhoto._id}
        columnWrapperStyle={columns > 1 ? { gap: GAP } : undefined}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={Separator}
        extraData={listState}
        ListHeaderComponent={
          <AlbumHeader
            groupId={groupId}
            album={album}
            count={shown?.length}
            action={
              ctx && shown && shown.length > 0 && !selecting ? (
                <SmallButton
                  title="Selecteer"
                  icon="check"
                  onPress={() => {
                    setFeedback(null);
                    setSelecting(true);
                  }}
                />
              ) : null
            }
          />
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
          const hasMenu = !selecting && menuActions(ctx, photo).length > 0;
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
        windowSize={5}
        removeClippedSubviews
      />
      {selecting ? (
        <SelectionBar
          count={selected.length}
          onRemoveFromAlbum={() => runSelection("removeFromAlbum", selected)}
          onDelete={() => runSelection("delete", selected)}
          onCancel={stopSelecting}
        />
      ) : (
        feedback && (
          <BottomPanel>
            <ActionFeedback feedback={feedback} onClose={() => setFeedback(null)} />
          </BottomPanel>
        )
      )}
    </SafeAreaView>
  );
}

function menuPhotoOf(entry: Entry & { photo: NonNullable<Entry["photo"]> }): MenuPhoto {
  return { photoId: entry.albumPhoto.photoId, ownerId: entry.photo.ownerId, addedBy: entry.albumPhoto.addedBy };
}

// design.md §9: de teller en de acties in een balk onderaan, met tekst. Elke
// actie geldt per foto; wat niet mag, meldt de app daarna (A-keuze 2).
function SelectionBar({
  count,
  onRemoveFromAlbum,
  onDelete,
  onCancel,
}: {
  count: number;
  onRemoveFromAlbum: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const none = count === 0;
  return (
    <BottomPanel>
      <Text variant="bodyStrong" accessibilityLiveRegion="polite">
        {none ? "Tik op foto's om ze te kiezen" : `${count} geselecteerd`}
      </Text>
      <View style={styles.barRow}>
        <SmallButton title="Uit album" onPress={onRemoveFromAlbum} disabled={none} />
        <SmallButton title="Verwijderen" icon="trash" tone="danger" onPress={onDelete} disabled={none} />
        <SmallButton title="Annuleren" onPress={onCancel} />
      </View>
    </BottomPanel>
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
  const label = [`Foto van ${formatPhotoDate(entry.photo)}`, isNew && "nieuw", isMine && "jouw foto"]
    .filter(Boolean)
    .join(", ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      accessibilityHint={onMenu ? "Lang drukken voor acties" : undefined}
      accessibilityActions={onMenu ? [{ name: "menu", label: "Acties" }] : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "menu") onMenu?.();
      }}
      onPress={onPress}
      onLongPress={onMenu}
      style={({ pressed }) => [{ width: tile, height: tile }, pressed && styles.pressed]}
    >
      <PhotoImage
        photoId={entry.albumPhoto.photoId}
        format="klein"
        exifOrientation={entry.photo.exifOrientation}
        hasFormats={entry.photo.hasFormats}
        box={{ width: tile, height: tile }}
      />
      {isNew && <NewLabel />}
      {isMine && <MineBadge />}
      {selected !== undefined && <SelectMark selected={selected} />}
    </Pressable>
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
function SelectMark({ selected }: { selected: boolean }) {
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
  count,
  action,
}: {
  groupId: Id<"groups">;
  album: Album | undefined;
  count: number | undefined;
  // WP17b: "Selecteer", op een eigen regel (design.md §3).
  action?: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const minHeight = insets.top + Math.round(Math.min(width * 0.6, size.cover * 1.6));
  // Bij grote tekst kan de kop hoger worden; de cover groeit mee.
  const [measured, setMeasured] = useState(0);
  const height = Math.max(minHeight, measured);
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(groupPath(groupId));
  };
  // N1 (audit, pariteit): zonder cover de letter van het album, zoals in de
  // albumlijst, onder de pil in de flow (WP16-kop).
  const tile =
    album !== undefined ? (
      <LetterTile name={album.name} size={size.groupTile * 1.5} radius={radius.albumTile} variant="largeTitle" />
    ) : null;
  return (
    <View style={{ marginBottom: space.l }}>
      <View
        style={{ width, minHeight, paddingTop: insets.top + space.s, overflow: "hidden" }}
        onLayout={(e) => setMeasured(Math.ceil(e.nativeEvent.layout.height))}
      >
        {album?.cover ? (
          <View style={StyleSheet.absoluteFill}>
            <PhotoImage
              photoId={album.cover._id}
              format="groot"
              exifOrientation={album.cover.exifOrientation}
              hasFormats={album.cover.hasFormats}
              box={{ width, height }}
              fallback={
                <>
                  <Gradient from={colors.washStart} to={colors.washEnd} />
                  <View style={[StyleSheet.absoluteFill, styles.center]}>{tile}</View>
                </>
              }
            />
            <CoverScrim height={height} />
          </View>
        ) : (
          <Gradient from={colors.washStart} to={colors.washEnd} />
        )}
        <View style={styles.headerColumn}>
          <BackPill title="Groep" onPress={back} />
          {!album?.cover && tile && <View style={styles.headerTile}>{tile}</View>}
        </View>
      </View>
      {album !== undefined && (
        <View style={[styles.column, styles.intro]}>
          <Text variant="title" accessibilityRole="header">
            {album.name}
          </Text>
          {album.description ? <Text>{album.description}</Text> : null}
          <Text variant="meta" color="muted">
            {[displayYear(album), count === undefined ? null : count === 1 ? "1 foto" : `${count} foto's`]
              .filter(Boolean)
              .join(" · ")}
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
  pressed: { opacity: 0.7 },
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
  barRow: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
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
