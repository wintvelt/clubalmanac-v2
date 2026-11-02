import { useClerk } from "@clerk/expo";
import { useRef, useState } from "react";
import { Button } from "../components/Button";
import { Notice } from "../components/Notice";
import { restartClerk } from "../data/clerkRestart";
import { LOGIN_MESSAGES } from "../lib/loginErrors";
import { wipeClerkStorage } from "./deviceClerkStorage";

// WP13 invarianten 6 + 11: uitloggen kan in elke ingelogde toestand en laat
// geen token achter. Clerk beëindigt de sessie; daarna wissen we alles wat
// Clerk op het toestel bewaart (WP15a F13). Dat wissen gebeurt altijd, ook
// als signOut faalt. Offline logt Clerk lokaal uit; de sessie op de server
// verloopt vanzelf (besluit R4-1). Faalt signOut toch, dan zit Clerk vast
// zonder sessie: na de wis herstart de app Clerk (herladen), en volgt het
// inlogscherm. De Convex-client volgt Clerk en stopt met
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
    let failed = false;
    try {
      await signOut();
    } catch {
      failed = true;
    }
    await wipeClerkStorage();
    if (failed) await restartClerk().catch(() => setError(LOGIN_MESSAGES.generic));
    inFlight.current = false;
    setBusy(false);
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
