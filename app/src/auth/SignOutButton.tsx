import { useClerk } from "@clerk/expo";
import { useRef, useState } from "react";
import { Button } from "../components/Button";
import { Notice } from "../components/Notice";
import { LOGIN_MESSAGES } from "../lib/loginErrors";
import { wipeStoredTokens } from "./tokenCache";

// WP13 invarianten 6 + 11: uitloggen kan in elke ingelogde toestand en laat
// geen token achter. Clerk beëindigt de sessie; daarna wissen we wat Clerk in
// de keychain zette. De Convex-client volgt Clerk en stopt met identiteit
// meesturen. Een mislukte wis toont het inlogscherm (zie wipeStoredTokens).
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
    } catch {
      setError(LOGIN_MESSAGES.generic);
      return;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
    await wipeStoredTokens();
  }

  return (
    <>
      <Button
        title="Uitloggen"
        busyTitle="Uitloggen…"
        variant="secondary"
        onPress={onPress}
        busy={busy}
      />
      {error && <Notice kind="error" message={error} />}
    </>
  );
}
