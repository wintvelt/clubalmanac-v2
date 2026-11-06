import { useMutation } from "convex/react";
import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../components/Button";
import { Notice } from "../components/Notice";
import { ProfileAvatar } from "../components/Photo";
import { Screen } from "../components/Screen";
import { LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { TextField } from "../components/TextField";
import { api } from "../convexApi";
import { useLiveQuery } from "../data/useLiveQuery";
import { nameErrorText } from "../lib/nameError";
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
        <ProfileAvatar userId={me._id} name={me.name} size={size.profileAvatar} variant="largeTitle" />
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.s },
  head: { flexDirection: "row", alignItems: "center", gap: space.l },
  headText: { flex: 1 },
});
