import type { FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Id } from "../../../convex/_generated/dataModel";
import { Icon } from "../components/Icon";
import { ListSection } from "../components/ListRow";
import { QueryBoundary } from "../components/QueryBoundary";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useMyGroups } from "../data/homeGroupState";
import { useLiveQuery } from "../data/useLiveQuery";
import { albumChoices } from "../lib/myPhotos";
import { radius, size, space, useTheme } from "../theme";
import { AlbumCoverTile, LoadError } from "./GroupParts";

type Group = FunctionReturnType<typeof api.groups.listMine>[number];
type Album = FunctionReturnType<typeof api.albums.listByGroup>[number];

// WP17c A-invariant 12: "Kies album". De albums van je eigen groepen, per
// groep in de volgorde van Mijn groepen, binnen een groep die van het
// groepsscherm; lege groepen weg, en het album waar je vandaan komt, staat er
// niet in. Een sheet over het scherm, zodat de selectie eronder blijft staan.
//
// WP39 fixronde gate 1 (besluit 1, F5): ook het kiesscherm van "Toevoegen".
// Elk album met omslag (of letter) en naam; `selectedAlbumId` krijgt een
// vinkje. `onChoose` geeft er groep en naam ("Groep · Album") bij.
export type AlbumChoiceInfo = { groupId: Id<"groups">; label: string };

// WP42 A14: op iOS is het blad een pageSheet onder de statusbalk; op Android
// vult de Modal het scherm (edge-to-edge), dus ook de rand bovenaan.
const EDGES = Platform.OS === "android" ? (["top", "left", "right", "bottom"] as const) : (["left", "right", "bottom"] as const);

export function AlbumChoiceSheet({
  visible,
  fromAlbumId,
  selectedAlbumId,
  onChoose,
  onClose,
}: {
  visible: boolean;
  fromAlbumId?: Id<"albums">;
  selectedAlbumId?: string | null;
  onChoose: (albumId: Id<"albums">, info: AlbumChoiceInfo) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView edges={EDGES} style={[styles.fill, { backgroundColor: colors.bg }]}>
        <View style={[styles.header, { borderBottomColor: colors.line }]}>
          <Text variant="bodyStrong" accessibilityRole="header" style={styles.title}>
            Kies album
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={space.s} style={styles.close}>
            <Text variant="button" color="primary">
              Annuleren
            </Text>
          </Pressable>
        </View>
        {visible ? (
          <QueryBoundary
            fallback={(_error, reset) => (
              <View style={styles.column}>
                <LoadError title="De albums laden lukt niet" onRetry={reset} />
              </View>
            )}
          >
            <Choices fromAlbumId={fromAlbumId} selectedAlbumId={selectedAlbumId ?? null} onChoose={onChoose} />
          </QueryBoundary>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function Choices({
  fromAlbumId,
  selectedAlbumId,
  onChoose,
}: {
  fromAlbumId?: Id<"albums">;
  selectedAlbumId: string | null;
  onChoose: (albumId: Id<"albums">, info: AlbumChoiceInfo) => void;
}) {
  const groups = useMyGroups();
  // Per groep een eigen live query (het aantal groepen wisselt); elke groep
  // meldt zijn albums hier.
  const [byGroup, setByGroup] = useState<ReadonlyMap<string, readonly Album[]>>(new Map());
  const report = useCallback((groupId: string, albums: readonly Album[]) => {
    setByGroup((before) => {
      if (before.get(groupId) === albums) return before;
      const next = new Map(before);
      next.set(groupId, albums);
      return next;
    });
  }, []);

  const loaded = groups !== undefined && groups.every((g) => byGroup.has(g._id));
  const sections = useMemo(() => {
    if (!groups) return [];
    const albums = groups.flatMap((g) => byGroup.get(g._id) ?? []);
    return albumChoices<Group, Album>({ groups, albums, fromAlbumId });
  }, [groups, byGroup, fromAlbumId]);

  return (
    <ScrollView contentContainerStyle={[styles.column, styles.list]}>
      {groups?.map((g) => <GroupAlbums key={g._id} groupId={g._id} onLoad={report} />)}
      {!loaded ? (
        <LoadingState label="Albums laden…" />
      ) : groups.length === 0 ? (
        <EmptyState
          icon="photos"
          title="Geen album om te kiezen"
          text="Je bent nog geen lid van een groep, dus er is geen album om te kiezen."
        />
      ) : sections.length === 0 ? (
        <EmptyState
          icon="photos"
          title="Geen album om te kiezen"
          text={fromAlbumId ? "In je groepen staat nog geen ander album." : "In je groepen staat nog geen album."}
        />
      ) : (
        sections.map(({ group, albums }) => (
          <View key={group._id} style={styles.section}>
            <Text variant="meta" color="muted" accessibilityRole="header">
              {group.name}
            </Text>
            <ListSection>
              {albums.map((a) => (
                <AlbumRow
                  key={a._id}
                  album={a}
                  groupName={group.name}
                  chosen={a._id === selectedAlbumId}
                  onPress={() => onChoose(a._id, { groupId: a.groupId, label: `${group.name} · ${a.name}` })}
                />
              ))}
            </ListSection>
          </View>
        ))
      )}
    </ScrollView>
  );
}

// Een album: omslag (of letter), naam, en een vinkje als het gekozen is.
function AlbumRow({
  album,
  groupName,
  chosen,
  onPress,
}: {
  album: Album;
  groupName: string;
  chosen: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${album.name}, ${groupName}`}
      accessibilityState={{ selected: chosen }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.line }]}
    >
      <View accessible={false} importantForAccessibility="no-hide-descendants">
        <AlbumCoverTile
          albumId={album._id}
          coverPhotoId={album.coverPhotoId}
          name={album.name}
          size={ROW_TILE}
          radius={radius.albumTile / 2}
        />
      </View>
      <Text variant="listRow" style={styles.title}>
        {album.name}
      </Text>
      {chosen && <Icon name="check" color={colors.primary} filled />}
    </Pressable>
  );
}

const ROW_TILE = 44;

// Laadt de albums van één groep en meldt ze; toont zelf niets.
function GroupAlbums({
  groupId,
  onLoad,
}: {
  groupId: Id<"groups">;
  onLoad: (groupId: string, albums: readonly Album[]) => void;
}) {
  const albums = useLiveQuery(api.albums.listByGroup, { groupId });
  useEffect(() => {
    if (albums) onLoad(groupId, albums);
  }, [albums, groupId, onLoad]);
  return null;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: size.touchMin + space.m,
    paddingHorizontal: size.screenMargin,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1 },
  close: { minHeight: size.touchMin, justifyContent: "center" },
  column: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
  },
  list: { paddingVertical: space.l, gap: space.l },
  section: { gap: space.s },
  row: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
  },
});
