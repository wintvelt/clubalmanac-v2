import type { TokenCache } from "@clerk/expo";
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

export async function clearStoredTokens(): Promise<void> {
  const store = requireSecureStore();
  await Promise.all([...touchedKeys].map((key) => store.clearToken?.(key)));
}
