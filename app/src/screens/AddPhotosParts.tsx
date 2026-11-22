import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { QueryBoundary } from "../components/QueryBoundary";
import { SmallButton } from "../components/SmallButton";
import { LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useMyGroups } from "../data/homeGroupState";
import { useLiveQuery } from "../data/useLiveQuery";
import { batchSummary, photoCountText, reasonText, type UploadItem } from "../lib/upload";
import { radius, space, useTheme } from "../theme";

// WP18: de delen van "Toevoegen" die iOS en het web (WP36,
// AddPhotosScreen.web.tsx) delen: de uitkomst van een ronde en de keuze van
// het album. Ongewijzigd verplaatst uit AddPhotosScreen.tsx.
//
// WP39: "Meer selecteren" na een ronde (was "Meer foto's"): een nieuwe keuze.
// `idle`: niets anders loopt nog (op iOS de filmpjes); pas dan "Naar album"
// en "Meer selecteren" (invariant 2: de modaal sluit niet tijdens een ronde).

export type ChosenAlbum = { albumId: string; groupId: string; label: string } | null;
type Chosen = { album: ChosenAlbum };

export function RoundResult({
  items,
  albumLabel,
  busy,
  onRetry,
  onToAlbum,
  onMore,
  idle = true,
}: {
  items: UploadItem[];
  albumLabel: string;
  busy: boolean;
  onRetry: () => void;
  onToAlbum: () => void;
  onMore: () => void;
  idle?: boolean;
}) {
  const s = batchSummary(items);
  return (
    <View style={styles.section}>
      <Text variant="bodyStrong" accessibilityLiveRegion="polite">
        {s.done
          ? `${s.klaar} van ${photoCountText(s.total)} in het album`
          : `Bezig… ${s.klaar} van ${photoCountText(s.total)} in het album`}
      </Text>
      {s.done && s.allInAlbum && (
        <Notice kind="success" message={`${photoCountText(s.total)} toegevoegd aan ${albumLabel}.`} />
      )}
      {s.done && s.mislukt > 0 && (
        <Notice kind="error" title={`${photoCountText(s.mislukt)} niet gelukt`}>
          {s.reasons.map((r) => (
            <Text key={r.reason} variant="meta">{`${reasonText(r.reason)} (${r.count})`}</Text>
          ))}
        </Notice>
      )}
      {s.done && s.retryable > 0 && (
        <Button title="Opnieuw proberen" icon="refresh" onPress={onRetry} disabled={busy} />
      )}
      {s.done && idle && (
        <View style={styles.row}>
          {s.klaar > 0 && <SmallButton title="Naar album" onPress={onToAlbum} />}
          <SmallButton title="Meer selecteren" icon="plus" onPress={onMore} />
        </View>
      )}
    </View>
  );
}

type MyGroup = FunctionReturnType<typeof api.groups.listMine>[number];
type Album = FunctionReturnType<typeof api.albums.listByGroup>[number];

// Per eigen groep de albums (invariant 5). Geen "Nieuw album" (Groepsbeheer).
export function AlbumChoice({
  initialAlbumId,
  selected,
  onSelect,
  locked,
}: {
  initialAlbumId: string | null;
  selected: Chosen["album"];
  onSelect: (album: Chosen["album"]) => void;
  locked: boolean;
}) {
  // WP39: na het weghalen van alles komt de albumkeuze terug met het gekozen
  // album; dan niet opengeklapt.
  const [open, setOpen] = useState(initialAlbumId === null && selected === null);
  return (
    <View style={styles.section}>
      <Text variant="fieldLabel">Album</Text>
      {selected ? (
        <View style={styles.row}>
          <Text style={styles.grow}>{selected.label}</Text>
          {!locked && !open && <SmallButton title="Wijzig" onPress={() => setOpen(true)} />}
        </View>
      ) : initialAlbumId && !open ? (
        <QueryBoundary
          fallback={() => (
            <InitialAlbumGone onChoose={() => setOpen(true)} />
          )}
        >
          <InitialAlbum albumId={initialAlbumId} onSelect={onSelect} onChoose={() => setOpen(true)} />
        </QueryBoundary>
      ) : (
        <Text color="muted">Kies een album</Text>
      )}
      {open && !locked && (
        <QueryBoundary
          fallback={(_e, reset) => (
            <Notice kind="error" title="Je albums laden lukt niet">
              <SmallButton title="Opnieuw" icon="refresh" onPress={reset} />
            </Notice>
          )}
        >
          <AlbumList
            selectedId={selected?.albumId ?? null}
            onSelect={(a) => {
              onSelect(a);
              setOpen(false);
            }}
          />
        </QueryBoundary>
      )}
    </View>
  );
}

function InitialAlbum({
  albumId,
  onSelect,
  onChoose,
}: {
  albumId: string;
  onSelect: (album: Chosen["album"]) => void;
  onChoose: () => void;
}) {
  const row = useLiveQuery(api.albums.getWithGroup, { albumId: albumId as Album["_id"] });
  useEffect(() => {
    if (!row) return;
    onSelect({
      albumId: row._id,
      groupId: row.groupId,
      label: row.group ? `${row.group.name} · ${row.name}` : row.name,
    });
  }, [row?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!row) return <LoadingState label="Album laden…" />;
  return <SmallButton title="Ander album kiezen" onPress={onChoose} />;
}

function InitialAlbumGone({ onChoose }: { onChoose: () => void }) {
  return (
    <Notice kind="error" message={reasonText("geen_album")}>
      <SmallButton title="Kies een album" onPress={onChoose} />
    </Notice>
  );
}

function AlbumList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (album: NonNullable<Chosen["album"]>) => void;
}) {
  const groups = useMyGroups();
  if (groups === undefined) return <LoadingState label="Groepen laden…" />;
  if (groups.length === 0) {
    return <Text color="muted">Je bent nog geen lid van een groep, dus er is geen album om in te uploaden.</Text>;
  }
  return (
    <View style={styles.section}>
      {[...groups]
        .sort((a, b) => a.name.localeCompare(b.name, "nl"))
        .map((g) => (
          <GroupAlbums key={g._id} group={g} selectedId={selectedId} onSelect={onSelect} />
        ))}
    </View>
  );
}

function GroupAlbums({
  group,
  selectedId,
  onSelect,
}: {
  group: MyGroup;
  selectedId: string | null;
  onSelect: (album: NonNullable<Chosen["album"]>) => void;
}) {
  const { colors } = useTheme();
  const albums = useLiveQuery(api.albums.listByGroup, { groupId: group._id });
  return (
    <View style={styles.group}>
      <Text variant="albumName" color="muted">
        {group.name}
      </Text>
      {albums === undefined ? (
        <LoadingState />
      ) : albums.length === 0 ? (
        <Text variant="meta" color="muted">
          Nog geen albums
        </Text>
      ) : (
        <View style={[styles.list, { backgroundColor: colors.surface }]}>
          {[...albums]
            .sort((a, b) => (b.sortDate ?? b.createdAt) - (a.sortDate ?? a.createdAt))
            .map((a, i) => {
              const chosen = a._id === selectedId;
              return (
                <Pressable
                  key={a._id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: chosen }}
                  accessibilityLabel={`${a.name}, ${group.name}`}
                  onPress={() =>
                    onSelect({ albumId: a._id, groupId: a.groupId, label: `${group.name} · ${a.name}` })
                  }
                  style={({ pressed }) => [
                    styles.albumRow,
                    i > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.grow}>{a.name}</Text>
                  {chosen && <Icon name="check" color={colors.primary} filled />}
                </Pressable>
              );
            })}
        </View>
      )}
    </View>
  );
}

export const THUMB = 64;

const styles = StyleSheet.create({
  section: { gap: space.s },
  group: { gap: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.s, flexWrap: "wrap" },
  grow: { flex: 1 },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.albumTile / 2, overflow: "hidden" },
  thumbImage: { width: THUMB, height: THUMB },
  more: { alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    right: 2,
    bottom: 2,
    borderRadius: radius.pill,
    padding: 1,
  },
  list: { borderRadius: radius.listBlock, overflow: "hidden" },
  albumRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.l,
    gap: space.s,
  },
  pressed: { opacity: 0.6 },
});


export { styles as addPhotosStyles };
