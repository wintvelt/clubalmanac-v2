import type { TokenCache } from "@clerk/expo";
import { useSyncExternalStore } from "react";
import { tokenCache as secureStoreTokenCache } from "@clerk/expo/token-cache";

// WP13 invarianten 5 + 6. Clerk bewaart via deze cache zijn client-token in de
// iOS-keychain (expo-secure-store), zodat de sessie een herstart overleeft.
// Clerk ruimt dat token bij uitloggen niet op. Deze wrapper onthoudt welke
// sleutels Clerk gebruikt en wist ze bij uitloggen.

const touchedKeys = new Set<string>();

function requireSecureStore(): TokenCache {
  // undefined alleen op web; deze app is iOS (Track A).
  if (!secureStoreTokenCache) {
    throw new Error("Veilige opslag (expo-secure-store) is niet beschikbaar.");
  }
  return secureStoreTokenCache;
}

export const tokenCache: TokenCache = {
  getToken: (key) => {
    touchedKeys.add(key);
    return requireSecureStore().getToken(key);
  },
  saveToken: (key, token) => {
    touchedKeys.add(key);
    return requireSecureStore().saveToken(key, token);
  },
  clearToken: (key) => requireSecureStore().clearToken?.(key),
};

// Mislukt het wissen na een geslaagde signOut, dan is de user al uitgelogd en
// staat het inlogscherm er. Dat scherm leest deze vlag, toont de fout en laat
// opnieuw wissen.
let wipeFailed = false;
const listeners = new Set<() => void>();

function setWipeFailed(value: boolean) {
  if (wipeFailed === value) return;
  wipeFailed = value;
  listeners.forEach((listener) => listener());
}

export async function wipeStoredTokens(): Promise<boolean> {
  try {
    const store = requireSecureStore();
    await Promise.all([...touchedKeys].map((key) => store.clearToken?.(key)));
    setWipeFailed(false);
    return true;
  } catch {
    setWipeFailed(true);
    return false;
  }
}

export function useTokenWipeFailed(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => wipeFailed,
  );
}
