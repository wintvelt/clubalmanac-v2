import * as SecureStore from "expo-secure-store";
import type { StoredAlbum } from "../lib/lastAlbum";

// WP39 fixronde gate 1, besluit 1 (F1): het laatst gekozen album op het
// toestel, per user (sleutel op de Clerk-user-id), zoals de thuisgroep (WP32,
// lastGroup.ts). Een ander account op hetzelfde toestel ziet en overschrijft
// het niet. Een fout bij lezen of schrijven ziet de user niet: dan "niets
// onthouden". Account verwijderen wist het (signOutAndWipe), uitloggen niet.

const PREFIX = "clubalmanac.lastAlbum.";

// SecureStore neemt alleen letters, cijfers, ".", "-" en "_" als sleutel.
// Elk ander teken (ook "_", "-" en ".") wordt "_<hex>-": zo valt geen id
// samen met een ander.
function keyFor(userId: string): string {
  let out = "";
  for (const ch of userId) {
    out += /^[A-Za-z0-9]$/.test(ch) ? ch : `_${ch.codePointAt(0)!.toString(16)}-`;
  }
  return PREFIX + out;
}

function parse(raw: string | null): StoredAlbum | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { albumId, groupId } = v as Record<string, unknown>;
    if (typeof albumId !== "string" || typeof groupId !== "string" || !albumId || !groupId) return null;
    return { albumId, groupId };
  } catch {
    return null;
  }
}

export async function loadLastAlbum(userId: string): Promise<StoredAlbum | null> {
  try {
    return parse(await SecureStore.getItemAsync(keyFor(userId)));
  } catch {
    return null;
  }
}

export async function saveLastAlbum(userId: string, album: StoredAlbum): Promise<void> {
  try {
    await SecureStore.setItemAsync(keyFor(userId), JSON.stringify({ albumId: album.albumId, groupId: album.groupId }));
  } catch {
    // Stil: dan wordt het album niet onthouden.
  }
}

async function remove(userId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(keyFor(userId));
  } catch {
    // Stil: de user ziet het niet.
  }
}

// Alleen als dit het onthouden album is: een ander album blijft.
export async function forgetLastAlbum(userId: string, albumId: string): Promise<void> {
  if ((await loadLastAlbum(userId))?.albumId !== albumId) return;
  await remove(userId);
}

// Account verwijderen, pas na het gelukte verwijderen.
export async function clearLastAlbum(userId: string): Promise<void> {
  await remove(userId);
}
