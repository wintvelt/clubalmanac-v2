import { useClerk } from "@clerk/expo";
import { useRef, useState } from "react";
import { Text } from "react-native";
import { Button } from "../components/Button";
import { LOGIN_MESSAGES } from "../lib/loginErrors";
import { ui } from "../ui";
import { clearStoredTokens } from "./tokenCache";

// WP13 invarianten 6 + 11: uitloggen kan in elke ingelogde toestand en laat
// geen token achter. Clerk beëindigt de sessie; daarna wissen we wat Clerk in
// de keychain zette. De Convex-client volgt Clerk en stopt met identiteit
// meesturen.
export function SignOutButton() {
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function onPress() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await signOut();
      await clearStoredTokens();
    } catch {
      setError(LOGIN_MESSAGES.generic);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Button title="Uitloggen" onPress={onPress} busy={busy} />
      {error && <Text style={ui.error}>{error}</Text>}
    </>
  );
}
