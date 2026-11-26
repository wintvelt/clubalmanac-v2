import { useAuth } from "@clerk/expo";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router, Stack, useNavigation } from "expo-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  freeBytes,
  keepOriginal,
  makePoster,
  originalUploaderAvailable,
  pickerOnScreen,
  removeFile,
  removeOriginal,
} from "../../modules/clubalmanac-video";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { SmallButton } from "../components/SmallButton";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useMyGroups } from "../data/homeGroupState";
import { forgetLastAlbum, loadLastAlbum, saveLastAlbum } from "../data/lastAlbum";
import { addOriginalToQueue, originalEvent, originalsReady, originalsSnapshot } from "../data/originals";
import { removePickerCopies } from "../data/pickerCopies";
import {
  beforePick,
  PHOTOS_ONLY_TEXTS,
  PICK_EXTRA_OPTIONS,
  PICK_MEDIA_TYPES,
  PICKER_ASKS_ACCESS,
  PICKER_CLOSE_BY_APP_STATE,
  withContentKeys,
} from "../data/pickMedia";
import { useUploader } from "../data/upload";
import { useLiveQuery } from "../data/useLiveQuery";
import { useVideoUploader, type VideoProgress } from "../data/videoUpload";
import { successTap } from "../data/haptics";
import {
  ADD_GRID_GAP,
  addButton,
  addGrid,
  addToSelection,
  removeFromSelection,
  selectionTiles,
  videoStatusText,
  type SelectionItem,
  type SelectionKind,
} from "../lib/addSelection";
import { afterCompressFailure, leftForeground } from "../lib/compressResume";
import {
  addTargets,
  originalSkipLines,
  roundTargets,
  type OpenFilmProject,
  type SkipReason,
} from "../lib/filmProject";
import { albumPath } from "../lib/groupRoutes";
import { lastAlbumChoice, type LastAlbumChoice, type StoredAlbum } from "../lib/lastAlbum";
import {
  originalAfterVideo,
  originalAtRoundEnd,
  originalPlan,
  type MovedOriginalAction,
} from "../lib/originalUpload";
import { PICK_IDLE, beginPick, endPick, fetchStarted, pickView, stopPick, type PickSession } from "../lib/pickSession";
import {
  UPLOAD_PARALLEL,
  albumBatch,
  applyOutcome,
  batchSummary,
  photoCountText,
  reasonText,
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
import { useAndroidBack } from "../navigation/useAndroidBack";
import { photoLayers, radius, size, space, useTheme } from "../theme";
import { RoundResult, addPhotosStyles as styles, type ChosenAlbum } from "./AddPhotosParts";
import { AlbumChoiceSheet } from "./AlbumChoice";
import { WifiOnlySwitch } from "./FilmProjectParts";

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
// (src/lib/addSelection.ts). "Meer selecteren" vult de keuze aan (ontdubbeld op
// `assetId`), een × haalt een item weg; beide alleen vóór de ronde. Na een
// ronde begint "Meer selecteren" een nieuwe keuze; annuleren in de kiezer
// verandert nooit iets (A4). Een filmpje krijgt een omslag uit het origineel
// (`makePoster`, één voor één, tijdelijk, niet terwijl een filmpje verkleind of
// verstuurd wordt; A10, A11). Te lang staat al vóór de
// ronde op de tegel (besluit 5). De kopie van de kiezer van een dubbel gekozen
// of weggehaald item gaat meteen weg (B-besluit 3). "Toevoegen aan album" staat
// vast onderin (B-besluit 4).
//
// Fixronde gate 1: het album via één rij en een eigen kiesscherm
// (AlbumChoiceSheet), vooraf ingevuld met het laatst gekozen album (per user op
// het toestel, src/data/lastAlbum.ts, bewaard bij de start van een ronde; F1–F5).
// Zonder album is de knop onderin grijs, "Kies eerst een album", en opent hij
// het kiesscherm (besluiten 7 en 8). "Meer selecteren" (besluit 2). Tijdens
// "Je keuze ophalen…" een teller vanaf het sluiten van de kiezer (besluit 10,
// `pickerOnScreen` uit de eigen module), een uitleg en "Stoppen"; een gestopt
// verzoek telt niet meer en zijn kopieën gaan weg; na "Stoppen" kan meteen een
// nieuwe kiezer (src/lib/pickSession.ts; F7, F8 na gate ronde 2, F11). Mislukt het ophalen
// zelf, dan een eigen melding (besluit 6).
//
// WP38b: heeft de groep van het album een open filmproject (`listOpenForMe`),
// dan gaat bij "Toevoegen" het origineel van elk filmpje mee (38b-1,
// `originalPlan`). De kopie van de kiezer wordt dan verplaatst naar de map van
// de originelen (38b-2), het verkleinen leest die, en de wachtrij krijgt het
// origineel met als stap "wacht op het album". Staat het filmpje in het album,
// dan meldt de wachtrij het aan; kreeg het een vaste reden, of sluit de ronde
// zonder dat het in het album staat, dan gaat het origineel weg (38b-3). Het
// versturen loopt daarna buiten dit scherm (src/data/originals.ts).
// Fix-cyclus 1, punt 3: de kopie gaat pas naar de map als de wachtrij geladen
// is. Fix-cyclus 2, punt 5: neemt de wachtrij het origineel toch niet aan, dan
// gaat het verplaatste bestand pas weg bij een eindstand (in het album, een
// vaste reden, of het einde van de ronde); na een uitkomst die opnieuw kan,
// blijft het staan, want "Opnieuw proberen" verkleint weer uit dat bestand
// (`originalAfterVideo`, `originalAtRoundEnd`).
// WP38c, besluit 27 (vervangt besluit 3 en A-invariant 17): foto's en
// filmpjes gaan naar het gekozen album, geen splitsen en geen grijs album.
// Heeft de groep van dat album een open filmproject, dan gaat van elk filmpje
// dat meegaat ook het origineel mee (`addTargets`, `roundTargets`), met één
// regel boven de knop en de schakelaar "Alleen via wifi" (alleen met de
// uploader). Met filmpjes en uploader wacht de knop tot de open projecten
// geladen zijn; een fout bij laden telt als geen project. Gaat het origineel
// niet mee (te klein, te groot, geen ruimte, of verplaatsen of de wachtrij
// lukte niet), dan één regel per reden bij de uitkomst.
// Besluit 25 (38b-12): verkleinen dat mislukte omdat de app de voorgrond
// verliet, gaat vanzelf opnieuw zodra de app weer actief is (hooguit drie
// keer op rij, src/lib/compressResume.ts); ook zonder origineel.

const KEEP_AWAKE_TAG = "wp18-upload";

type Asset = ImagePicker.ImagePickerAsset;
type Item = SelectionItem<Asset>;
type Chosen = { album: ChosenAlbum };
type Target = NonNullable<ChosenAlbum>;
/**
 * WP38c: het album van een ronde (vast bij de start), en voor de filmpjes het
 * project waar de originelen heen gaan. `video` is er zodra er een filmpje in
 * de keuze zit, ook een te lang (fix-cyclus 1, punt 1).
 */
type RoundAlbums = { photo: Target | null; video: (Target & { projectId: string | null }) | null };

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

/** Hoe vaak de app vraagt of de kiezer nog over het scherm staat. */
const PICKER_POLL_MS = 500;
/** Nooit open gezien (de kiezer was er al af, of kwam er niet): na zo lang toch "dicht". */
const PICKER_NEVER_SEEN_MS = 1500;

// De kiezer ging niet open (geen toegang, geen scherm om hem op te tonen). Elke
// andere fout van de kiezer is een mislukt ophalen (besluit 6).
const OPEN_FAILURES = [
  "MISSING_CURRENT_VIEW_CONTROLLER",
  "PERMISSIONS_MODULE_NOT_FOUND",
  "FILE_SYSTEM_MODULE_NOT_FOUND",
  "INVALID_MEDIA_TYPE",
  "UNSUPPORTED_VIDEO_EXPORT_PRESET",
];

function isOpenFailure(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof code !== "string") return true;
  return OPEN_FAILURES.some((c) => code.includes(c));
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Besluit 25: wacht tot de app weer actief is. */
function untilActive(): Promise<void> {
  if (AppState.currentState === "active") return Promise.resolve();
  return new Promise((resolve) => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      sub.remove();
      resolve();
    });
  });
}

function selectionText(photos: number, videos: number): string {
  const parts = [photos > 0 ? photoCountText(photos) : null, videos > 0 ? videoCountText(videos) : null];
  return `${parts.filter(Boolean).join(" en ")} geselecteerd`;
}

function videoCountText(n: number): string {
  return n === 1 ? "1 filmpje" : `${n} filmpjes`;
}

/**
 * B-besluit 3: de kopie die de kiezer van een asset maakte, weg. Niet als een
 * item dat blijft hetzelfde bestand gebruikt. WP42 fix-ronde, punt 3: ook via
 * src/data/pickerCopies, want op Android is er geen eigen module.
 */
function dropCopies(assets: readonly Asset[], keep: readonly Item[]): void {
  const used = new Set(keep.map((i) => i.asset.uri));
  const gone = assets.filter((a) => !used.has(a.uri)).map((a) => a.uri);
  for (const uri of gone) void removeFile(uri);
  removePickerCopies(gone);
}

export function AddPhotosScreen({ albumId }: { albumId?: string }) {
  const { colors } = useTheme();
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
  // Fixronde gate 1: het verzoek aan de kiezer (stoppen, één tegelijk, teller).
  const [session, setSession] = useState<PickSession>(PICK_IDLE);
  const sessionRef = useRef<PickSession>(PICK_IDLE);
  // Het token waarvan de module zag dat de kiezer dicht ging (besluit 6).
  const closedSeen = useRef(0);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [album, setAlbum] = useState<Chosen["album"]>(null);
  // F4: false zolang het vooraf ingevulde album nog gecontroleerd wordt.
  const [albumKnown, setAlbumKnown] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [initialAlbumId] = useState(albumId ?? null);
  const { userId } = useAuth();
  // Het onthouden album (undefined: nog niet gelezen), of dat uit de route.
  const [candidate, setCandidate] = useState<StoredAlbum | null | undefined>(undefined);
  // Het album uit de route bestaat niet (meer), of de user mag er niet in.
  const [routeGone, setRouteGone] = useState(false);
  const routeAlbumFound = useCallback((target: StoredAlbum | null) => {
    setCandidate(target);
    if (target === null) setRouteGone(true);
  }, []);
  const [items, setItems] = useState<UploadItem[] | null>(null);
  const itemsRef = useRef<UploadItem[] | null>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const opened = useRef(false);
  const [videoBusy, setVideoBusy] = useState(false);
  // Geen nieuwe omslagen naast het verkleinen en versturen van een filmpje.
  const posters = usePosters(selection, videoBusy);
  // WP38c: de open filmprojecten van de user (besluit 3); `undefined` zolang
  // ze laden. Een fout bij laden telt als geen project.
  const [openProjects, setOpenProjects] = useState<readonly OpenFilmProject[] | undefined>(undefined);
  const onOpenProjects = useCallback((list: readonly OpenFilmProject[]) => setOpenProjects(list), []);
  // WP38c: het album van de ronde die loopt, en het project van de filmpjes.
  const roundAlbums = useRef<RoundAlbums>({ photo: null, video: null });
  const [shownTargets, setShownTargets] = useState<RoundAlbums>({ photo: null, video: null });
  // WP38b: per upload-id van een filmpje of zijn origineel meegaat (met de
  // verplaatste kopie). `queued`: de wachtrij nam het aan; anders ruimt het
  // scherm het verplaatste bestand op bij een eindstand (punt 5). `settled`:
  // de eindstand is er al (de wachtrij hoorde het, of het bestand is weg).
  // WP38c (38c-13): `skip`, waarom het origineel niet meegaat.
  const originals = useRef(
    new Map<string, { uri: string | null; fileName?: string; queued?: boolean; settled?: boolean; skip?: SkipReason }>(),
  );
  // Besluit 25: de AppState-waarden tijdens het verkleinen van het filmpje dat nu loopt.
  const compressStates = useRef<string[] | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      compressStates.current?.push(String(state));
    });
    return () => sub.remove();
  }, []);

  function updateSession(next: PickSession) {
    sessionRef.current = next;
    setSession(next);
  }

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
    // Invariant 2: tijdens een ronde ligt de keuze vast. F8: één kiezer
    // tegelijk zolang het scherm op een verzoek wacht; een gestopt verzoek
    // blokkeert niets (gate ronde 2).
    if (running.current || videoRunning.current) return;
    // WP42 B4: op Android eerst (hooguit één keer) de vraag om de plaats van foto's.
    await beforePick();
    if (running.current || videoRunning.current) return;
    const begun = beginPick(sessionRef.current);
    if (!begun) return;
    const { token } = begun;
    updateSession(begun.state);
    setPickerFailed(false);
    setFetchFailed(false);
    setFetching(true);
    void watchPicker(token, Date.now());
    let result: ImagePicker.ImagePickerResult | null = null;
    let failure: unknown = null;
    let failed = false;
    let accept = false;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        // WP37: ook filmpjes. Het origineel, met zijn datum en plaats (besluit
        // B2). Fixronde gate 1: Current en Passthrough expliciet (de native
        // standaard), zodat een upgrade niet ongemerkt gaat omzetten.
        // WP42 A6, 42b A20: de soorten per platform (src/data/pickMedia).
        mediaTypes: PICK_MEDIA_TYPES,
        allowsMultipleSelection: true,
        selectionLimit: 0,
        orderedSelection: true,
        exif: true,
        quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
        videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
        ...PICK_EXTRA_OPTIONS,
      });
      // WP42 fix-ronde, punt 2: op Android een sleutel uit de inhoud (geen `assetId`); op iOS niets.
      if (!result.canceled) result = { ...result, assets: await withContentKeys(result.assets) };
    } catch (e) {
      failure = e;
      failed = true;
    } finally {
      // Gekozen, geannuleerd of mislukt: de ophaal-toestand weer weg. Na
      // "Stoppen" telt het antwoord niet (F7).
      const end = endPick(sessionRef.current, token);
      accept = end.accept;
      updateSession(end.state);
      // Een laat antwoord van een gestopt verzoek laat een nieuwer verzoek
      // staan (gate ronde 2): alleen weg als het scherm nergens meer op wacht.
      if (end.state.current === null) setFetching(false);
    }
    if (!accept) {
      // Gestopt (of het scherm is dicht): niets aan het scherm, de kopieën weg.
      if (result && !result.canceled) dropCopies(result.assets, selectionRef.current);
      return;
    }
    if (failed) {
      // Besluit 6: de keuze die er stond, blijft staan.
      // WP42 A6: op Android vraagt de kiezer geen toegang; dan is elke fout een mislukt ophalen.
      if (PICKER_ASKS_ACCESS && closedSeen.current !== token && isOpenFailure(failure)) setPickerFailed(true);
      else setFetchFailed(true);
      return;
    }
    // A4: annuleren verandert niets, ook niet na een ronde.
    if (!result || result.canceled) return;
    const { items: next, skipped } = addToSelection(mode === "nieuw" ? [] : selectionRef.current, result.assets);
    if (mode === "nieuw" && next.length === 0) {
      // Niets bruikbaars gekozen (bv. alleen een pairedVideo): net als
      // annuleren, de uitkomst van de ronde blijft staan.
      dropCopies(skipped, selectionRef.current);
      return;
    }
    dropCopies(skipped, next);
    if (mode === "nieuw") {
      // Een nieuwe keuze is een nieuwe ronde; het album blijft gekozen. WP42
      // fix-ronde, punt 3: de kopieën van de vorige keuze zijn niet meer nodig.
      dropCopies(selectionRef.current.map((i) => i.asset), next);
      endOriginalRound();
      update(null);
      updateVideos(null);
    }
    updateSelection(next);
  }

  // Besluit 10: de teller begint als de kiezer dicht is. De eigen module zegt
  // of hij nog over het scherm staat; eerst moet hij open gezien zijn. Kan de
  // build dat niet zeggen (een oude build), dan vanaf het openen. WP42 A6: op
  // Android staat de app niet actief zolang de kiezer openstaat.
  async function watchPicker(token: number, openedAt: number) {
    let seenOpen = false;
    for (;;) {
      await wait(PICKER_POLL_MS);
      const c = sessionRef.current.current;
      if (!c || c.token !== token || c.fetchStartedAt !== null) return;
      const open = PICKER_CLOSE_BY_APP_STATE ? AppState.currentState !== "active" : await pickerOnScreen();
      if (open === null) {
        updateSession(fetchStarted(sessionRef.current, token, openedAt));
        return;
      }
      if (open) {
        seenOpen = true;
        continue;
      }
      if (seenOpen || Date.now() - openedAt > PICKER_NEVER_SEEN_MS) {
        closedSeen.current = token;
        updateSession(fetchStarted(sessionRef.current, token, Date.now()));
        return;
      }
    }
  }

  // F7: niet meer wachten; wat er stond, staat er weer.
  function stopFetching() {
    updateSession(stopPick(sessionRef.current));
    setFetching(false);
  }

  // Dicht: een antwoord dat nog komt, telt niet (zijn kopieën gaan weg).
  // WP38b: de ronde sluit; een origineel van een filmpje dat niet in het album
  // kwam, gaat weg (38b-3).
  // WP42 fix-ronde, punt 3: de kopieën van de kiezer (met hun plaats) weg; een
  // verplaatst origineel ligt niet in de map van de kiezer en blijft.
  useEffect(
    () => () => {
      sessionRef.current = stopPick(sessionRef.current);
      endOriginalRound();
      removePickerCopies(selectionRef.current.map((i) => i.asset.uri));
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const view = pickView(session, now);
  const counting = view.fetching && session.current?.fetchStartedAt != null;
  useEffect(() => {
    if (!counting) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), PICKER_POLL_MS);
    return () => clearInterval(timer);
  }, [counting]);

  // --- het album (fixronde gate 1, F1–F5) ---------------------------------

  // F3: uit de route (het album van de +), anders het onthouden album.
  useEffect(() => {
    if (initialAlbumId) return;
    if (!userId) {
      setCandidate(null);
      return;
    }
    let live = true;
    void loadLastAlbum(userId).then((stored) => {
      if (live) setCandidate(stored);
    });
    return () => {
      live = false;
    };
  }, [userId, initialAlbumId]);

  const inRoundRef = useRef(false);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // F4: het album dat er staat (of het vooraf ingevulde) blijft gecontroleerd
  // tot de ronde; verdwijnt het, dan "Kies een album".
  const onAlbumCheck = useCallback((result: LastAlbumChoice, target: StoredAlbum) => {
    if (inRoundRef.current || result.kind === "unknown") return;
    if (result.kind === "album") {
      setAlbum((prev) => (prev && prev.albumId !== result.album.albumId ? prev : result.album));
      setAlbumKnown(true);
      return;
    }
    setAlbum((prev) => (prev && prev.albumId !== target.albumId ? prev : null));
    setAlbumKnown(true);
    // F3: het album uit de route is er niet (meer): de melding van vóór WP39.
    if (target.albumId === initialAlbumId) setRouteGone(true);
    if (result.forget && userIdRef.current) void forgetLastAlbum(userIdRef.current, target.albumId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const checkTarget: StoredAlbum | null | undefined = album
    ? { albumId: album.albumId, groupId: album.groupId }
    : albumKnown
      ? null
      : candidate;

  useEffect(() => {
    if (!album && !albumKnown && candidate === null) setAlbumKnown(true);
  }, [album, albumKnown, candidate]);

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
  // tijdens het verkleinen van een filmpje). WP39: ook tijdens "Je keuze
  // ophalen…" (een download uit iCloud kan minuten duren).
  const anyBusy = busy || videoBusy;
  // WP42 A3: tijdens een ronde sluit de terugknop van Android het scherm niet.
  useAndroidBack(anyBusy);
  const keepAwake = anyBusy || fetching;
  useEffect(() => {
    if (!keepAwake) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [keepAwake]);

  // `fresh`: de foto's die eerder "uitgelogd" kregen; die halen een vers token.
  async function runRound(start: UploadItem[], fresh: ReadonlySet<string> = new Set()) {
    // Een tweede tik start niets.
    const photoTarget = roundAlbums.current.photo;
    if (running.current || !photoTarget) return;
    running.current = true;
    setBusy(true);
    update(start);
    const target = photoTarget.albumId;
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

  // WP38b 38b-1, 38b-2: gaat het origineel van dit filmpje mee? Zo ja, de
  // kopie van de kiezer naar de map van de originelen en in de wachtrij; het
  // verkleinen leest dan dat bestand. Eén keer per filmpje per ronde.
  // WP38c, besluit 27.2: het origineel gaat mee als de groep van het gekozen
  // album een open project heeft (`projectId` van de ronde).
  async function keepForOriginal(item: VideoItem, asset: Asset, groupId: string, projectId: string | null): Promise<Asset> {
    const known = originals.current.get(item.uploadId);
    if (known) return known.uri ? { ...asset, uri: known.uri } : asset;
    originals.current.set(item.uploadId, { uri: null });
    const skip = (reason: SkipReason) => originals.current.set(item.uploadId, { uri: null, skip: reason });
    const uid = userIdRef.current;
    if (!originalUploaderAvailable || !uid) return asset;
    // Al in de wachtrij (hetzelfde filmpje opnieuw toegevoegd): niet nog een keer.
    if (originalsSnapshot().queue.some((e) => e.key === item.uploadId)) return asset;
    let free: number | null = null;
    try {
      free = await freeBytes();
    } catch {
      // Onbekend: houdt het origineel niet tegen.
    }
    const plan = originalPlan({
      uploaderAvailable: originalUploaderAvailable,
      groupId,
      openProjects: projectId ? [{ groupId, projectId }] : [],
      bytes: typeof asset.fileSize === "number" ? asset.fileSize : Number.NaN,
      freeBytes: free,
    });
    if (plan.kind !== "mee") {
      // 38c-13: geen uploader of geen project geeft geen melding.
      if (plan.reason === "te_klein" || plan.reason === "te_groot" || plan.reason === "geen_ruimte") skip(plan.reason);
      return asset;
    }
    // Punt 3: pas verplaatsen als de wachtrij geladen is (het laden ruimt
    // anders een bestand op dat er nog niet in staat).
    if (!(await originalsReady())) {
      skip("fout");
      return asset;
    }
    let kept: Awaited<ReturnType<typeof keepOriginal>>;
    try {
      kept = await keepOriginal(asset.uri);
    } catch {
      // Niet te verplaatsen: het filmpje gaat zonder origineel.
      skip("fout");
      return asset;
    }
    originals.current.set(item.uploadId, { uri: kept.uri, fileName: kept.fileName });
    const moved = { ...asset, uri: kept.uri };
    // De keuze wijst voortaan naar het verplaatste bestand (opnieuw proberen leest het ook).
    updateSelection(selectionRef.current.map((i) => (i.key === item.key ? { ...i, asset: moved } : i)));
    const queued = await addOriginalToQueue({
      key: item.uploadId,
      userId: uid,
      projectId: plan.projectId,
      fileName: kept.fileName,
      bytes: kept.bytes,
    }).catch(() => false);
    originals.current.set(item.uploadId, {
      uri: kept.uri,
      fileName: kept.fileName,
      queued,
      ...(queued ? {} : { skip: "fout" as const }),
    });
    return moved;
  }

  // WP38b 38b-3, fix-cyclus 2 punt 5: wat de uitkomst voor het verplaatste
  // bestand betekent, uitgevoerd.
  function applyOriginalAction(uploadId: string, fileName: string, action: MovedOriginalAction): void {
    switch (action.kind) {
      case "album_klaar":
        originalEvent({ kind: "album_klaar", key: uploadId, photoId: action.photoId });
        return;
      case "album_mislukt":
        originalEvent({ kind: "album_mislukt", key: uploadId });
        return;
      case "bestand_weg":
        void removeOriginal(fileName).catch(() => {});
        return;
      case "laten":
        return;
    }
  }

  // WP38b 38b-3: de ronde sluit. Een origineel van een filmpje dat niet in het
  // album kwam, gaat weg; een verplaatst bestand dat de wachtrij niet aannam
  // ook (fix-cyclus 2, punt 5).
  // Weet het scherm nog niet of de wachtrij het aannam, dan laat het het
  // bestand staan; de volgende start ruimt het op als het een wees is.
  function endOriginalRound() {
    for (const item of videoItemsRef.current ?? []) {
      const original = originals.current.get(item.uploadId);
      if (!original?.uri || !original.fileName || original.settled || original.queued === undefined) continue;
      const action = originalAtRoundEnd({ queued: original.queued, inAlbum: item.state === "klaar" });
      applyOriginalAction(item.uploadId, original.fileName, action);
    }
    originals.current.clear();
  }

  // WP37: de filmpjes één voor één. `fresh`: na "uitgelogd" een vers token
  // (A-invariant 33).
  async function runVideos(start: VideoItem[], fresh: ReadonlySet<string> = new Set()) {
    if (videoRunning.current) return;
    // 38c fix-cyclus 1, punt 1: ook zonder album voor de filmpjes (alleen te
    // lange) krijgt elk filmpje een uitkomst; een filmpje dat zou moeten gaan
    // maar geen doel heeft, telt als mislukt (komt niet voor: `roundTargets`).
    const videoTarget = roundAlbums.current.video;
    if (!videoTarget) {
      updateVideos(start.map((i) => (i.state === "wacht" ? { ...i, state: "mislukt", reason: "server" } : i)));
      return;
    }
    videoRunning.current = true;
    setVideoBusy(true);
    updateVideos(start);
    const target = videoTarget.albumId;
    const groupId = videoTarget.groupId;
    const projectId = videoTarget.projectId;
    const assets = new Map(selectionRef.current.map((v) => [v.key, v.asset]));
    try {
      for (;;) {
        const next = (videoItemsRef.current ?? []).find((i) => i.state === "wacht");
        if (!next) break;
        patchVideo(next.key, { state: "bezig", reason: undefined, progress: undefined });
        const picked = assets.get(next.key);
        let outcome: Awaited<ReturnType<typeof uploadVideo>>;
        try {
          const asset = picked ? await keepForOriginal(next, picked, groupId, projectId) : undefined;
          outcome = asset ? await uploadVideoResuming(next, asset, target, fresh.has(next.key)) : { ok: false, reason: "server" };
        } catch {
          // Geen filmpje blijft op "bezig" hangen (invariant 5).
          outcome = { ok: false, reason: "server" };
        }
        // A-invariant 18: het origineel wacht op het album; daarna meldt de
        // wachtrij het aan. Nam de wachtrij het niet aan, dan gaat het
        // verplaatste bestand pas weg bij een eindstand (fix-cyclus 2, punt 5).
        const original = originals.current.get(next.uploadId);
        if (original?.uri && original.fileName && !original.settled) {
          const action = originalAfterVideo({ queued: original.queued === true, outcome });
          applyOriginalAction(next.uploadId, original.fileName, action);
          if (action.kind !== "laten") originals.current.set(next.uploadId, { ...original, settled: true });
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

  // Besluit 25 (38b-12): mislukte het verkleinen terwijl de app de voorgrond
  // verliet, dan zonder melding opnieuw zodra hij weer actief is, met dezelfde
  // upload-id; hooguit COMPRESS_AUTO_RETRIES keer op rij. Alleen de stap van
  // het verkleinen telt (voorbereiden en verkleinen), niet het versturen.
  async function uploadVideoResuming(item: VideoItem, asset: Asset, albumId: string, freshToken: boolean) {
    let autoRetries = 0;
    for (;;) {
      compressStates.current = [String(AppState.currentState)];
      const outcome = await uploadVideo({
        asset,
        uploadId: item.uploadId,
        albumId,
        freshToken,
        onProgress: (progress) => {
          if (progress.phase === "versturen" || progress.phase === "afronden") compressStates.current = null;
          patchVideo(item.key, { progress });
        },
      });
      const seen = compressStates.current;
      compressStates.current = null;
      if (outcome.ok || outcome.reason !== "comprimeren" || seen === null) return outcome;
      if (afterCompressFailure({ leftForeground: leftForeground(seen), autoRetries }) !== "opnieuw_als_actief") {
        return outcome;
      }
      autoRetries += 1;
      await untilActive();
    }
  }

  // A-invariant 25: dezelfde foto voor hetzelfde album houdt zijn upload-id,
  // ook in een nieuwe ronde ("Meer selecteren", de modaal opnieuw openen). WP37:
  // een filmpje ook (invariant 4). WP39 invariant 1: ook na weghalen en
  // opnieuw kiezen.
  function startUpload() {
    if (itemsRef.current !== null || videoItemsRef.current !== null) return;
    if (!album) {
      // Besluit 7: "Kies eerst een album" opent het kiesscherm.
      if (albumKnown) setChoosing(true);
      return;
    }
    const current = selectionRef.current;
    const photos = current.filter((p) => p.kind === "foto");
    const videos = current.filter((v) => v.kind === "filmpje");
    const tooLongKeys = new Set(
      videos.filter((v) => typeof v.asset.duration === "number" && videoTooLongToSend(v.asset.duration)).map((v) => v.key),
    );
    // WP38c: besluit 3; zolang de open projecten laden, nog niet. Fix-cyclus
    // 1, punt 1: de doelen van de ronde, met een uitkomst voor elk filmpje,
    // ook als het te lang is (WP37 A12).
    const round = roundTargets({
      photos: photos.length,
      videos: videos.length - tooLongKeys.size,
      tooLong: tooLongKeys.size,
      album: { albumId: album.albumId, groupId: album.groupId, name: album.label },
      openProjects,
      originals: originalUploaderAvailable,
    });
    if (!round.ready) return;
    // F2: het album van deze ronde is het laatst gekozen album.
    if (userId) void saveLastAlbum(userId, { albumId: album.albumId, groupId: album.groupId });
    const albums: RoundAlbums = {
      photo: photos.length > 0 ? album : null,
      video: round.videoResult ? { ...album, projectId: round.projectId } : null,
    };
    roundAlbums.current = albums;
    setShownTargets(albums);
    const picks = photos.map((p) => ({ key: p.key, assetId: p.asset.assetId }));
    // De upload-id van een filmpje hoort bij het gekozen album (WP37).
    const clips = albumBatch(
      videos.map((v) => ({ key: v.key, assetId: v.asset.assetId })),
      album.albumId,
    ).map((i): VideoItem =>
      // Te lang: meteen zeggen, niet eerst verkleinen (A12).
      tooLongKeys.has(i.key)
        ? { key: i.key, uploadId: i.uploadId, state: "mislukt", reason: "te_lang" }
        : { key: i.key, uploadId: i.uploadId, state: "wacht" },
    );
    if (round.videoResult && clips.length > 0) void runVideos(clips);
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

  // "Naar album": het gekozen album van de ronde.
  function toAlbum(target: Target | null) {
    if (!target) return;
    const path = albumPath(target.groupId, target.albumId);
    router.dismiss();
    router.push(path);
  }

  const inRound = (items !== null && items.length > 0) || (videoItems !== null && videoItems.length > 0);
  inRoundRef.current = inRound;
  const anyPicked = selection.length > 0;
  const photoCount = selection.filter((i) => i.kind === "foto").length;
  const videoCount = selection.length - photoCount;
  const tiles = selectionTiles(selection);
  const anyTooLong = tiles.some((t) => t.tooLong);
  // WP38c, besluit 3: een te lang filmpje gaat niet mee, en telt dus niet.
  const videosGoing = tiles.filter((t) => t.kind === "filmpje" && !t.tooLong).length;
  const targets = addTargets({
    photos: photoCount,
    videos: videosGoing,
    album: album ? { albumId: album.albumId, groupId: album.groupId, name: album.label } : null,
    openProjects,
    originals: originalUploaderAvailable,
  });
  const button = addButton(album ? (targets.ready ? "chosen" : "unknown") : albumKnown ? "none" : "unknown");
  const skipLines = originalSkipLines(
    (videoItems ?? [])
      .filter((i) => i.state === "klaar")
      .map((i) => originals.current.get(i.uploadId)?.skip)
      .filter((r): r is SkipReason => r !== undefined),
  );
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
            title={button.title}
            icon="upload"
            variant="cta"
            disabled={button.action === null}
            muted={button.action === "kies-album"}
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
          // WP42 A3: Android toont ook een terugpijl; tijdens een ronde niet.
          ...(Platform.OS === "android" ? { headerBackVisible: !anyBusy } : {}),
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

      {fetchFailed && (
        <Notice
          kind="error"
          message={
            PHOTOS_ONLY_TEXTS?.fetchFailed ??
            "Je keuze ophalen lukte niet. Staat er iets in iCloud, probeer het dan opnieuw met een goede verbinding."
          }
        />
      )}

      {/* B-besluit 4: de uitkomst van de ronde bovenaan, met haar knoppen. */}
      {inRound && videoItems && videoItems.length > 0 && (
        <VideoRoundResult
          items={videoItems}
          busy={videoBusy}
          albumLabel={shownTargets.video?.label ?? album?.label ?? ""}
          skipLines={skipLines}
          // Zonder foto's in de ronde staan "Naar album" en "Meer" hier. F7, F8:
          // na "Stoppen" staan ze er meteen weer.
          standalone={(!items || items.length === 0) && !fetching}
          onRetry={retryVideos}
          onToAlbum={() => toAlbum(shownTargets.video)}
          onMore={() => void pick("nieuw")}
        />
      )}

      {inRound && items && items.length > 0 && (
        <RoundResult
          items={items}
          albumLabel={shownTargets.photo?.label ?? album?.label ?? ""}
          busy={busy}
          onRetry={retry}
          onToAlbum={() => toAlbum(shownTargets.photo)}
          onMore={() => void pick("nieuw")}
          // Invariant 2: niet weg en geen nieuwe keuze zolang een filmpje loopt.
          // F7, F8: na "Stoppen" meteen weer.
          idle={!videoBusy && !fetching}
        />
      )}

      {fetching ? (
        <View style={styles.section}>
          <LoadingState label="Je keuze ophalen…" />
          {view.elapsed !== null && (
            <Text variant="bodyStrong" style={local.timer} accessibilityLabel={`${view.elapsed} bezig`}>
              {view.elapsed}
            </Text>
          )}
          {/* WP42b A20: ook op Android (de kiezer kopieert eerst het hele filmpje). */}
          <Text variant="meta" color="muted">
            Langere filmpjes en/of hogere kwaliteit kan een paar minuten duren.
          </Text>
          <SmallButton title="Stoppen" onPress={stopFetching} />
        </View>
      ) : null}


      {!fetching && !anyPicked && !pickerFailed ? (
        <EmptyState
          icon="photos"
          title={PHOTOS_ONLY_TEXTS?.emptyTitle ?? "Kies foto's of filmpjes"}
          text={
            PHOTOS_ONLY_TEXTS?.emptyText ??
            "Kies een of meer foto's of filmpjes (hooguit 3 minuten) om aan een album toe te voegen."
          }
        />
      ) : null}

      {!fetching && !anyPicked && !inRound && (
        <SmallButton title="Kiezen" icon="photos" disabled={!view.canPick} onPress={() => void pick()} />
      )}

      {initialAlbumId && candidate === undefined && (
        <QueryBoundary fallback={() => <Found onFound={routeAlbumFound} target={null} />}>
          <RouteAlbum albumId={initialAlbumId} onFound={routeAlbumFound} />
        </QueryBoundary>
      )}

      {/* WP38c: de open filmprojecten, voor besluit 3 en het origineel. Een fout telt als geen project. */}
      <QueryBoundary fallback={() => <NoOpenProjects onChange={onOpenProjects} />}>
        <OpenProjects onChange={onOpenProjects} />
      </QueryBoundary>

      {checkTarget ? (
        <QueryBoundary
          key={checkTarget.albumId}
          fallback={() => <Report target={checkTarget} result={{ kind: "none", forget: false }} onResult={onAlbumCheck} />}
        >
          <AlbumCheck target={checkTarget} onResult={onAlbumCheck} />
        </QueryBoundary>
      ) : null}

      {/* F3 "zoals nu": het album uit de route bestaat niet meer. */}
      {anyPicked && routeGone && !album && !inRound && <Notice kind="error" message={reasonText("geen_album")} />}

      {anyPicked && (
        <AlbumRow album={album} known={albumKnown} locked={inRound} onPress={() => setChoosing(true)} />
      )}

      {/* WP38c, besluit 27.4: de regel over het origineel, en de schakelaar. */}
      {anyPicked && !inRound && targets.ready && targets.lines.length > 0 && (
        <View style={[local.lines, { backgroundColor: colors.tabPill }]} accessible>
          {targets.lines.map((line) => (
            <Text key={line} variant="meta">
              {line}
            </Text>
          ))}
        </View>
      )}
      {anyPicked && !inRound && targets.ready && targets.wifiSwitch && <WifiOnlySwitch />}

      <AlbumChoiceSheet
        visible={choosing}
        selectedAlbumId={album?.albumId ?? null}
        onClose={() => setChoosing(false)}
        onChoose={(id, info) => {
          setChoosing(false);
          if (inRoundRef.current) return;
          setAlbum({ albumId: id, groupId: info.groupId, label: info.label });
          setAlbumKnown(true);
        }}
      />

      {anyPicked && (
        <View style={styles.section}>
          <View style={local.countRow}>
            <Text variant="bodyStrong" style={styles.grow}>
              {selectionText(photoCount, videoCount)}
            </Text>
            {!fetching && !inRound && (
              <SmallButton
                title="Meer selecteren"
                icon="plus"
                disabled={!view.canPick}
                onPress={() => void pick()}
              />
            )}
          </View>
          {anyTooLong && !inRound && (
            <Text variant="meta" color="danger">
              {videoFailMessage("te_lang")}
            </Text>
          )}
          {/* WP42b A22 (B12): op Android loopt een filmpje alleen met de app open. */}
          {videoBusy && PHOTOS_ONLY_TEXTS?.keepOpen ? (
            <Text variant="meta" color="muted">
              {PHOTOS_ONLY_TEXTS.keepOpen}
            </Text>
          ) : null}
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

// F5: één rij "Album" met het gekozen album, of "Kies een album"; een tik
// opent het kiesscherm. Zolang het vooraf ingevulde album gecontroleerd wordt:
// nog niets (F4). Tijdens en na een ronde niet te tikken.
function AlbumRow({
  album,
  known,
  locked,
  onPress,
}: {
  album: ChosenAlbum;
  known: boolean;
  locked: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const value = album ? album.label : known ? "Kies een album" : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Album, ${value ?? "laden"}`}
      accessibilityState={{ disabled: locked }}
      disabled={locked}
      onPress={onPress}
      style={({ pressed }) => [local.albumRow, { backgroundColor: colors.surface }, pressed && local.pressed]}
    >
      <Text variant="fieldLabel">Album</Text>
      <View style={local.albumValue}>
        {value === null ? (
          <ActivityIndicator color={colors.muted} />
        ) : (
          <Text color={album ? "text" : "muted"} numberOfLines={2} style={local.albumText}>
            {value}
          </Text>
        )}
      </View>
      {!locked && <Icon name="chevron" size={20} color={colors.muted} />}
    </Pressable>
  );
}

// WP38b, WP38c: de groepen met een open filmproject, met de titel. Tot het
// antwoord er is: nog niet bekend (de knop wacht als er filmpjes zijn).
function OpenProjects({ onChange }: { onChange: (list: readonly OpenFilmProject[]) => void }) {
  const rows = useLiveQuery(api.filmProjects.listOpenForMe, {});
  const sig = JSON.stringify(rows?.map((r) => [r.groupId, r.projectId, r.title]) ?? null);
  useEffect(() => {
    if (rows) {
      onChange(rows.map((r) => ({ groupId: r.groupId, projectId: r.projectId, title: r.title })));
    }
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// Een fout bij het laden telt als geen project (de backend leidt toch om).
function NoOpenProjects({ onChange }: { onChange: (list: readonly OpenFilmProject[]) => void }) {
  useEffect(() => {
    onChange([]);
  }, [onChange]);
  return null;
}

// F3: het album uit de route, met zijn groep. Weg of geen toegang: geen.
function RouteAlbum({ albumId, onFound }: { albumId: string; onFound: (t: StoredAlbum | null) => void }) {
  const row = useLiveQuery(api.albums.getWithGroup, { albumId: albumId as Id<"albums"> });
  const target = row === undefined ? undefined : row ? { albumId: row._id, groupId: row.groupId } : null;
  if (target === undefined) return null;
  return <Found target={target} onFound={onFound} />;
}

function Found({ target, onFound }: { target: StoredAlbum | null; onFound: (t: StoredAlbum | null) => void }) {
  const sig = JSON.stringify(target);
  useEffect(() => {
    onFound(target);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// F4: is dit album te gebruiken (lid van de groep, het album in die groep)?
function AlbumCheck({
  target,
  onResult,
}: {
  target: StoredAlbum;
  onResult: (result: LastAlbumChoice, target: StoredAlbum) => void;
}) {
  const groups = useMyGroups();
  const member = groups !== undefined && groups.some((g) => g._id === target.groupId);
  if (member) return <AlbumCheckInGroup target={target} groups={groups} onResult={onResult} />;
  return (
    <Report
      target={target}
      result={lastAlbumChoice({ stored: target, myGroups: groups, albumsOf: () => undefined })}
      onResult={onResult}
    />
  );
}

function AlbumCheckInGroup({
  target,
  groups,
  onResult,
}: {
  target: StoredAlbum;
  groups: readonly { _id: string; name: string }[];
  onResult: (result: LastAlbumChoice, target: StoredAlbum) => void;
}) {
  const albums = useLiveQuery(api.albums.listByGroup, { groupId: target.groupId as Id<"groups"> });
  return (
    <Report
      target={target}
      result={lastAlbumChoice({ stored: target, myGroups: groups, albumsOf: () => albums })}
      onResult={onResult}
    />
  );
}

function Report({
  target,
  result,
  onResult,
}: {
  target: StoredAlbum;
  result: LastAlbumChoice;
  onResult: (result: LastAlbumChoice, target: StoredAlbum) => void;
}) {
  const sig = JSON.stringify([target, result]);
  useEffect(() => {
    onResult(result, target);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
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
  skipLines,
  standalone,
  onRetry,
  onToAlbum,
  onMore,
}: {
  items: VideoItem[];
  busy: boolean;
  albumLabel: string;
  /** WP38c (38c-13): waarom een origineel niet meegaat; het filmpje staat wel in het album. */
  skipLines: readonly string[];
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
      {done && skipLines.length > 0 && (
        <View style={styles.section}>
          {skipLines.map((line) => (
            <Text key={line} variant="meta" color="muted">
              {line}
            </Text>
          ))}
        </View>
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
          <SmallButton title="Meer selecteren" icon="plus" onPress={onMore} />
        </View>
      )}
    </View>
  );
}

// Invariant 6: het tikvlak van de ×.
const REMOVE_HIT = size.touchMin;

const local = StyleSheet.create({
  countRow: { flexDirection: "row", alignItems: "center", gap: space.s, flexWrap: "wrap" },
  albumRow: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
    borderRadius: radius.listBlock,
  },
  albumValue: { flex: 1, alignItems: "flex-end" },
  timer: { textAlign: "center", fontVariant: ["tabular-nums"] },
  albumText: { textAlign: "right" },
  lines: { gap: space.xs, paddingHorizontal: space.l, paddingVertical: space.m, borderRadius: radius.listBlock },
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
