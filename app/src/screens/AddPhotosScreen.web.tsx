import { Image } from "expo-image";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router, Stack, usePreventRemove } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Screen } from "../components/Screen";
import { SmallButton } from "../components/SmallButton";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { askConfirmation } from "../data/confirm";
import { useUploader, type WebPhoto } from "../data/upload";
import { openFilePicker, webPhotoOf } from "../data/webConvert";
import { listenAddPick, type AddPick } from "../data/webPick";
import { albumPath } from "../lib/groupRoutes";
import {
  UPLOAD_PARALLEL,
  albumBatch,
  applyOutcome,
  photoCountText,
  retryBatch,
  startItem,
  type UploadItem,
  type UploadOutcome,
} from "../lib/upload";
import { CloseButton } from "../navigation/stackOptions";
import { space, useTheme } from "../theme";
import { AlbumChoice, RoundResult, THUMB, addPhotosStyles, type ChosenAlbum } from "./AddPhotosParts";

// WP36: "Foto's toevoegen" in de browser. Hetzelfde verloop als op iOS
// (AddPhotosScreen.tsx): kiezen, album, uploaden met per foto één upload-id,
// per reden wat niet lukte, "Opnieuw proberen", "Meer foto's". Anders:
//
// - U9: de kiezer opent in de tik (de "+", de knop in het album, of hier
//   "Foto's kiezen"), niet vanzelf na het openen van het scherm.
// - U6: geen tegel uit het origineel. Een tegel krijgt zijn beeld pas als de
//   foto is omgezet (een kleine JPEG van dat moment); tot dan een vlak.
// - U7: de vaste id per foto komt uit de inhoud (`webAssetId`).
// - U10: tijdens een ronde vraagt de browser "Pagina verlaten?" bij sluiten of
//   herladen, en blijft het scherm aan (de Wake Lock opnieuw na terugkeer).
//   Een terug-gebaar (de terugknop van de browser of van Android) haalt het
//   scherm niet zonder vraag weg; wie toch gaat, stopt de foto's die nog
//   wachten.

const KEEP_AWAKE_TAG = "wp36-upload";
const THUMBS = 7;

type Picked = { key: string; assetId: string | null; photo: WebPhoto };

let pickRound = 0;

export function AddPhotosScreen({ albumId }: { albumId?: string }) {
  const upload = useUploader();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [reading, setReading] = useState(false);
  const [album, setAlbum] = useState<ChosenAlbum>(null);
  const [initialAlbumId] = useState(albumId ?? null);
  const [items, setItems] = useState<UploadItem[] | null>(null);
  const itemsRef = useRef<UploadItem[] | null>(null);
  const running = useRef(false);
  // Gezet als de user tijdens een ronde toch weggaat: geen nieuwe uploads meer.
  const stopped = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const thumbs = useThumbs();
  // Alleen de laatste keuze telt (een oude kiezer die alsnog antwoordt niet).
  const choice = useRef(0);

  function update(next: UploadItem[]) {
    itemsRef.current = next;
    setItems(next);
  }

  function accept(pick: AddPick) {
    const mine = ++choice.current;
    void pick.then(async (files) => {
      if (!files || mine !== choice.current || running.current) return;
      setReading(true);
      try {
        pickRound += 1;
        const round = pickRound;
        const next: Picked[] = [];
        for (const [i, file] of files.entries()) {
          const key = `${round}-${i}`;
          const w = await webPhotoOf(file, { profile: false, onThumb: (url) => thumbs.set(key, url) });
          next.push({ key, ...w });
        }
        if (mine !== choice.current) return;
        // Opnieuw kiezen vervangt de keuze; een nieuwe keuze is een nieuwe ronde.
        thumbs.keepOnly(next.map((p) => p.key));
        setPicked(next);
        itemsRef.current = null;
        setItems(null);
      } finally {
        if (mine === choice.current) setReading(false);
      }
    });
  }

  // In de tik: de kiezer van de browser.
  function pick() {
    if (running.current) return;
    accept(openFilePicker(true));
  }

  // De keuze uit de tik op "+" of "Foto's toevoegen".
  useEffect(() => listenAddPick(accept), []); // eslint-disable-line react-hooks/exhaustive-deps

  // U10: het scherm blijft aan zolang een ronde loopt. De browser laat de lock
  // los als het tabblad verborgen raakt; bij terugkeer opnieuw vragen.
  useEffect(() => {
    if (!busy) return;
    const acquire = () => void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void deactivateKeepAwake(KEEP_AWAKE_TAG)
        .catch(() => {})
        .then(acquire);
    };
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [busy]);

  // U10: niet ongemerkt weg tijdens een ronde.
  useEffect(() => {
    if (!busy) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [busy]);

  // `gestureEnabled` werkt op het web niet: het terug-gebaar hier tegenhouden.
  usePreventRemove(busy && !leaving, ({ repeat }) => {
    void askConfirmation({
      title: "Uploaden is nog bezig",
      message: "Ga je nu weg, dan komen de foto's die nog wachten niet in het album.",
      button: "Weggaan",
      destructive: true,
    }).then((leave) => {
      if (!leave) return;
      stopped.current = true;
      setLeaving(true);
      repeat();
    });
  });

  // `fresh`: de foto's die eerder "uitgelogd" kregen; die halen een vers token.
  async function runRound(start: UploadItem[], fresh: ReadonlySet<string> = new Set()) {
    if (running.current || !album) return;
    running.current = true;
    setBusy(true);
    update(start);
    const target = album.albumId;
    const photos = new Map(picked.map((p) => [p.key, p.photo]));
    const worker = async () => {
      for (;;) {
        if (stopped.current) return;
        const current = itemsRef.current ?? [];
        const next = current.find((i) => i.state === "wacht");
        if (!next) return;
        update(startItem(current, next.key));
        const photo = photos.get(next.key);
        let outcome: UploadOutcome;
        try {
          outcome = photo
            ? await upload({ asset: photo, uploadId: next.uploadId, albumId: target, freshToken: fresh.has(next.key) })
            : { ok: false, reason: "geen_foto" };
        } catch {
          // Geen foto blijft op "bezig" hangen (invariant 6).
          outcome = { ok: false, reason: "server" };
        }
        update(applyOutcome(itemsRef.current ?? [], next.key, outcome));
      }
    };
    try {
      // Twee uploads tegelijk; het omzetten gaat één voor één (webConvert).
      await Promise.all(Array.from({ length: UPLOAD_PARALLEL }, worker));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  // U7: dezelfde foto voor hetzelfde album houdt zijn upload-id, ook in een
  // nieuwe ronde ("Meer foto's", het scherm opnieuw openen).
  function startUpload() {
    if (!album) return;
    void runRound(albumBatch(picked.map((p) => ({ key: p.key, assetId: p.assetId })), album.albumId));
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
    thumbs.keepOnly([]);
    setPicked([]);
    setItems(null);
    itemsRef.current = null;
    pick();
  }

  const inRound = items !== null && items.length > 0;
  const styles = addPhotosStyles;

  return (
    <Screen underHeader>
      {/* Tijdens een ronde sluit de modaal niet. Op het web toont de stack
          anders links een terugknop "(tabs)"; "Sluiten" staat rechts. */}
      <Stack.Screen
        options={{
          headerBackVisible: false,
          headerLeft: () => null,
          gestureEnabled: !busy,
          // De kop van het web geeft rechts geen marge (iOS wel).
          headerRight: busy
            ? () => null
            : () => (
                <View style={local.headerRight}>
                  <CloseButton />
                </View>
              ),
        }}
      />

      {reading ? <LoadingState label="Foto's lezen…" /> : null}

      {picked.length === 0 && !reading ? (
        <EmptyState icon="photos" title="Kies foto's" text="Kies een of meer foto's om aan een album toe te voegen." />
      ) : null}

      {picked.length > 0 && (
        <View style={styles.section}>
          <Text variant="bodyStrong">{`${photoCountText(picked.length)} geselecteerd`}</Text>
          <WebThumbs picked={picked} items={items} thumbs={thumbs.urls} />
        </View>
      )}

      {!inRound && (
        <SmallButton
          title={picked.length > 0 ? "Andere foto's kiezen" : "Foto's kiezen"}
          icon="photos"
          onPress={pick}
        />
      )}

      {picked.length > 0 && (
        <AlbumChoice initialAlbumId={initialAlbumId} selected={album} onSelect={setAlbum} locked={inRound} />
      )}

      {!inRound && picked.length > 0 && (
        <Button title="Foto's uploaden" icon="plus" variant="cta" disabled={!album} onPress={startUpload} />
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

// De kleine tegels uit het omzetten, per foto. Elke URL wordt vrijgegeven:
// bij een nieuwe tegel voor dezelfde foto, een nieuwe keuze en bij het sluiten.
function useThumbs() {
  const ref = useRef(new Map<string, string>());
  const live = useRef(new Set<string>());
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const api = useRef({
    set(key: string, url: string) {
      if (!live.current.has(key)) {
        URL.revokeObjectURL(url);
        return;
      }
      const old = ref.current.get(key);
      if (old) URL.revokeObjectURL(old);
      ref.current.set(key, url);
      setUrls(new Map(ref.current));
    },
    keepOnly(keys: readonly string[]) {
      live.current = new Set(keys);
      for (const [key, url] of ref.current) {
        if (!live.current.has(key)) {
          URL.revokeObjectURL(url);
          ref.current.delete(key);
        }
      }
      setUrls(new Map(ref.current));
    },
  }).current;
  useEffect(
    () => () => {
      live.current = new Set();
      for (const url of ref.current.values()) URL.revokeObjectURL(url);
      ref.current.clear();
    },
    [],
  );
  return { urls, set: api.set, keepOnly: api.keepOnly };
}

function WebThumbs({
  picked,
  items,
  thumbs,
}: {
  picked: Picked[];
  items: UploadItem[] | null;
  thumbs: ReadonlyMap<string, string>;
}) {
  const { colors } = useTheme();
  const styles = addPhotosStyles;
  const state = new Map((items ?? []).map((i) => [i.key, i.state]));
  const shown = items && items.length > 0 ? picked : picked.slice(0, THUMBS);
  const rest = picked.length - shown.length;
  return (
    <View style={styles.thumbs}>
      {shown.map((p) => {
        const s = state.get(p.key);
        const url = thumbs.get(p.key);
        return (
          <View key={p.key} style={[styles.thumb, { backgroundColor: colors.line }]}>
            {url ? (
              <Image source={{ uri: url }} style={styles.thumbImage} contentFit="cover" />
            ) : (
              <View style={local.placeholder}>
                <Icon name="photos" size={22} color={colors.muted} />
              </View>
            )}
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

const local = StyleSheet.create({
  placeholder: { width: THUMB, height: THUMB, alignItems: "center", justifyContent: "center" },
  headerRight: { paddingRight: space.s },
});
