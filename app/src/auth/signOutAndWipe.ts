import { restartClerk } from "../data/clerkRestart";
import { clearLastAlbum } from "../data/lastAlbum";
import { clearLastGroup } from "../data/lastGroup";
import { forgetOriginalsOf } from "../data/originals";
import { clearPickMark } from "../data/pendingPick";
import { clearPickerCopies } from "../data/pickerCopies";
import { clearOldShares } from "../data/shareFiles";
import { wipeClerkStorage } from "./deviceClerkStorage";

// WP13 invarianten 6 + 11: uitloggen laat geen token achter. Clerk beëindigt de
// sessie; daarna wissen we alles wat Clerk op het toestel bewaart (WP15a F13).
// Dat wissen gebeurt altijd, ook als signOut faalt. Faalt signOut, dan zit
// Clerk vast zonder sessie: na de wis herstart de app Clerk (herladen), en
// volgt het inlogscherm. Gedeeld door Uitloggen en Account verwijderen (WP29).
// `false`: ook het herstarten mislukte.
//
// WP32 A6: `deletedUserId` alleen na een gelukt "Account verwijderen": dan gaat
// ook de thuisgroep van die user van het toestel. Gewoon uitloggen wist hem
// niet. WP39 (F1): het laatst gekozen album van die user ook. WP38b (38b-4):
// en zijn wachtende originelen (iOS-taken, deelbestanden en bewaarde
// bestanden, met GPS); uitloggen laat ze staan.
export async function signOutAndWipe(
  signOut: () => Promise<unknown>,
  deletedUserId?: string | null,
): Promise<boolean> {
  if (deletedUserId) {
    await clearLastGroup(deletedUserId);
    await clearLastAlbum(deletedUserId);
    await forgetOriginalsOf(deletedUserId).catch(() => {});
  }
  let failed = false;
  try {
    await signOut();
  } catch {
    failed = true;
  }
  await wipeClerkStorage();
  // WP42 A7: op Android blijft het laatst gedeelde bestand staan; bij uitloggen weg.
  clearOldShares();
  // WP42 fix-ronde, punt 3: en wat de kiezer nog had liggen (met plaats).
  clearPickerCopies();
  // WP42c A36: en waarvoor de kiezer openstond (alleen Android).
  clearPickMark();
  if (!failed) return true;
  return await restartClerk().then(
    () => true,
    () => false,
  );
}
