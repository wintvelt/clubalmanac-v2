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

const KEEP_AWAKE_TAG = "wp18-upload";
const THUMBS = 7;

type Chosen = { album: ChosenAlbum };
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
      // WP33 invariant 10: de groene melding "… toegevoegd aan …" verschijnt
      // (alle foto's in het album, ook na "Opnieuw"). Deels mislukt: geen tik.
      const s = batchSummary(itemsRef.current ?? []);
      if (s.done && s.allInAlbum) successTap();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  // A-invariant 25: dezelfde foto voor hetzelfde album houdt zijn upload-id,
  // ook in een nieuwe ronde ("Meer foto's", de modaal opnieuw openen).
  function startUpload() {
    if (!album) return;
    const picks = picked.map((p) => ({ key: p.key, assetId: p.asset.assetId }));
    void runRound(albumBatch(picks, album.albumId));
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
