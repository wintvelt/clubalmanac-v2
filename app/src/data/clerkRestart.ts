import { reloadAppAsync } from "expo";

// WP15a: Clerk opnieuw starten = de app herladen. Clerk is een singleton: een
// nieuwe ClerkProvider (nieuwe key) laadt niets opnieuw. Na het herladen leest
// Clerk de opslag opnieuw: na een wis is dat het inlogscherm.
export function restartClerk(): Promise<void> {
  return reloadAppAsync("Clerk opnieuw starten");
}
