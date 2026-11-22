import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router, Stack, useNavigation } from "expo-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { makePoster, removeFile } from "../../modules/clubalmanac-video";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { Screen } from "../components/Screen";
import { SmallButton } from "../components/SmallButton";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { useUploader } from "../data/upload";
import { useVideoUploader, type VideoProgress } from "../data/videoUpload";
import { successTap } from "../data/haptics";
import {
  ADD_GRID_GAP,
  addGrid,
  addToSelection,
  removeFromSelection,
  selectionTiles,
  videoStatusText,
  type SelectionItem,
  type SelectionKind,
} from "../lib/addSelection";
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
  type UploadState,
} from "../lib/upload";
import {
  videoFailMessage,
  videoRetryable,
  videoRetryRound,
  videoTooLongToSend,
  type VideoFailReason,
} from "../lib/videos";
import { CloseButton } from "../navigation/stackOptions";
import { photoLayers, radius, size, space, useTheme } from "../theme";
import { AlbumChoice, RoundResult, addPhotosStyles as styles, type ChosenAlbum } from "./AddPhotosParts";

// WP18: de modaal "Toevoegen". De kiezer opent meteen; de user kiest het
// album (vooraf ingevuld vanuit het album waar de "+" werd ingedrukt) en
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
//
// WP39: foto's en filmpjes gelijk, als tegels in een raster zoals het album
// (src/lib/addSelection.ts). "Meer toevoegen" vult de keuze aan (ontdubbeld op
// `assetId`), een × haalt een item weg; beide alleen vóór de ronde. Na een
// ronde begint "Meer toevoegen" een nieuwe keuze; annuleren in de kiezer
// verandert nooit iets (A4). Een filmpje krijgt een omslag uit het origineel
// (`makePoster`, één voor één, tijdelijk, niet terwijl een filmpje verkleind of
// verstuurd wordt; A10, A11). Te lang staat al vóór de
// ronde op de tegel (besluit 5). De kopie van de kiezer van een dubbel gekozen
// of weggehaald item gaat meteen weg (B-besluit 3). "Toevoegen aan album" staat
// vast onderin (B-besluit 4).

const KEEP_AWAKE_TAG = "wp18-upload";

type Asset = ImagePicker.ImagePickerAsset;
type Item = SelectionItem<Asset>;
type Chosen = { album: ChosenAlbum };

// Vóór een ronde vult de kiezer aan; na een ronde begint hij een nieuwe keuze (A4).
type PickMode = "aanvullen" | "nieuw";

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

/**
 * B-besluit 3: de kopie die de kiezer van een asset maakte, weg. Niet als een
 * item dat blijft hetzelfde bestand gebruikt.
 */
function dropCopies(assets: readonly Asset[], keep: readonly Item[]): void {
  const used = new Set(keep.map((i) => i.asset.uri));
  for (const a of assets) if (!used.has(a.uri)) void removeFile(a.uri);
}

export function AddPhotosScreen({ albumId }: { albumId?: string }) {
  const upload = useUploader();
  const uploadVideo = useVideoUploader();
  const [selection, setSelection] = useState<Item[]>([]);
  const selectionRef = useRef<Item[]>([]);
  const [videoItems, setVideoItems] = useState<VideoItem[] | null>(null);
  const videoItemsRef = useRef<VideoItem[] | null>(null);
  const videoRunning = useRef(false);
  const [pickerFailed, setPickerFailed] = useState(false);
  // WP37 A-invariant 38: de kiezer is dicht, maar iOS kopieert de gekozen
  // originelen nog naar de app; zolang "Je keuze ophalen…".
  const [fetching, setFetching] = useState(false);
  const [album, setAlbum] = useState<Chosen["album"]>(null);
  const [initialAlbumId] = useState(albumId ?? null);
  const [items, setItems] = useState<UploadItem[] | null>(null);
  const itemsRef = useRef<UploadItem[] | null>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const opened = useRef(false);
  // Eén kiezer tegelijk, ook terwijl iOS de vorige keuze nog ophaalt.
  const picking = useRef(false);
  const [videoBusy, setVideoBusy] = useState(false);
  // Geen nieuwe omslagen naast het verkleinen en versturen van een filmpje.
  const posters = usePosters(selection, videoBusy);

  function updateSelection(next: Item[]) {
    selectionRef.current = next;
    setSelection(next);
  }

  function update(next: UploadItem[] | null) {
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

  async function pick(mode: PickMode = "aanvullen") {
    // Invariant 2: tijdens een ronde ligt de keuze vast.
    if (running.current || videoRunning.current || picking.current) return;
    picking.current = true;
    setPickerFailed(false);
    setFetching(true);
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
    } finally {
      // Gekozen, geannuleerd of mislukt: de ophaal-toestand weer weg.
      setFetching(false);
      picking.current = false;
    }
    // A4: annuleren verandert niets, ook niet na een ronde.
    if (result.canceled) return;
    const { items: next, skipped } = addToSelection(mode === "nieuw" ? [] : selectionRef.current, result.assets);
    if (mode === "nieuw" && next.length === 0) {
      // Niets bruikbaars gekozen (bv. alleen een pairedVideo): net als
      // annuleren, de uitkomst van de ronde blijft staan.
      dropCopies(skipped, selectionRef.current);
      return;
    }
    dropCopies(skipped, next);
    if (mode === "nieuw") {
      // Een nieuwe keuze is een nieuwe ronde; het album blijft gekozen.
      update(null);
      updateVideos(null);
    }
    updateSelection(next);
  }

  // Besluit 3: de × op een tegel. Alleen vóór de ronde (A5).
  const removeItem = useCallback((key: string) => {
    if (itemsRef.current !== null || videoItemsRef.current !== null) return;
    const current = selectionRef.current;
    const gone = current.find((i) => i.key === key);
    if (!gone) return;
    const next = removeFromSelection(current, key);
    dropCopies([gone.asset], next);
    selectionRef.current = next;
    setSelection(next);
  }, []);

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
    const assets = new Map(selectionRef.current.map((p) => [p.key, p.asset]));
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

  // WP37: de filmpjes één voor één. `fresh`: na "uitgelogd" een vers token
  // (A-invariant 33).
  async function runVideos(start: VideoItem[], fresh: ReadonlySet<string> = new Set()) {
    if (videoRunning.current || !album) return;
    videoRunning.current = true;
    setVideoBusy(true);
    updateVideos(start);
    const target = album.albumId;
    const assets = new Map(selectionRef.current.map((v) => [v.key, v.asset]));
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
                freshToken: fresh.has(next.key),
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
  // ook in een nieuwe ronde ("Meer toevoegen", de modaal opnieuw openen). WP37:
  // een filmpje ook (invariant 4). WP39 invariant 1: ook na weghalen en
  // opnieuw kiezen.
  function startUpload() {
    if (!album || itemsRef.current !== null || videoItemsRef.current !== null) return;
    const current = selectionRef.current;
    const photos = current.filter((p) => p.kind === "foto");
    const videos = current.filter((v) => v.kind === "filmpje");
    const picks = photos.map((p) => ({ key: p.key, assetId: p.asset.assetId }));
    const clips = albumBatch(
      videos.map((v) => ({ key: v.key, assetId: v.asset.assetId })),
      album.albumId,
    ).map((i): VideoItem => {
      const duration = videos.find((v) => v.key === i.key)?.asset.duration;
      // Te lang: meteen zeggen, niet eerst verkleinen (A12).
      return typeof duration === "number" && videoTooLongToSend(duration)
        ? { key: i.key, uploadId: i.uploadId, state: "mislukt", reason: "te_lang" }
        : { key: i.key, uploadId: i.uploadId, state: "wacht" };
    });
    if (clips.length > 0) void runVideos(clips);
    if (picks.length > 0) void runRound(albumBatch(picks, album.albumId));
  }

  function retryVideos() {
    const current = videoItemsRef.current;
    if (!current) return;
    // A-invariant 33: elk filmpje dat `uitgelogd` kreeg, met een vers token.
    const round = videoRetryRound(current);
    void runVideos(round.items, round.fresh);
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

  const inRound = (items !== null && items.length > 0) || (videoItems !== null && videoItems.length > 0);
  const anyPicked = selection.length > 0;
  const photoCount = selection.filter((i) => i.kind === "foto").length;
  const videoCount = selection.length - photoCount;
  const tiles = selectionTiles(selection);
  const anyTooLong = tiles.some((t) => t.tooLong);
  const photoStates = new Map((items ?? []).map((i) => [i.key, i.state]));
  const videoStates = new Map((videoItems ?? []).map((i) => [i.key, i]));
  // A9: nooit een tegel van 0 × 0 (dan decodeert expo-image op volle grootte).
  // Tot de meting een schatting uit het venster, begrensd op de tekstkolom;
  // `onLayout` corrigeert (A8).
  const win = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(() => Math.min(win.width, size.maxTextColumn));
  const grid = addGrid(gridWidth);

  return (
    <Screen
      underHeader
      footer={
        !fetching && !inRound && anyPicked ? (
          <Button
            title="Toevoegen aan album"
            icon="upload"
            variant="cta"
            disabled={!album}
            onPress={startUpload}
          />
        ) : null
      }
    >
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

      {/* B-besluit 4: de uitkomst van de ronde bovenaan, met haar knoppen. */}
      {inRound && videoItems && videoItems.length > 0 && (
        <VideoRoundResult
          items={videoItems}
          busy={videoBusy}
          albumLabel={album?.label ?? ""}
          // Zonder foto's in de ronde staan "Naar album" en "Meer" hier.
          standalone={(!items || items.length === 0) && !fetching}
          onRetry={retryVideos}
          onToAlbum={toAlbum}
          onMore={() => void pick("nieuw")}
        />
      )}

      {inRound && items && items.length > 0 && (
        <RoundResult
          items={items}
          albumLabel={album?.label ?? ""}
          busy={busy}
          onRetry={retry}
          onToAlbum={toAlbum}
          onMore={() => void pick("nieuw")}
          // Invariant 2: niet weg en geen nieuwe keuze zolang een filmpje loopt.
          idle={!videoBusy && !fetching}
        />
      )}

      {fetching ? <LoadingState label="Je keuze ophalen…" /> : null}

      {!fetching && !anyPicked && !pickerFailed ? (
        <EmptyState
          icon="photos"
          title="Kies foto's of filmpjes"
          text="Kies een of meer foto's of filmpjes (hooguit 3 minuten) om aan een album toe te voegen."
        />
      ) : null}

      {!fetching && !anyPicked && !inRound && (
        <SmallButton title="Kiezen" icon="photos" onPress={() => void pick()} />
      )}

      {anyPicked && (
        <AlbumChoice
          initialAlbumId={initialAlbumId}
          selected={album}
          onSelect={setAlbum}
          locked={inRound}
        />
      )}

      {anyPicked && (
        <View style={styles.section}>
          <View style={local.countRow}>
            <Text variant="bodyStrong" style={styles.grow}>
              {selectionText(photoCount, videoCount)}
            </Text>
            {!fetching && !inRound && (
              <SmallButton title="Meer toevoegen" icon="plus" onPress={() => void pick()} />
            )}
          </View>
          {anyTooLong && !inRound && (
            <Text variant="meta" color="danger">
              {videoFailMessage("te_lang")}
            </Text>
          )}
          {/* Besluit 4, A8: over de volle breedte van het vel, met de eigen breedte gemeten. */}
          <View
            style={local.grid}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              if (w > 0) setGridWidth(w);
            }}
          >
            {grid.tile > 0 && tiles.map((t, n) => {
              const item = selection[n]!;
              const video = videoStates.get(t.key);
              return (
                <Tile
                  key={t.key}
                  itemKey={t.key}
                  kind={t.kind}
                  uri={item.asset.uri}
                  side={grid.tile}
                  label={t.label}
                  removeLabel={t.removeLabel}
                  durationText={t.durationText}
                  tooLong={t.tooLong}
                  poster={posters.get(t.key)}
                  photoState={photoStates.get(t.key)}
                  videoStatus={video ? videoStatusText(video) : null}
                  videoFailed={video?.state === "mislukt"}
                  onRemove={!inRound && !fetching ? removeItem : undefined}
                />
              );
            })}
          </View>
        </View>
      )}
    </Screen>
  );
}

/**
 * A10: de omslagen van de filmpjes in de keuze, één voor één in de volgorde van
 * de keuze. Per sleutel de uri, `null` als het niet lukte (dan een neutrale
 * tegel, niet opnieuw), `undefined` zolang hij nog niet klaar is. Een omslag
 * van een item dat uit de keuze ging, gaat weg; bij sluiten alle.
 */
function usePosters(selection: readonly Item[], paused: boolean): ReadonlyMap<string, string | null> {
  const [posters, setPosters] = useState<ReadonlyMap<string, string | null>>(new Map());
  const made = useRef(new Map<string, string | null>());
  const order = useRef<readonly Item[]>([]);
  const running = useRef(false);
  const alive = useRef(true);
  const pausedRef = useRef(paused);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        // Gepauzeerd: stoppen vóór een nieuwe omslag; na de pauze verder.
        if (!alive.current || pausedRef.current) return;
        const next = order.current.find((i) => i.kind === "filmpje" && !made.current.has(i.key));
        if (!next) return;
        let uri: string | null;
        try {
          uri = (await makePoster(next.asset.uri)).uri;
        } catch {
          // Invariant 4: geen fout, een neutrale tegel.
          uri = null;
        }
        const still = alive.current && order.current.some((i) => i.key === next.key);
        if (!still) {
          if (uri) void removeFile(uri);
          // Niet opnieuw voor dit item; het is uit de keuze (of het scherm is dicht).
          if (!alive.current) return;
          continue;
        }
        made.current.set(next.key, uri);
        setPosters(new Map(made.current));
      }
    } finally {
      running.current = false;
    }
  }, []);

  // Vóór het effect hieronder: bij (opnieuw) mounten eerst weer "levend".
  useEffect(() => {
    alive.current = true;
    const current = made.current;
    return () => {
      alive.current = false;
      for (const uri of current.values()) if (uri) void removeFile(uri);
      current.clear();
    };
  }, []);

  useEffect(() => {
    pausedRef.current = paused;
    order.current = selection;
    const keep = new Set(selection.map((i) => i.key));
    let changed = false;
    for (const [key, uri] of made.current) {
      if (keep.has(key)) continue;
      made.current.delete(key);
      if (uri) void removeFile(uri);
      changed = true;
    }
    if (changed) setPosters(new Map(made.current));
    void run();
  }, [selection, paused, run]);

  return posters;
}

function photoStatusText(state: UploadState): string {
  switch (state) {
    case "wacht":
      return "Wacht";
    case "bezig":
      return "Bezig";
    case "klaar":
      return "In het album";
    case "mislukt":
      return "Niet gelukt";
  }
}

type TileProps = {
  itemKey: string;
  kind: SelectionKind;
  uri: string;
  side: number;
  label: string;
  removeLabel: string;
  durationText: string | null;
  tooLong: boolean;
  /** Omslag van een filmpje: uri, `null` (mislukt) of `undefined` (nog niet). */
  poster: string | null | undefined;
  photoState: UploadState | undefined;
  videoStatus: string | null;
  videoFailed: boolean;
  /** Zonder: geen × (tijdens en na een ronde, A5). */
  onRemove?: (key: string) => void;
};

// Eén tegel: een foto, of een filmpje met omslag en duur rechtsonder. Tijdens
// een ronde de stand op de tegel (besluit 2, A13). De × staat naast de tegel
// voor VoiceOver, met een eigen naam en een tikvlak van 44 pt (invariant 6).
const Tile = memo(function Tile({
  itemKey,
  kind,
  uri,
  side,
  label,
  removeLabel,
  durationText,
  tooLong,
  poster,
  photoState,
  videoStatus,
  videoFailed,
  onRemove,
}: TileProps) {
  const { colors } = useTheme();
  const status = kind === "foto" ? (photoState ? photoStatusText(photoState) : null) : videoStatus;
  const name = status ? `${label}, ${status}` : label;
  const source = kind === "foto" ? uri : poster;
  return (
    <View style={[local.tile, { width: side, height: side, backgroundColor: colors.line }]}>
      <View style={StyleSheet.absoluteFill} accessible accessibilityRole="image" accessibilityLabel={name}>
        {source ? (
          // A9: decoderen op tegelmaat, niet in de schijfcache.
          <Image
            source={{ uri: source }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            enforceEarlyResizing
            cachePolicy="memory"
            recyclingKey={itemKey}
            transition={0}
          />
        ) : kind === "filmpje" ? (
          <View style={local.center}>
            <Icon name="film" size={28} color={colors.muted} />
          </View>
        ) : null}

        {kind === "filmpje" && durationText && (
          <View style={[local.pill, local.duration]}>
            <View style={[StyleSheet.absoluteFill, local.layer]} />
            <Icon name="play" size={14} color={photoLayers.text} filled />
            <Text variant="albumMeta" style={local.pillText} maxFontSizeMultiplier={1.3}>
              {durationText}
            </Text>
          </View>
        )}

        {tooLong && !videoStatus && (
          <View style={[local.pill, local.topLeft]}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.danger }]} />
            <Icon name="alert" size={14} color={photoLayers.text} filled />
            <Text variant="albumMeta" style={local.pillText} maxFontSizeMultiplier={1.3}>
              Te lang
            </Text>
          </View>
        )}

        {kind === "filmpje" && videoStatus && (
          <View style={local.status}>
            <View style={[StyleSheet.absoluteFill, local.layer]} />
            {videoFailed && <Icon name="alert" size={14} color={photoLayers.text} filled />}
            <Text variant="albumMeta" style={[local.pillText, local.grow]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
              {videoStatus}
            </Text>
          </View>
        )}

        {kind === "foto" && photoState && photoState !== "wacht" && (
          <View style={[styles.badge, { backgroundColor: colors.surface }]}>
            {photoState === "bezig" ? (
              <Icon name="refresh" size={18} color={colors.muted} />
            ) : (
              <Icon
                name={photoState === "klaar" ? "check" : "alert"}
                size={18}
                color={photoState === "klaar" ? colors.success : colors.danger}
              />
            )}
          </View>
        )}
      </View>

      {onRemove && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={removeLabel}
          onPress={() => onRemove(itemKey)}
          style={({ pressed }) => [local.remove, pressed && local.pressed]}
        >
          <View style={local.removeDot}>
            <View style={[StyleSheet.absoluteFill, local.layer]} />
            <Icon name="close" size={22} color={photoLayers.text} filled />
          </View>
        </Pressable>
      )}
    </View>
  );
});

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
        <View style={local.buttons}>
          {klaar > 0 && <SmallButton title="Naar album" onPress={onToAlbum} />}
          <SmallButton title="Meer toevoegen" icon="plus" onPress={onMore} />
        </View>
      )}
    </View>
  );
}

// Invariant 6: het tikvlak van de ×.
const REMOVE_HIT = size.touchMin;

const local = StyleSheet.create({
  countRow: { flexDirection: "row", alignItems: "center", gap: space.s, flexWrap: "wrap" },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: ADD_GRID_GAP,
    // Over de volle breedte, zoals het raster van het album.
    marginHorizontal: -size.screenMargin,
  },
  tile: { overflow: "hidden" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  layer: { backgroundColor: photoLayers.pill.color, opacity: photoLayers.pill.opacity },
  pill: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: space.xs,
    paddingVertical: 1,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  duration: { right: space.xs, bottom: space.xs },
  topLeft: { left: space.xs, top: space.xs },
  pillText: { color: photoLayers.text, fontWeight: "700" },
  grow: { flexShrink: 1 },
  status: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
    overflow: "hidden",
  },
  remove: {
    position: "absolute",
    top: 0,
    right: 0,
    width: REMOVE_HIT,
    height: REMOVE_HIT,
    alignItems: "center",
    justifyContent: "center",
  },
  removeDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.6 },
  buttons: { flexDirection: "row", alignItems: "center", gap: space.s, flexWrap: "wrap" },
});
