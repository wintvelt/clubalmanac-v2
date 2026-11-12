import type { FunctionReturnType } from "convex/server";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Id } from "../../../convex/_generated/dataModel";
import { PhotoImage } from "../components/Photo";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { SmallButton } from "../components/SmallButton";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useAuthState } from "../data/authStateContext";
import { useSharePhoto } from "../data/share";
import { useLiveQuery } from "../data/useLiveQuery";
import { myPhotoPath } from "../lib/groupRoutes";
import { formatPhotoDate } from "../lib/photos";
import { size, space, useTheme } from "../theme";
import { AlbumChoiceSheet } from "./AlbumChoice";
import { columnsFor, SelectMark } from "./AlbumScreen";
import { LoadError } from "./GroupParts";
import {
  ActionFeedback,
  BottomPanel,
  menuActions,
  usePhotoMenu,
  useSelectionActions,
  type Feedback,
  type MenuContext,
  type MenuPhoto,
} from "./PhotoMenu";

export type MyPhoto = FunctionReturnType<typeof api.photos.listMine>["page"][number];

// Zoveel foto's per stap. Met de schakelaar "Niet in een album" filtert de
// backend ná het bladeren, dus daar grotere stappen, tot alles bekeken is.
export const MY_PHOTOS_STEP = 60;
const LOOSE_STEP = 300;

// WP17c invariant 2, A-keuze 1 en 2: je eigen foto's, nieuwste upload eerst,
// stap voor stap (photos.listMine). Eén live query die groeit: de lijst
// verschuift nooit tussen pagina's (een nieuwe upload of een gewiste foto
// geeft geen gat of dubbele), en tijdens het laden van de volgende stap
// blijft de vorige lijst staan. Alleen het toegangspad (useLiveQuery) leest
// live data (WP15a invariant 6).
export function useMyPhotos(withoutAlbum: boolean, initial = MY_PHOTOS_STEP) {
  const [limit, setLimit] = useState(initial);
  const result = useLiveQuery(api.photos.listMine, {
    paginationOpts: { numItems: limit, cursor: null },
    ...(withoutAlbum ? { withoutAlbum: true } : {}),
  });
  const last = useRef<{ withoutAlbum: boolean; limit: number; value: NonNullable<typeof result> } | null>(null);
  if (result !== undefined) last.current = { withoutAlbum, limit, value: result };
  const shown = last.current?.withoutAlbum === withoutAlbum ? last.current : null;
  const fresh = result !== undefined;
  const isDone = shown?.value.isDone ?? false;
  const step = withoutAlbum ? LOOSE_STEP : MY_PHOTOS_STEP;

  const loadMore = useCallback(() => {
    // Pas een volgende stap als de huidige binnen is.
    if (!fresh || isDone) return;
    setLimit((l) => (l === limit ? l + step : l));
  }, [fresh, isDone, limit, step]);

  // Met de schakelaar: door tot alles bekeken is (er zijn er weinig, en een
  // stap kan leeg zijn).
  useEffect(() => {
    if (withoutAlbum && fresh && !isDone) setLimit((l) => (l === limit ? l + step : l));
  }, [withoutAlbum, fresh, isDone, limit, step]);

  return {
    photos: shown?.value.page,
    isDone,
    loadingMore: shown !== null && (!fresh || (withoutAlbum && !isDone)),
    loadMore,
    limit,
    reset: () => setLimit(initial),
  };
}

// WP17c: Mijn foto's. Al je eigen foto's in één raster (invariant 1), met de
// schakelaar "Alle / Niet in een album". Tik: het detail, swipen door je
// foto's. Lang drukken: het menu (profielfoto, draaien, verwijderen).
// "Selecteer": toevoegen aan album en verwijderen, per foto (invariant 3).
export function MyPhotosScreen() {
  if (useAuthState() === "reconnecting") return <Screen>{null}</Screen>;
  return (
    <QueryBoundary
      fallback={(_error, reset) => (
        <Screen>
          <LoadError title="Je foto's laden lukt niet" onRetry={reset} />
        </Screen>
      )}
    >
      <MyPhotosContent />
    </QueryBoundary>
  );
}

type Filter = "all" | "loose";
const FILTERS = [
  { key: "all", title: "Alle" },
  { key: "loose", title: "Niet in een album" },
] as const;

const GAP = 2;

function MyPhotosContent() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<Filter>("all");
  const withoutAlbum = filter === "loose";
  const list = useMyPhotos(withoutAlbum);
  const me = useLiveQuery(api.users.profile, {});
  // In Mijn foto's is elke foto van jou; de rol telt hier niet.
  const ctx = useMemo<MenuContext | undefined>(() => (me ? { me: me._id, role: "member" } : undefined), [me]);

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [choosing, setChoosing] = useState(false);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const photos = list.photos;
  const photoIds = useMemo(() => photos?.map((p) => p._id as string) ?? [], [photos]);
  const menu = usePhotoMenu({ place: null, ctx, photoIds, onFeedback: setFeedback , sharePhoto: useSharePhoto() });
  const selected = useMemo(() => (photos ?? []).filter((p) => picked.has(p._id)).map(menuPhotoOf), [photos, picked]);
  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setPicked(new Set());
  }, []);
  const runSelection = useSelectionActions({
    ctx,
    onFeedback: setFeedback,
    onDone: stopSelecting,
    onBusyChange: setSelectionBusy,
  });
  const toggle = (photoId: string) =>
    setPicked((before) => {
      const next = new Set(before);
      if (!next.delete(photoId)) next.add(photoId);
      return next;
    });
  const listState = useMemo(() => ({ selecting, picked, ctx }), [selecting, picked, ctx]);

  const columns = columnsFor(width);
  const tile = Math.floor((width - GAP * (columns - 1)) / columns);
  const loading = photos === undefined || me === undefined;
  const hasPhotos = !!photos && photos.length > 0;

  return (
    <SafeAreaView edges={["left", "right"]} style={[styles.fill, { backgroundColor: colors.bg }]}>
      <FlatList
        key={columns}
        data={loading ? [] : photos}
        numColumns={columns}
        keyExtractor={(p) => p._id}
        columnWrapperStyle={columns > 1 ? { gap: GAP } : undefined}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={Separator}
        extraData={listState}
        onEndReached={list.loadMore}
        onEndReachedThreshold={1.5}
        ListHeaderComponent={
          <View style={[styles.column, styles.header]}>
            <SegmentedTabs
              tabs={FILTERS}
              selected={filter}
              onSelect={(key) => {
                if (key === filter) return;
                stopSelecting();
                setFeedback(null);
                list.reset();
                setFilter(key);
              }}
            />
            {!selecting && ctx && hasPhotos ? (
              <View style={styles.barRow}>
                <SmallButton
                  title="Selecteer"
                  icon="check"
                  onPress={() => {
                    setFeedback(null);
                    setSelecting(true);
                  }}
                />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.column}>
            {loading || (withoutAlbum && !list.isDone) ? (
              <LoadingState label="Foto's laden…" />
            ) : withoutAlbum ? (
              <EmptyState icon="photos" title="Alles staat in een album" text="Je hebt geen foto's buiten een album." />
            ) : (
              <EmptyState icon="photos" title="Nog geen foto's hier" text="Foto's die je toevoegt, zie je hier." />
            )}
          </View>
        }
        ListFooterComponent={hasPhotos && list.loadingMore ? <LoadingState /> : undefined}
        renderItem={({ item }) => {
          const photo = menuPhotoOf(item);
          const hasMenu = !selecting && menuActions(ctx, photo, null).length > 0;
          return (
            <MyTile
              photo={item}
              size={tile}
              selected={selecting ? picked.has(item._id) : undefined}
              onPress={() =>
                selecting
                  ? toggle(item._id)
                  : router.push(myPhotoPath(item._id, { withoutAlbum, loaded: list.limit }))
              }
              onMenu={hasMenu ? () => menu.open(photo) : undefined}
            />
          );
        }}
        initialNumToRender={columns * 6}
        windowSize={5}
        removeClippedSubviews
      />
      <AlbumChoiceSheet
        visible={choosing}
        onClose={() => setChoosing(false)}
        onChoose={(target) => {
          setChoosing(false);
          runSelection("addToAlbum", selected, target);
        }}
      />
      {selecting ? (
        <SelectionBar
          count={selected.length}
          busy={selectionBusy}
          onAddToAlbum={() => setChoosing(true)}
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

export function menuPhotoOf(photo: MyPhoto): MenuPhoto {
  // Geen album: "toegevoegd door" is hier niet van toepassing.
  return {
    photoId: photo._id,
    ownerId: photo.ownerId,
    addedBy: photo.ownerId,
    hasFormats: photo.hasFormats,
    exifOrientation: photo.exifOrientation,
  };
}

function SelectionBar({
  count,
  busy,
  onAddToAlbum,
  onDelete,
  onCancel,
}: {
  count: number;
  busy: boolean;
  onAddToAlbum: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const none = count === 0;
  const status = busy ? "Bezig…" : none ? "Tik op foto's om ze te kiezen" : `${count} geselecteerd`;
  return (
    <BottomPanel>
      <Text variant="bodyStrong" accessibilityLiveRegion="polite">
        {status}
      </Text>
      <View style={styles.barRow}>
        <SmallButton
          title="Naar album"
          icon="plus"
          accessibilityLabel="Toevoegen aan album"
          onPress={onAddToAlbum}
          disabled={none || busy}
        />
        <SmallButton title="Verwijderen" icon="trash" tone="danger" onPress={onDelete} disabled={none || busy} />
        <SmallButton title="Annuleren" onPress={onCancel} disabled={busy} />
      </View>
    </BottomPanel>
  );
}

function Separator() {
  return <View style={{ height: GAP }} />;
}

function MyTile({
  photo,
  size: tile,
  selected,
  onPress,
  onMenu,
}: {
  photo: MyPhoto;
  size: number;
  selected?: boolean;
  onPress: () => void;
  onMenu?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Foto van ${formatPhotoDate(photo)}`}
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
        photoId={photo._id as Id<"photos">}
        format="klein"
        exifOrientation={photo.exifOrientation}
        hasFormats={photo.hasFormats}
        box={{ width: tile, height: tile }}
      />
      {selected !== undefined && <SelectMark selected={selected} />}
    </Pressable>
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
  header: { paddingVertical: space.l, gap: space.m },
  barRow: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  pressed: { opacity: 0.7 },
});
