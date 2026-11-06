import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { wipeImageCache } from "../data/images";
import { createClerkStorage, type ClerkStorage, type SecureBackend } from "./clerkStorage";

// De opslag van Clerk op dit toestel (WP15a F13): de keychain via
// expo-secure-store. Eén instantie per app-start; App.tsx maakt hem met de
// publishable key, uitloggen en inloggen gebruiken dezelfde.

const OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

const backend: SecureBackend = {
  getItem: (key) => SecureStore.getItemAsync(key, OPTIONS),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  deleteItem: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};

let storage: ClerkStorage | null = null;

export function deviceClerkStorage(publishableKey: string): ClerkStorage {
  storage ??= createClerkStorage(backend, publishableKey);
  return storage;
}

function current(): ClerkStorage {
  if (!storage) throw new Error("De opslag van Clerk is nog niet gemaakt.");
  return storage;
}

// Vóór het eerste verzoek van een login: anders bewaart de opslag het
// client-token niet, en raakt Clerk de poging kwijt.
export function resumeClerkStorage(): Promise<void> {
  return current().resume();
}

// Mislukt het wissen, dan is de user wel uitgelogd en staat het inlogscherm
// er. Dat scherm leest deze vlag, toont de fout en laat opnieuw wissen.
let wipeFailed = false;
const listeners = new Set<() => void>();

function setWipeFailed(value: boolean) {
  if (wipeFailed === value) return;
  wipeFailed = value;
  listeners.forEach((listener) => listener());
}

// WP17a besluit 3: ook de beeldcache op het toestel gaat weg, op de paden die
// deze functie aanroepen: de uitlog-knop, "Opnieuw inloggen" en opnieuw
// wissen na een mislukte wis. Eindigt de Clerk-sessie op een andere manier
// (ingetrokken, verlopen, account gewist), dan blijft de cache staan.
// expo-image geeft een beeld uit de cache op `cacheKey`, zonder verzoek naar
// het beeldpad, dus zonder toegangscheck. Wat de volgende user op dit toestel
// tegen die beelden beschermt, is dat de app alleen foto-id's rendert uit
// queries met een toegangscheck. Best effort: een mislukte beeldwis houdt het
// wissen van Clerk niet tegen.
export async function wipeClerkStorage(): Promise<boolean> {
  await wipeImageCache().catch(() => false);
  const ok = await current().wipe().catch(() => false);
  setWipeFailed(!ok);
  return ok;
}

export function useClerkWipeFailed(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => wipeFailed,
  );
}
