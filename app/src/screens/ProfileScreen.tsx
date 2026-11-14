import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import * as ImagePicker from "expo-image-picker";
import { router, useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActionSheetIOS, Alert, Linking, StyleSheet, View } from "react-native";
import { Button } from "../components/Button";
import { ListRow, ListSection } from "../components/ListRow";
import { Notice } from "../components/Notice";
import { SmallButton } from "../components/SmallButton";
import { ProfileAvatar } from "../components/Photo";
import { Screen } from "../components/Screen";
import { LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { TextField } from "../components/TextField";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../convexApi";
import { useUploader } from "../data/upload";
import { useLiveQuery } from "../data/useLiveQuery";
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

      {/* WP19b: ontvangen uitnodigingen. */}
      <ListSection>
        <ListRow title="Uitnodigingen" icon="mail" onPress={() => router.push("/profiel/uitnodigingen")} />
      </ListSection>

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
  const [attempt, setAttempt] = useState<{ asset: ImagePicker.ImagePickerAsset; item: UploadItem } | null>(null);
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) {
      setFeedback(null);
      setAttempt(null);
    }
  }, [focused]);

  async function run(kind: "upload" | "remove", work: () => Promise<PhotoFeedback>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    setFeedback(null);
    try {
      setFeedback(await work());
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function choose() {
    if (inFlight.current) return;
    setFeedback(null);
    setAttempt(null);
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
      setFeedback({ kind: "access" });
      return;
    }
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    const notice = profilePhotoNotice({ isMe: true });
    const ok = await confirm(notice.title, notice.message, "Gebruiken");
    if (!ok) return;
    // Eén upload-id voor deze keuze: een dubbele tik of "Opnieuw proberen"
    // geeft geen tweede foto.
    const [item] = newBatch(["profiel"]);
    await save(asset, item!);
  }

  // Uploaden (als dat nog moet) en opslaan als profielfoto. Wat lukte, blijft
  // in `attempt` staan, zodat opnieuw proberen alleen de rest doet.
  async function save(asset: ImagePicker.ImagePickerAsset, start: UploadItem) {
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
    ActionSheetIOS.showActionSheetWithOptions(
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
      <View style={styles.center}>
        <SmallButton
          title={busy === "upload" ? "Opslaan…" : busy === "remove" ? "Weghalen…" : "Profielfoto"}
          icon="more"
          accessibilityLabel="Acties voor je profielfoto"
          disabled={busy !== null}
          onPress={openMenu}
        />
      </View>
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
      <Text variant="meta" color="muted" style={styles.centerText}>
        {PROFILE_PHOTO_HINT}
      </Text>
    </View>
  );
}

const MENU_LABEL: Record<ProfilePhotoMenuItem, (hasPhoto: boolean) => string> = {
  upload: (hasPhoto) => (hasPhoto ? "Andere foto kiezen" : "Foto kiezen"),
  remove: () => "Profielfoto weghalen",
};

function confirm(title: string, message: string, action: string, destructive = false): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Annuleren", style: "cancel", onPress: () => resolve(false) },
        { text: action, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

const styles = StyleSheet.create({
  group: { gap: space.s },
  photo: { alignItems: "center", gap: space.s },
  center: { alignItems: "center" },
  centerText: { textAlign: "center" },
  dangerBlock: { marginTop: space.xl },
});
