import { useClerk } from "@clerk/expo";
import { useRef, useState } from "react";
import { Button } from "../components/Button";
import { Notice } from "../components/Notice";
import { LOGIN_MESSAGES } from "../lib/loginErrors";
import { wipeClerkStorage } from "./deviceClerkStorage";

// WP13 invarianten 6 + 11: uitloggen kan in elke ingelogde toestand en laat
// geen token achter. Clerk beëindigt de sessie; daarna wissen we alles wat
// Clerk op het toestel bewaart (WP15a F13). Dat wissen gebeurt altijd, ook
// als signOut faalt. Offline logt Clerk lokaal uit; de sessie op de server
// verloopt vanzelf (besluit R4-1). De Convex-client volgt Clerk en stopt met
// identiteit meesturen. Een mislukte wis toont het inlogscherm (zie
// wipeClerkStorage).
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
    } finally {
      await wipeClerkStorage();
      inFlight.current = false;
      setBusy(false);
    }
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
