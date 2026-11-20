import { wipeImageCache } from "../data/images";

// WP35 A-invariant W6: op het web geen expo-secure-store (de module is daar
// leeg). Clerk bewaart de sessie in de browser zelf, in zijn cookies; een
// eigen token-opslag en resource-cache gebruikt @clerk/expo op het web niet.
// Deze module heeft dezelfde vorm als deviceClerkStorage.ts, zodat App.tsx,
// inloggen en uitloggen niet veranderen.
//
// Uitloggen (`signOut`) haalt de sessie van Clerk weg; hier leegt het wissen
// alleen het beeldgeheugen (W3). Er is niets op schijf dat kan mislukken, dus
// nooit "wissen mislukt".

type WebClerkStorage = { tokenCache: undefined; resourceCache: undefined };

const storage: WebClerkStorage = { tokenCache: undefined, resourceCache: undefined };

export function deviceClerkStorage(_publishableKey: string): WebClerkStorage {
  return storage;
}

export function resumeClerkStorage(): Promise<void> {
  return Promise.resolve();
}

export async function wipeClerkStorage(): Promise<boolean> {
  await wipeImageCache().catch(() => false);
  return true;
}

export function useClerkWipeFailed(): boolean {
  return false;
}
