import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import * as ImagePicker from "expo-image-picker";
import { router, useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { showActionMenu } from "../components/ActionMenu";
import { Button } from "../components/Button";
import { ListRow, ListSection } from "../components/ListRow";
import { Notice } from "../components/Notice";
import { SmallButton } from "../components/SmallButton";
import { ProfileAvatar } from "../components/Photo";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { TextField } from "../components/TextField";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../convexApi";
import { askConfirmation } from "../data/confirm";
import { PHOTOS_ONLY_TEXTS, PICKER_ASKS_ACCESS } from "../data/pickMedia";
import { clearPickerCopies, removePickerCopies } from "../data/pickerCopies";
import { useUploader, type UploadAsset } from "../data/upload";
import { READ_ONLY, WEB_UPLOAD } from "../data/readOnly";
import { pickProfilePhoto } from "../data/webPick";
import { useLiveQuery } from "../data/useLiveQuery";
import { successTap } from "../data/haptics";
import { nameErrorText } from "../lib/nameError";
import {
  PROFILE_PHOTO_HINT,
  nameIsDirty,
  profilePhotoMenu,
  profilePhotoNotice,
  type ProfilePhotoMenuItem,
} from "../lib/profileEdit";
import {
  applyOutcome,
  newBatch,
  profileRetry,
  reasonText,
  startItem,
  type UploadItem,
} from "../lib/upload";
import { size, space } from "../theme";

// WP15b: naam en e-mailadres, en de naam wijzigen. Een eigen live query
// (users.profile, niet users.current van de poort): zo stopt hij bij een
// tabwissel en is dat in het dashboard te zien (invariant 7). De backend
// bewaakt de naam; de melding komt uit de code van de fout (invariant 10).
//
// WP27 besluit 1: de opbouw van de bewerkschermen van WP28. De foto staat
// gecentreerd bovenaan met een menu, de naam staat er één keer en is
// bewerkbaar, "Bewaar" verschijnt pas na een wijziging (`nameIsDirty`), het
// e-mailadres is alleen te lezen. Een melding staat bij het onderdeel.

type Feedback = { kind: "error"; text: string } | { kind: "saved" } | null;

export function ProfileScreen() {
  const me = useLiveQuery(api.users.profile, {});
  const updateProfile = useMutation(api.users.updateProfile);
  // null: de user typt niet, het veld volgt de live naam (ook als die op een
  // ander toestel wijzigt). Typt hij wel, dan blijft zijn tekst staan.
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const inFlight = useRef(false);
  // Fix-cyclus 1 (F1): de bevestiging en de foutmelding horen bij één bezoek
  // aan Profiel. Verlaat de user Profiel, dan verdwijnen ze. Elk vertrek
  // verhoogt `visit`; een antwoord van een eerder bezoek toont niets meer.
  const focused = useIsFocused();
  const visit = useRef(0);
  useEffect(() => {
    if (!focused) {
      visit.current += 1;
      setFeedback(null);
    }
  }, [focused]);

  if (!me) {
    return (
      <Screen underHeader>
        <LoadingState label="Profiel laden…" />
      </Screen>
    );
  }

  if (READ_ONLY) return <ReadOnlyProfile me={me} />;

  const value = draft ?? me.name ?? "";
  const dirty = nameIsDirty(draft, me.name);

  async function save() {
    // Eén aanroep tegelijk, ook bij dubbel tikken. Zonder wijziging niets.
    if (inFlight.current || !dirty) return;
    inFlight.current = true;
    const startedIn = visit.current;
    setBusy(true);
    setFeedback(null);
    try {
      await updateProfile({ name: value });
      if (visit.current !== startedIn) return;
      setDraft(null);
      setFeedback({ kind: "saved" });
    } catch (error) {
      if (visit.current !== startedIn) return;
      setFeedback({ kind: "error", text: nameErrorText(error) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen underHeader>
      <ProfilePhotoBlock me={me} />

      <View style={styles.group}>
        <TextField
          label="Naam"
          value={value}
          onChangeText={(text) => {
            setDraft(text);
            setFeedback(null);
          }}
          invalid={feedback?.kind === "error"}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="done"
          onSubmitEditing={() => void save()}
        />
        {feedback?.kind === "error" && <Notice kind="error" message={feedback.text} />}
        {(dirty || busy) && (
          <Button title="Bewaar" busyTitle="Bewaren…" onPress={() => void save()} busy={busy} />
        )}
        {feedback?.kind === "saved" && <Notice kind="success" message="Je naam is opgeslagen." />}
      </View>

      <View style={styles.group}>
        <Text variant="fieldLabel">E-mailadres</Text>
        <Text>{me.email}</Text>
        <Text variant="meta" color="muted">
          Met dit adres log je in.
        </Text>
      </View>

      {/* WP19b: ontvangen uitnodigingen. WP20 besluit 4: gemelde foto's en de
          wachtrij van de webmaster, alleen als er iets is. */}
      <ListSection>
        <ListRow title="Uitnodigingen" icon="mail" onPress={() => router.push("/profiel/uitnodigingen")} />
      </ListSection>
      <QueryBoundary fallback={() => null}>
        <FlagRows />
      </QueryBoundary>

      {/* WP29: gevaarlijke rij, in een eigen blok onderaan. */}
      <View style={styles.dangerBlock}>
        <ListSection>
          <ListRow
            title="Account verwijderen"
            icon="trash"
            danger
            chevron
            onPress={() => router.push("/profiel/verwijderen")}
          />
        </ListSection>
      </View>
    </Screen>
  );
}

// WP35 A-invariant W5: op het web alleen bekijken. De foto, de naam en het
// e-mailadres, en de uitnodigingen (accepteren of afwijzen kan wel). Geen
// naam wijzigen, geen meldingen, geen account verwijderen. Uitloggen staat bij
// Instellingen. WP36 (besluit 4, U11): de eigen profielfoto uploaden of
// weghalen kan wel.
function ReadOnlyProfile({ me }: { me: Me }) {
  return (
    <Screen underHeader>
      {WEB_UPLOAD ? (
        <ProfilePhotoBlock me={me} />
      ) : (
        <View style={styles.photo}>
          <ProfileAvatar
            userId={me._id}
            name={me.name}
            size={size.profileAvatar}
            variant="largeTitle"
            exifOrientation={me.profileOrientation}
            version={me.profileVersion}
            hasFormats={me.profileHasFormats}
          />
        </View>
      )}

      <View style={styles.group}>
        <Text variant="fieldLabel">Naam</Text>
        <Text color={me.name ? "text" : "muted"}>{me.name || "Naam onbekend"}</Text>
      </View>

      <View style={styles.group}>
        <Text variant="fieldLabel">E-mailadres</Text>
        <Text>{me.email}</Text>
        <Text variant="meta" color="muted">
          Met dit adres log je in.
        </Text>
      </View>

      <ListSection>
        <ListRow title="Uitnodigingen" icon="mail" onPress={() => router.push("/profiel/uitnodigingen")} />
      </ListSection>
    </Screen>
  );
}

// WP20 besluit 4: "Gemelde foto's" als een eigen foto gemeld is; voor de
// webmaster "Meldingen beoordelen" als er een gemelde foto is. Zonder iets:
// geen rij.
function FlagRows() {
  const mine = useLiveQuery(api.photos.listMyFlagged, {});
  const webmaster = useLiveQuery(api.users.isWebmaster, {});
  const hasMine = (mine?.length ?? 0) > 0;
  return (
    <>
      {hasMine && (
        <ListSection>
          <ListRow title="Gemelde foto's" icon="flag" onPress={() => router.push("/profiel/gemeld")} />
        </ListSection>
      )}
      {webmaster === true && <QueueRow />}
    </>
  );
}

// Alleen gemount voor de webmaster: voor ieder ander weigert de backend.
function QueueRow() {
  const all = useLiveQuery(api.photos.listAllFlagged, {});
  if (!all || all.length === 0) return null;
  return (
    <ListSection>
      <ListRow
        title={`Meldingen beoordelen (${all.length})`}
        icon="flag"
        onPress={() => router.push("/profiel/meldingen")}
      />
    </ListSection>
  );
}

type PhotoFeedback =
  | { kind: "error"; text: string }
  | { kind: "success"; text: string }
  | { kind: "access" }
  | null;

type Me = NonNullable<FunctionReturnType<typeof api.users.profile>>;

// WP18 invarianten 9 en 10, besluit 1. Uploaden: een gewone eigen foto (de
// upload zonder album), daarna `users.setProfilePhoto`. Na het kiezen eerst de
// melding dat een profielfoto voor iedereen te zien is. Weghalen haalt alleen
// de koppeling weg (`users.removeProfilePhoto`); daarna toont de app de letter.
// De avatar volgt overal via `profileVersion`.
//
// WP27: de foto gecentreerd bovenaan, met een menu (`profilePhotoMenu`, vraag
// 2). De foto van een ander kies je in het foto-menu van een album. Een
// verborgen profielfoto (geen toegang meer) heeft versie "0": dan toont de
// app de letter en is er niets weg te halen (A-keuze 3).
//
// WP36 (besluit 4, vraag 8): op het web dezelfde stappen, met de kiezer van
// de browser (in de tik, één foto, een vierkant uit het midden: B6), twee
// knoppen in plaats van het actiemenu, de bevestiging van de browser, en
// zonder de hulptekst over het foto-menu (dat is er op het web niet).
function ProfilePhotoBlock({ me }: { me: Me }) {
  const hasPhoto = me.profileVersion !== "0";
  const upload = useUploader();
  const setProfilePhoto = useMutation(api.users.setProfilePhoto);
  const removeProfilePhoto = useMutation(api.users.removeProfilePhoto);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [feedback, setFeedback] = useState<PhotoFeedback>(null);
  const inFlight = useRef(false);
  // Fix-cyclus 1, invariant 21: de laatste keuze, met zijn upload-id en hoe
  // ver hij kwam. "Opnieuw proberen" vraagt profileRetry wat er nog moet.
  const [attempt, setAttempt] = useState<{ asset: UploadAsset; item: UploadItem } | null>(null);
  // WP42 fix-ronde, punt 3: de kopie van de kiezer van de laatste keuze. Weg
  // zodra hij niet meer nodig is: opgeslagen, niet gebruikt, een nieuwe keuze,
  // of het scherm uit beeld; na een fout blijft hij voor "Opnieuw proberen".
  // Bij bijsnijden maakt de kiezer op Android ook een kopie van het origineel
  // (met plaats); klaar met de keuze, dan daarom de hele map van de kiezer
  // leeg (het toevoegscherm is dan niet open: dat ligt over de tabs).
  const keptCopy = useRef<string | null>(null);
  function keepCopy(asset: UploadAsset | null) {
    const uri = asset && "uri" in asset ? asset.uri : null;
    if (keptCopy.current && keptCopy.current !== uri) {
      if (uri) removePickerCopies([keptCopy.current]);
      else clearPickerCopies();
    }
    keptCopy.current = uri;
  }
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) {
      setFeedback(null);
      setAttempt(null);
      if (!inFlight.current) keepCopy(null);
    }
  }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => keepCopy(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(kind: "upload" | "remove", work: () => Promise<PhotoFeedback>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    setFeedback(null);
    try {
      const result = await work();
      setFeedback(result);
      // WP33 invariant 10 (besluit 2): weghalen na de rode bevestigingsknop is gelukt.
      if (kind === "remove" && result?.kind === "success") successTap();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function choose() {
    if (inFlight.current) return;
    setFeedback(null);
    setAttempt(null);
    // WP36 U9: in de tik zelf; null is annuleren.
    if (WEB_UPLOAD) {
      // Eerst het bestand controleren, dan pas de vraag "openbaar".
      let picked: Awaited<ReturnType<typeof pickProfilePhoto>>;
      try {
        picked = await pickProfilePhoto();
      } catch {
        picked = { reason: "formaat" };
      }
      if (!picked) return;
      if ("reason" in picked) {
        setFeedback({ kind: "error", text: `Profielfoto niet opgeslagen. ${reasonText(picked.reason)}.` });
        return;
      }
      await confirmAndSave(picked.photo);
      return;
    }
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        // Geen EXIF: met bijsnijden gebruikt iOS de oude kiezer, en die vraagt
        // voor de EXIF toegang tot de hele bibliotheek (gezien in de
        // simulator). Zonder vraagt hij niets; een openbare profielfoto krijgt
        // zo ook geen locatie mee.
        exif: false,
        quality: 1,
      });
    } catch {
      // WP42 A6: de fotokiezer van Android vraagt geen toegang; dan mislukte het ophalen.
      if (PICKER_ASKS_ACCESS) setFeedback({ kind: "access" });
      else setFeedback({ kind: "error", text: PHOTOS_ONLY_TEXTS?.fetchFailed ?? "Je keuze ophalen lukte niet." });
      return;
    }
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    keepCopy(asset);
    await confirmAndSave(asset);
  }

  async function confirmAndSave(asset: UploadAsset) {
    const notice = profilePhotoNotice({ isMe: true });
    const ok = await confirm(notice.title, notice.message, "Gebruiken");
    if (!ok) {
      keepCopy(null);
      return;
    }
    // Eén upload-id voor deze keuze: een dubbele tik of "Opnieuw proberen"
    // geeft geen tweede foto.
    const [item] = newBatch(["profiel"]);
    await save(asset, item!);
  }

  // Uploaden (als dat nog moet) en opslaan als profielfoto. Wat lukte, blijft
  // in `attempt` staan, zodat opnieuw proberen alleen de rest doet.
  async function save(asset: UploadAsset, start: UploadItem) {
    await run("upload", async () => {
      let item = start;
      if (item.state !== "klaar") {
        item = startItem([item], item.key)[0]!;
        const outcome = await upload({ asset, uploadId: item.uploadId });
        item = applyOutcome([item], item.key, outcome)[0]!;
        setAttempt({ asset, item });
        if (!outcome.ok) {
          return { kind: "error", text: `Profielfoto niet opgeslagen. ${reasonText(outcome.reason)}.` };
        }
      }
      try {
        await setProfilePhoto({ photoId: item.photoId as Id<"photos"> });
      } catch {
        setAttempt({ asset, item });
        return { kind: "error", text: "Profielfoto niet opgeslagen. Probeer het opnieuw." };
      }
      setAttempt(null);
      keepCopy(null);
      return { kind: "success", text: "Je profielfoto is opgeslagen." };
    });
  }

  function retry() {
    if (!attempt || profileRetry(attempt.item) === null) return;
    void save(attempt.asset, attempt.item);
  }

  async function remove() {
    if (inFlight.current) return;
    const ok = await confirm(
      "Profielfoto weghalen?",
      "Daarna staat overal je letter. De foto zelf blijft bij je eigen foto's.",
      "Weghalen",
      true,
    );
    if (!ok) return;
    await run("remove", async () => {
      try {
        await removeProfilePhoto({});
      } catch {
        return { kind: "error", text: "Profielfoto niet weggehaald. Probeer het opnieuw." };
      }
      return { kind: "success", text: "Je profielfoto is weggehaald." };
    });
  }

  function openMenu() {
    if (inFlight.current) return;
    setFeedback(null);
    const items = profilePhotoMenu({ hasPhoto });
    const options = [...items.map((i) => MENU_LABEL[i](hasPhoto)), "Annuleren"];
    const destructive = items.indexOf("remove");
    showActionMenu(
      {
        options,
        cancelButtonIndex: options.length - 1,
        ...(destructive >= 0 ? { destructiveButtonIndex: destructive } : {}),
      },
      (index) => {
        const item = items[index];
        if (item === "upload") void choose();
        if (item === "remove") void remove();
      },
    );
  }

  return (
    <View style={styles.photo}>
      <ProfileAvatar
        userId={me._id}
        name={me.name}
        size={size.profileAvatar}
        variant="largeTitle"
        exifOrientation={me.profileOrientation}
        version={me.profileVersion}
        hasFormats={me.profileHasFormats}
      />
      {WEB_UPLOAD ? (
        <View style={styles.webActions}>
          {profilePhotoMenu({ hasPhoto }).map((item) => (
            <SmallButton
              key={item}
              title={
                busy === "upload" && item === "upload"
                  ? "Opslaan…"
                  : busy === "remove" && item === "remove"
                    ? "Weghalen…"
                    : MENU_LABEL[item](hasPhoto)
              }
              icon={item === "upload" ? "photos" : "trash"}
              disabled={busy !== null}
              onPress={item === "upload" ? () => void choose() : () => void remove()}
            />
          ))}
        </View>
      ) : (
        <View style={styles.center}>
          <SmallButton
            title={busy === "upload" ? "Opslaan…" : busy === "remove" ? "Weghalen…" : "Profielfoto"}
            icon="more"
            accessibilityLabel="Acties voor je profielfoto"
            disabled={busy !== null}
            onPress={openMenu}
          />
        </View>
      )}
      {feedback?.kind === "error" && (
        <Notice kind="error" message={feedback.text}>
          {attempt && profileRetry(attempt.item) !== null && (
            <SmallButton title="Opnieuw proberen" icon="refresh" disabled={busy !== null} onPress={retry} />
          )}
        </Notice>
      )}
      {feedback?.kind === "success" && <Notice kind="success" message={feedback.text} />}
      {feedback?.kind === "access" && (
        <Notice kind="error" title="Toegang tot je foto's nodig">
          <Text variant="meta">Geef in Instellingen toegang tot je foto's, dan kun je er hier een kiezen.</Text>
          <SmallButton title="Instellingen openen" onPress={() => void Linking.openSettings()} />
        </Notice>
      )}
      {!WEB_UPLOAD && (
        <Text variant="meta" color="muted" style={styles.centerText}>
          {PROFILE_PHOTO_HINT}
        </Text>
      )}
    </View>
  );
}

const MENU_LABEL: Record<ProfilePhotoMenuItem, (hasPhoto: boolean) => string> = {
  upload: (hasPhoto) => (hasPhoto ? "Andere foto kiezen" : "Foto kiezen"),
  remove: () => "Profielfoto weghalen",
};

// Op iOS dezelfde Alert als voorheen (src/data/confirm.ts); op het web de
// vraag van de browser (confirm.web.ts, WP35 W7), want `Alert.alert` doet daar
// niets.
function confirm(title: string, message: string, action: string, destructive = false): Promise<boolean> {
  return askConfirmation({ title, message, button: action, destructive });
}

const styles = StyleSheet.create({
  group: { gap: space.s },
  photo: { alignItems: "center", gap: space.s },
  center: { alignItems: "center" },
  centerText: { textAlign: "center" },
  webActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space.s },
  dangerBlock: { marginTop: space.xl },
});
