import { restartClerk } from "../data/clerkRestart";
import { wipeClerkStorage } from "./deviceClerkStorage";

// WP13 invarianten 6 + 11: uitloggen laat geen token achter. Clerk beëindigt de
// sessie; daarna wissen we alles wat Clerk op het toestel bewaart (WP15a F13).
// Dat wissen gebeurt altijd, ook als signOut faalt. Faalt signOut, dan zit
// Clerk vast zonder sessie: na de wis herstart de app Clerk (herladen), en
// volgt het inlogscherm. Gedeeld door Uitloggen en Account verwijderen (WP29).
// `false`: ook het herstarten mislukte.
export async function signOutAndWipe(signOut: () => Promise<unknown>): Promise<boolean> {
  let failed = false;
  try {
    await signOut();
  } catch {
    failed = true;
  }
  await wipeClerkStorage();
  if (!failed) return true;
  return await restartClerk().then(
    () => true,
    () => false,
  );
}
