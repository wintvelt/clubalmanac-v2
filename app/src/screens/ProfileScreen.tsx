import { useMutation } from "convex/react";
import * as ImagePicker from "expo-image-picker";
import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking, StyleSheet, View } from "react-native";
import { Button } from "../components/Button";
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
import { newBatch, reasonText } from "../lib/upload";
import { size, space } from "../theme";

// WP15b: naam en e-mailadres, en de naam wijzigen. Een eigen live query
// (users.profile, niet users.current van de poort): zo stopt hij bij een
// tabwissel en is dat in het dashboard te zien (invariant 7). De backend
// bewaakt de naam; de melding komt uit de code van de fout (invariant 10).

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

  async function save() {
    // Eén aanroep tegelijk, ook bij dubbel tikken.
    if (inFlight.current) return;
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
      <View style={styles.head}>
        {/* WP17a: de eigen profielfoto via het openbare profielpad, anders de letter. */}
        <ProfileAvatar
          userId={me._id}
          name={me.name}
          size={size.profileAvatar}
          variant="largeTitle"
          exifOrientation={me.profileOrientation}
          version={me.profileVersion}
          hasFormats={me.profileHasFormats}
        />
        <Text variant="title" accessibilityRole="header" style={styles.headText}>
          {me.name || "Nog geen naam"}
        </Text>
      </View>

      <View style={styles.group}>
        <Text variant="fieldLabel">E-mailadres</Text>
        <Text>{me.email}</Text>
        <Text variant="meta" color="muted">
          Met dit adres log je in.
        </Text>
      </View>

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
      </View>

      <Button title="Naam opslaan" busyTitle="Opslaan…" onPress={() => void save()} busy={busy} />
      {feedback?.kind === "saved" && <Notice kind="success" message="Je naam is opgeslagen." />}

      <ProfilePhotoActions hasPhoto={me.profileVersion !== "0"} />
    </Screen>
  );
}

type PhotoFeedback =
  | { kind: "error"; text: string }
  | { kind: "success"; text: string }
  | { kind: "access" }
  | null;

// WP18 invarianten 9 en 10, besluit 1. Uploaden: een gewone eigen foto (de
// upload zonder album), daarna `users.setProfilePhoto`. Na het kiezen eerst de
// melding dat een profielfoto voor iedereen te zien is. Weghalen haalt alleen
// de koppeling weg (`users.removeProfilePhoto`); daarna toont de app de letter.
// De avatar volgt overal via `profileVersion`.
function ProfilePhotoActions({ hasPhoto }: { hasPhoto: boolean }) {
  const upload = useUploader();
  const setProfilePhoto = useMutation(api.users.setProfilePhoto);
  const removeProfilePhoto = useMutation(api.users.removeProfilePhoto);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [feedback, setFeedback] = useState<PhotoFeedback>(null);
  const inFlight = useRef(false);
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) setFeedback(null);
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
    const ok = await confirm(
      "Profielfoto is openbaar",
      "Je profielfoto is voor iedereen te zien, ook voor wie niet in je groepen zit.",
      "Gebruiken",
    );
    if (!ok) return;
    // Eén upload-id voor deze keuze: een dubbele tik geeft geen tweede foto.
    const [item] = newBatch(["profiel"]);
    await run("upload", async () => {
      const outcome = await upload({ asset, uploadId: item!.uploadId });
      if (!outcome.ok) return { kind: "error", text: `Profielfoto niet opgeslagen. ${reasonText(outcome.reason)}.` };
      try {
        await setProfilePhoto({ photoId: outcome.photoId as Id<"photos"> });
      } catch {
        return { kind: "error", text: "Profielfoto niet opgeslagen. Probeer het opnieuw." };
      }
      return { kind: "success", text: "Je profielfoto is opgeslagen." };
    });
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

  return (
    <View style={styles.group}>
      <Text variant="fieldLabel">Profielfoto</Text>
      <View style={styles.row}>
        <SmallButton
          title={busy === "upload" ? "Opslaan…" : hasPhoto ? "Andere foto kiezen" : "Foto kiezen"}
          icon="photos"
          disabled={busy !== null}
          onPress={() => void choose()}
        />
        {hasPhoto && (
          <SmallButton
            title={busy === "remove" ? "Weghalen…" : "Weghalen"}
            icon="trash"
            tone="danger"
            disabled={busy !== null}
            onPress={() => void remove()}
          />
        )}
      </View>
      {feedback?.kind === "error" && <Notice kind="error" message={feedback.text} />}
      {feedback?.kind === "success" && <Notice kind="success" message={feedback.text} />}
      {feedback?.kind === "access" && (
        <Notice kind="error" title="Toegang tot je foto's nodig">
          <Text variant="meta">Geef in Instellingen toegang tot je foto's, dan kun je er hier een kiezen.</Text>
          <SmallButton title="Instellingen openen" onPress={() => void Linking.openSettings()} />
        </Notice>
      )}
    </View>
  );
}

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
  head: { flexDirection: "row", alignItems: "center", gap: space.l },
  headText: { flex: 1 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
});
