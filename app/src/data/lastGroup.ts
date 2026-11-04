import * as SecureStore from "expo-secure-store";
import { decodeLastGroup, encodeLastGroup } from "../lib/groups";

// WP16 beslissing 4: de laatst bezochte groep staat op het toestel, per user.
// Eén waarde: een groep van een vorige user geeft de volgende niets
// (invariant 6, decodeLastGroup). Een fout bij lezen of schrijven ziet de
// user niet: dan opent Home op Mijn groepen.

const KEY = "clubalmanac.lastGroup";

export async function loadLastGroup(userId: string): Promise<string | null> {
  try {
    return decodeLastGroup(await SecureStore.getItemAsync(KEY), userId);
  } catch {
    return null;
  }
}

export async function saveLastGroup(userId: string, groupId: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, encodeLastGroup(userId, groupId)).catch(() => {});
}

// Alleen als deze groep van deze user onthouden is: een andere groep blijft.
export async function forgetLastGroup(userId: string, groupId: string): Promise<void> {
  if ((await loadLastGroup(userId)) !== groupId) return;
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
}
