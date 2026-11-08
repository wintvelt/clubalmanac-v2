import type { FunctionReturnType } from "convex/server";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router, Stack, useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { SmallButton } from "../components/SmallButton";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useUploader } from "../data/upload";
import { useLiveQuery } from "../data/useLiveQuery";
import { albumPath } from "../lib/groupRoutes";
import {
  UPLOAD_PARALLEL,
  applyOutcome,
  batchSummary,
  newBatch,
  photoCountText,
  reasonText,
  retryBatch,
  startItem,
  type UploadItem,
  type UploadOutcome,
} from "../lib/upload";
import { CloseButton } from "../navigation/stackOptions";
import { radius, space, useTheme } from "../theme";

// WP18: de modaal "Foto's toevoegen". De kiezer opent meteen; de user kiest
// het album (vooraf ingevuld vanuit het album waar de "+" werd ingedrukt) en
// uploadt. Per foto één upload-id, gelijk bij opnieuw proberen (invariant 1).
// Na de ronde per reden met aantal wat niet lukte, en "Opnieuw proberen"
// voor wat kan lukken (invariant 2). Tijdens een ronde blijft het scherm
// wakker en sluit de modaal niet (besluit 3); album en keuze liggen vast.
//
// Toestemming (A-kernvondst 7): de systeemkiezer van iOS vraagt er geen. Lukt
// het openen toch niet, dan legt het scherm uit waarom en linkt het naar
// Instellingen (invariant 11).

const KEEP_AWAKE_TAG = "wp18-upload";
const THUMBS = 7;

type Chosen = { album: { albumId: string; groupId: string; label: string } | null };
type Picked = { key: string; asset: ImagePicker.ImagePickerAsset };

let pickRound = 0;

export function AddPhotosScreen({ albumId }: { albumId?: string }) {
  const upload = useUploader();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [pickerFailed, setPickerFailed] = useState(false);
  const [album, setAlbum] = useState<Chosen["album"]>(null);
  const [initialAlbumId] = useState(albumId ?? null);
  const [items, setItems] = useState<UploadItem[] | null>(null);
  const itemsRef = useRef<UploadItem[] | null>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const opened = useRef(false);

  function update(next: UploadItem[]) {
    itemsRef.current = next;
    setItems(next);
  }

  async function pick() {
    setPickerFailed(false);
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: 0,
        orderedSelection: true,
        exif: true,
        quality: 1,
      });
    } catch {
      setPickerFailed(true);
      return;
    }
    if (result.canceled) return;
    // Opnieuw kiezen vervangt de keuze; een nieuwe keuze is een nieuwe ronde.
    pickRound += 1;
    const assets = result.assets.filter((a) => a.type !== "video" && a.type !== "pairedVideo");
    setPicked(assets.map((asset, i) => ({ key: `${pickRound}-${i}`, asset })));
    itemsRef.current = null;
    setItems(null);
  }

  // De kiezer opent meteen, maar pas als de modaal staat: tijdens het openen
  // weigert iOS een tweede scherm te tonen, en dan komt de kiezer nooit terug
  // (gezien in de simulator). Valt `transitionEnd` weg, dan na een seconde.
  const navigation = useNavigation();
  useEffect(() => {
    const open = () => {
      if (opened.current) return;
      opened.current = true;
      void pick();
    };
    const unsubscribe = navigation.addListener(
      "transitionEnd" as never,
      ((e: { data?: { closing?: boolean } }) => {
        if (!e?.data?.closing) open();
      }) as never,
    );
    const fallback = setTimeout(open, 1000);
    return () => {
      unsubscribe();
      clearTimeout(fallback);
    };
  }, [navigation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zolang een ronde loopt, blijft het scherm aan (besluit 3).
  useEffect(() => {
    if (!busy) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [busy]);

  // `fresh`: de foto's die eerder "uitgelogd" kregen; die halen een vers token.
  async function runRound(start: UploadItem[], fresh: ReadonlySet<string> = new Set()) {
    // Een tweede tik start niets.
    if (running.current || !album) return;
    running.current = true;
    setBusy(true);
    update(start);
    const target = album.albumId;
    const assets = new Map(picked.map((p) => [p.key, p.asset]));
    const worker = async () => {
      for (;;) {
        const current = itemsRef.current ?? [];
        const next = current.find((i) => i.state === "wacht");
        if (!next) return;
        update(startItem(current, next.key));
        const asset = assets.get(next.key);
        let outcome: UploadOutcome;
        try {
          outcome = asset
            ? await upload({
                asset,
                uploadId: next.uploadId,
                albumId: target,
                freshToken: fresh.has(next.key),
              })
            : { ok: false, reason: "geen_foto" };
        } catch {
          // Geen foto blijft op "bezig" hangen (invariant 2).
          outcome = { ok: false, reason: "server" };
        }
        update(applyOutcome(itemsRef.current ?? [], next.key, outcome));
      }
    };
    try {
      await Promise.all(Array.from({ length: UPLOAD_PARALLEL }, worker));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function startUpload() {
    void runRound(newBatch(picked.map((p) => p.key)));
  }

  function retry() {
    const current = itemsRef.current;
    if (!current) return;
    const fresh = new Set(current.filter((i) => i.reason === "uitgelogd").map((i) => i.key));
    void runRound(retryBatch(current), fresh);
  }

  function toAlbum() {
    if (!album) return;
    const path = albumPath(album.groupId, album.albumId);
    router.dismiss();
    router.push(path);
  }

  function morePhotos() {
    setPicked([]);
    setItems(null);
    itemsRef.current = null;
    void pick();
  }

  const inRound = items !== null && items.length > 0;

  return (
    <Screen underHeader>
      {/* Tijdens een ronde sluit de modaal niet: geen "Sluiten", geen veeggebaar. */}
      <Stack.Screen
        options={{
          gestureEnabled: !busy,
          headerRight: busy ? () => null : () => <CloseButton />,
        }}
      />

      {pickerFailed && (
        <Notice kind="error" title="Toegang tot je foto's nodig">
          <Text variant="meta">
            Clubalmanac kan je foto's niet openen. Geef in Instellingen toegang tot je foto's, dan kun je ze
            hier kiezen.
          </Text>
          <SmallButton title="Instellingen openen" onPress={() => void Linking.openSettings()} />
        </Notice>
      )}

      {picked.length === 0 && !pickerFailed ? (
        <EmptyState icon="photos" title="Kies foto's" text="Kies een of meer foto's om aan een album toe te voegen." />
      ) : null}

      {picked.length > 0 && (
        <View style={styles.section}>
          <Text variant="bodyStrong">{`${photoCountText(picked.length)} geselecteerd`}</Text>
          <Thumbs picked={picked} items={items} />
        </View>
      )}

      {!inRound && (
        <SmallButton
          title={picked.length > 0 ? "Andere foto's kiezen" : "Foto's kiezen"}
          icon="photos"
          onPress={() => void pick()}
        />
      )}

      {picked.length > 0 && (
        <AlbumChoice
          initialAlbumId={initialAlbumId}
          selected={album}
          onSelect={setAlbum}
          locked={inRound}
        />
      )}

      {!inRound && picked.length > 0 && (
        <Button
          title="Foto's uploaden"
          icon="plus"
          variant="cta"
          disabled={!album}
          onPress={startUpload}
        />
      )}

      {inRound && items && (
        <RoundResult
          items={items}
          albumLabel={album?.label ?? ""}
          busy={busy}
          onRetry={retry}
          onToAlbum={toAlbum}
          onMore={morePhotos}
        />
      )}
    </Screen>
  );
}

function Thumbs({ picked, items }: { picked: Picked[]; items: UploadItem[] | null }) {
  const { colors } = useTheme();
  const state = new Map((items ?? []).map((i) => [i.key, i.state]));
  // In een ronde alle foto's met hun stand; daarvoor de eerste 7 en "+ n".
  const shown = items && items.length > 0 ? picked : picked.slice(0, THUMBS);
  const rest = picked.length - shown.length;
  return (
    <View style={styles.thumbs}>
      {shown.map((p) => {
        const s = state.get(p.key);
        return (
          <View key={p.key} style={styles.thumb}>
            <Image source={{ uri: p.asset.uri }} style={styles.thumbImage} contentFit="cover" />
            {s && s !== "wacht" && (
              <View style={[styles.badge, { backgroundColor: colors.surface }]}>
                {s === "bezig" ? (
                  <Icon name="refresh" size={18} color={colors.muted} />
                ) : (
                  <Icon
                    name={s === "klaar" ? "check" : "alert"}
                    size={18}
                    color={s === "klaar" ? colors.success : colors.danger}
                  />
                )}
              </View>
            )}
          </View>
        );
      })}
      {rest > 0 && (
        <View style={[styles.thumb, styles.more, { backgroundColor: colors.line }]}>
          <Text variant="bodyStrong">{`+ ${rest}`}</Text>
        </View>
      )}
    </View>
  );
}

function RoundResult({
  items,
  albumLabel,
  busy,
  onRetry,
  onToAlbum,
  onMore,
}: {
  items: UploadItem[];
  albumLabel: string;
  busy: boolean;
  onRetry: () => void;
  onToAlbum: () => void;
  onMore: () => void;
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
      {s.done && (
        <View style={styles.row}>
          {s.klaar > 0 && <SmallButton title="Naar album" onPress={onToAlbum} />}
          <SmallButton title="Meer foto's" icon="plus" onPress={onMore} />
        </View>
      )}
    </View>
  );
}

type MyGroup = FunctionReturnType<typeof api.groups.listMine>[number];
type Album = FunctionReturnType<typeof api.albums.listByGroup>[number];

// Per eigen groep de albums (invariant 5). Geen "Nieuw album" (Groepsbeheer).
function AlbumChoice({
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
  const [open, setOpen] = useState(initialAlbumId === null);
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
  const groups = useLiveQuery(api.groups.listMine, {});
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

const THUMB = 64;

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
