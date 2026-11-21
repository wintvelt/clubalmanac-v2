import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router, Stack, useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { Screen } from "../components/Screen";
import { SmallButton } from "../components/SmallButton";
import { EmptyState } from "../components/States";
import { Text } from "../components/Text";
import { useUploader } from "../data/upload";
import { useVideoUploader, type VideoProgress } from "../data/videoUpload";
import { successTap } from "../data/haptics";
import { albumPath } from "../lib/groupRoutes";
import {
  UPLOAD_PARALLEL,
  albumBatch,
  applyOutcome,
  batchSummary,
  photoCountText,
  retryBatch,
  startItem,
  type UploadItem,
  type UploadOutcome,
} from "../lib/upload";
import { formatDuration, videoFailMessage, videoRetryable, videoTooLong, type VideoFailReason } from "../lib/videos";
import { CloseButton } from "../navigation/stackOptions";
import { useTheme } from "../theme";
import { AlbumChoice, RoundResult, addPhotosStyles as styles, type ChosenAlbum } from "./AddPhotosParts";

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
//
// WP37: ook filmpjes (hooguit 3 minuten). Elk filmpje wordt op het toestel
// verkleind, krijgt een poster en gaat naar R2 (src/data/videoUpload.ts), één
// tegelijk, naast de foto's. Per filmpje de stap en de voortgang, en bij een
// fout de NL-reden met "Opnieuw proberen" waar dat zin heeft (invariant 5).
// Dezelfde upload-id bij opnieuw proberen: geen tweede filmpje (invariant 4).
// Verkleinen kan alleen met de app open (besluit B11): het scherm blijft aan.

const KEEP_AWAKE_TAG = "wp18-upload";
const THUMBS = 7;

type Chosen = { album: ChosenAlbum };
type Picked = { key: string; asset: ImagePicker.ImagePickerAsset };

// WP37: een filmpje in een ronde.
type VideoItem = {
  key: string;
  uploadId: string;
  state: "wacht" | "bezig" | "klaar" | "mislukt";
  reason?: VideoFailReason;
  progress?: VideoProgress;
};

function selectionText(photos: number, videos: number): string {
  const parts = [photos > 0 ? photoCountText(photos) : null, videos > 0 ? videoCountText(videos) : null];
  return `${parts.filter(Boolean).join(" en ")} geselecteerd`;
}

function videoCountText(n: number): string {
  return n === 1 ? "1 filmpje" : `${n} filmpjes`;
}

let pickRound = 0;

export function AddPhotosScreen({ albumId }: { albumId?: string }) {
  const upload = useUploader();
  const uploadVideo = useVideoUploader();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [videos, setVideos] = useState<Picked[]>([]);
  const [videoItems, setVideoItems] = useState<VideoItem[] | null>(null);
  const videoItemsRef = useRef<VideoItem[] | null>(null);
  const videoRunning = useRef(false);
  const [videoBusy, setVideoBusy] = useState(false);
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

  function updateVideos(next: VideoItem[] | null) {
    videoItemsRef.current = next;
    setVideoItems(next);
  }

  function patchVideo(key: string, patch: Partial<VideoItem>) {
    updateVideos((videoItemsRef.current ?? []).map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  async function pick() {
    setPickerFailed(false);
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        // WP37: ook filmpjes. De standaard export (Passthrough) geeft het
        // origineel, met zijn datum en plaats (besluit B2).
        mediaTypes: ["images", "videos"],
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
    const clips = result.assets.filter((a) => a.type === "video");
    setVideos(clips.map((asset, i) => ({ key: `${pickRound}-v${i}`, asset })));
    itemsRef.current = null;
    setItems(null);
    updateVideos(null);
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

  // Zolang een ronde loopt, blijft het scherm aan (besluit 3; WP37 B11: ook
  // tijdens het verkleinen van een filmpje).
  const anyBusy = busy || videoBusy;
  useEffect(() => {
    if (!anyBusy) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [anyBusy]);

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
      // WP33 invariant 10: de groene melding "… toegevoegd aan …" verschijnt
      // (alle foto's in het album, ook na "Opnieuw"). Deels mislukt: geen tik.
      const s = batchSummary(itemsRef.current ?? []);
      if (s.done && s.allInAlbum) successTap();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  // WP37: de filmpjes één voor één. `fresh`: na "uitgelogd" een vers token.
  async function runVideos(start: VideoItem[]) {
    if (videoRunning.current || !album) return;
    videoRunning.current = true;
    setVideoBusy(true);
    updateVideos(start);
    const target = album.albumId;
    const assets = new Map(videos.map((v) => [v.key, v.asset]));
    try {
      for (;;) {
        const next = (videoItemsRef.current ?? []).find((i) => i.state === "wacht");
        if (!next) break;
        patchVideo(next.key, { state: "bezig", reason: undefined, progress: undefined });
        const asset = assets.get(next.key);
        let outcome: Awaited<ReturnType<typeof uploadVideo>>;
        try {
          outcome = asset
            ? await uploadVideo({
                asset,
                uploadId: next.uploadId,
                albumId: target,
                onProgress: (progress) => patchVideo(next.key, { progress }),
              })
            : { ok: false, reason: "server" };
        } catch {
          // Geen filmpje blijft op "bezig" hangen (invariant 5).
          outcome = { ok: false, reason: "server" };
        }
        patchVideo(
          next.key,
          outcome.ok
            ? { state: "klaar", progress: undefined }
            : { state: "mislukt", reason: outcome.reason, progress: undefined },
        );
      }
    } finally {
      videoRunning.current = false;
      setVideoBusy(false);
    }
  }

  // A-invariant 25: dezelfde foto voor hetzelfde album houdt zijn upload-id,
  // ook in een nieuwe ronde ("Meer foto's", de modaal opnieuw openen). WP37:
  // een filmpje ook (invariant 4).
  function startUpload() {
    if (!album) return;
    const picks = picked.map((p) => ({ key: p.key, assetId: p.asset.assetId }));
    const clips = albumBatch(
      videos.map((v) => ({ key: v.key, assetId: v.asset.assetId })),
      album.albumId,
    ).map((i): VideoItem => {
      const duration = videos.find((v) => v.key === i.key)?.asset.duration;
      // Te lang: meteen zeggen, niet eerst verkleinen.
      return typeof duration === "number" && videoTooLong(duration)
        ? { key: i.key, uploadId: i.uploadId, state: "mislukt", reason: "te_lang" }
        : { key: i.key, uploadId: i.uploadId, state: "wacht" };
    });
    if (clips.length > 0) void runVideos(clips);
    if (picks.length > 0) void runRound(albumBatch(picks, album.albumId));
  }

  function retryVideos() {
    const current = videoItemsRef.current;
    if (!current) return;
    void runVideos(
      current.map((i) =>
        i.state === "mislukt" && i.reason !== undefined && videoRetryable(i.reason)
          ? { key: i.key, uploadId: i.uploadId, state: "wacht" }
          : i,
      ),
    );
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
    setVideos([]);
    setItems(null);
    itemsRef.current = null;
    updateVideos(null);
    void pick();
  }

  const inRound = (items !== null && items.length > 0) || (videoItems !== null && videoItems.length > 0);
  const anyPicked = picked.length > 0 || videos.length > 0;
  const uploadTitle = videos.length === 0 ? "Foto's uploaden" : picked.length === 0 ? "Filmpjes uploaden" : "Uploaden";

  return (
    <Screen underHeader>
      {/* Tijdens een ronde sluit de modaal niet: geen "Sluiten", geen veeggebaar. */}
      <Stack.Screen
        options={{
          gestureEnabled: !anyBusy,
          headerRight: anyBusy ? () => null : () => <CloseButton />,
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

      {!anyPicked && !pickerFailed ? (
        <EmptyState
          icon="photos"
          title="Kies foto's"
          text="Kies een of meer foto's of filmpjes (hooguit 3 minuten) om aan een album toe te voegen."
        />
      ) : null}

      {anyPicked && (
        <View style={styles.section}>
          <Text variant="bodyStrong">{selectionText(picked.length, videos.length)}</Text>
          {picked.length > 0 && <Thumbs picked={picked} items={items} />}
          {videos.length > 0 && <VideoList videos={videos} items={videoItems} />}
        </View>
      )}

      {!inRound && (
        <SmallButton
          title={anyPicked ? "Andere foto's kiezen" : "Foto's kiezen"}
          icon="photos"
          onPress={() => void pick()}
        />
      )}

      {anyPicked && (
        <AlbumChoice
          initialAlbumId={initialAlbumId}
          selected={album}
          onSelect={setAlbum}
          locked={inRound}
        />
      )}

      {!inRound && anyPicked && (
        <Button
          title={uploadTitle}
          icon="plus"
          variant="cta"
          disabled={!album}
          onPress={startUpload}
        />
      )}

      {inRound && videoItems && videoItems.length > 0 && (
        <VideoRoundResult
          items={videoItems}
          busy={videoBusy}
          albumLabel={album?.label ?? ""}
          // Zonder foto's in de ronde staan "Naar album" en "Meer" hier.
          standalone={!items || items.length === 0}
          onRetry={retryVideos}
          onToAlbum={toAlbum}
          onMore={morePhotos}
        />
      )}

      {inRound && items && items.length > 0 && (
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

// WP37: de gekozen filmpjes, met hun stap tijdens een ronde.
function VideoList({ videos, items }: { videos: Picked[]; items: VideoItem[] | null }) {
  const { colors } = useTheme();
  const byKey = new Map((items ?? []).map((i) => [i.key, i]));
  return (
    <View style={videoStyles.list}>
      {videos.map((v, n) => {
        const item = byKey.get(v.key);
        const duration = typeof v.asset.duration === "number" ? formatDuration(v.asset.duration) : null;
        return (
          <View key={v.key} style={videoStyles.row} accessible accessibilityLabel={videoRowLabel(n, duration, item)}>
            <Icon name="film" size={22} color={colors.muted} />
            <Text style={videoStyles.grow}>{[`Filmpje ${n + 1}`, duration].filter(Boolean).join(" · ")}</Text>
            {item && <Text variant="meta" color={item.state === "mislukt" ? "danger" : "muted"}>{videoStateText(item)}</Text>}
          </View>
        );
      })}
    </View>
  );
}

function videoStateText(item: VideoItem): string {
  switch (item.state) {
    case "wacht":
      return "Wacht";
    case "klaar":
      return "In het album";
    case "mislukt":
      return "Niet gelukt";
    case "bezig": {
      const p = item.progress;
      if (!p || p.phase === "voorbereiden") return "Voorbereiden…";
      const pct = `${Math.round(Math.min(1, Math.max(0, p.progress)) * 100)}%`;
      if (p.phase === "verkleinen") return `Verkleinen… ${pct}`;
      if (p.phase === "versturen") return `Versturen… ${pct}`;
      return "Afronden…";
    }
  }
}

function videoRowLabel(n: number, duration: string | null, item: VideoItem | undefined): string {
  return [`Filmpje ${n + 1}`, duration, item ? videoStateText(item) : null].filter(Boolean).join(", ");
}

function VideoRoundResult({
  items,
  busy,
  albumLabel,
  standalone,
  onRetry,
  onToAlbum,
  onMore,
}: {
  items: VideoItem[];
  busy: boolean;
  albumLabel: string;
  standalone: boolean;
  onRetry: () => void;
  onToAlbum: () => void;
  onMore: () => void;
}) {
  const done = items.every((i) => i.state === "klaar" || i.state === "mislukt");
  const klaar = items.filter((i) => i.state === "klaar").length;
  const failed = items.filter((i) => i.state === "mislukt");
  const reasons = [...new Set(failed.map((i) => i.reason).filter((r): r is VideoFailReason => r !== undefined))];
  const retryable = failed.some((i) => i.reason !== undefined && videoRetryable(i.reason));
  return (
    <View style={styles.section}>
      {done && klaar === items.length && (
        <Notice kind="success" message={`${videoCountText(klaar)} toegevoegd aan ${albumLabel}.`} />
      )}
      {done && failed.length > 0 && (
        <Notice kind="error" title={`${videoCountText(failed.length)} niet gelukt`}>
          {reasons.map((r) => (
            <Text key={r} variant="meta">
              {videoFailMessage(r)}
            </Text>
          ))}
        </Notice>
      )}
      {done && retryable && (
        <Button title="Filmpjes opnieuw proberen" icon="refresh" onPress={onRetry} disabled={busy} />
      )}
      {done && standalone && (
        <View style={videoStyles.buttons}>
          {klaar > 0 && <SmallButton title="Naar album" onPress={onToAlbum} />}
          <SmallButton title="Meer kiezen" icon="plus" onPress={onMore} />
        </View>
      )}
    </View>
  );
}

const videoStyles = {
  list: { gap: 6 },
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, minHeight: 32 },
  grow: { flex: 1 },
  buttons: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, flexWrap: "wrap" as const },
};
