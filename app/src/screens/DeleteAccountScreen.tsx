import { useClerk } from "@clerk/expo";
import { useMutation } from "convex/react";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { signOutAndWipe } from "../auth/signOutAndWipe";
import { Button } from "../components/Button";
import { Notice } from "../components/Notice";
import { Screen } from "../components/Screen";
import { Text } from "../components/Text";
import { TextField } from "../components/TextField";
import { api } from "../convexApi";
import {
  CONFIRM_WORD,
  confirmWordTyped,
  setAccountDeleted,
  setAccountDeleting,
} from "../data/accountDeletion";
import { space } from "../theme";

// WP29: account verwijderen (Apple-eis). Uitleg wat er weggaat, dan het woord
// `verwijder` intypen; pas dan is de knop actief (spec §Advies open vraag 1).
// `users.deleteSelf` sluit het account direct af; de backend ruimt daarna alles
// op en verwijdert de login. Lukt de aanroep, dan logt de app uit en toont het
// inlogscherm de bevestiging (invariant 7). Lukt hij niet, dan blijft de app
// ingelogd en is er niets gewist.

const WHAT_GOES = [
  "Al je foto's, ook in de albums van je groepen.",
  "Je lidmaatschappen.",
  "Je login: met dit e-mailadres kun je daarna niet meer inloggen.",
  "Ben je oprichter van een groep, dan neemt een ander lid het over. Ben je het laatste lid, dan verdwijnt de groep.",
];

export function DeleteAccountScreen() {
  const deleteSelf = useMutation(api.users.deleteSelf);
  const { signOut } = useClerk();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // Fix-cyclus 3: met het veld actief (toetsenbord open) houdt het scherm de
  // knop eronder in beeld. De return-toets sluit alleen het toetsenbord; alleen
  // de tik op de knop verwijdert.
  const [focused, setFocused] = useState(false);
  const inFlight = useRef(false);
  const ready = confirmWordTyped(typed);

  async function onDelete() {
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    // Vóór de aanroep: zodra hij lukt, is users.current `null`, en de poort
    // moet dan niet "Je account is nog niet klaar" tonen.
    setAccountDeleting(true);
    try {
      await deleteSelf({});
    } catch {
      setAccountDeleting(false);
      setError(true);
      inFlight.current = false;
      setBusy(false);
      return;
    }
    setAccountDeleted(true);
    await signOutAndWipe(signOut);
    setAccountDeleting(false);
  }

  return (
    <Screen underHeader keepEndInView={focused}>
      <Text>
        Je account verwijderen is definitief. Het kan niet ongedaan worden gemaakt. Dit gaat weg:
      </Text>
      <View style={styles.list}>
        {WHAT_GOES.map((item) => (
          <View key={item} style={styles.bullet}>
            <Text accessible={false}>•</Text>
            <Text style={styles.bulletText}>{item}</Text>
          </View>
        ))}
      </View>
      <Text color="muted">
        Wil je later weer meedoen, dan moet iemand je opnieuw uitnodigen. Je begint dan met een leeg
        account.
      </Text>

      <TextField
        label={`Typ "${CONFIRM_WORD}" om te bevestigen`}
        value={typed}
        onChangeText={(text) => {
          setTyped(text);
          setError(false);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="done"
        editable={!busy}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <Button
        title="Account verwijderen"
        busyTitle="Verwijderen…"
        icon="trash"
        onPress={() => void onDelete()}
        busy={busy}
        disabled={!ready}
      />
      {error && (
        <Notice
          kind="error"
          title="Account niet verwijderd"
          message="Er is niets gewist. Controleer je verbinding en probeer het opnieuw."
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
  bullet: { flexDirection: "row", gap: space.s },
  bulletText: { flex: 1 },
});
