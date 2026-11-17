import * as SecureStore from "expo-secure-store";

// WP32 invariant 3, A5, A6 en A10: de thuisgroep staat op het toestel, per
// user (sleutel op de Clerk-user-id). Een ander account op hetzelfde toestel
// ziet en overschrijft hem niet. Een fout bij lezen of schrijven ziet de user
// niet: dan "niets opgeslagen".
//
// Daarnaast een geheugen voor deze app-sessie: een bezoek is meteen te lezen
// (lastGroupNow), ook als het toestel nog schrijft of het schrijven mislukt.
// De oude toestel-brede waarde van WP16 ("clubalmanac.lastGroup", alleen in
// testbuilds) wordt genegeerd.

const PREFIX = "clubalmanac.homeGroup.";

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

type Listener = () => void;

// undefined (geen entry): nog niet gelezen; null: niets opgeslagen.
const memory = new Map<string, string | null>();
const listeners = new Set<Listener>();

function set(userId: string, groupId: string | null): void {
  if (memory.has(userId) && memory.get(userId) === groupId) return;
  memory.set(userId, groupId);
  for (const l of listeners) l();
}

export function lastGroupNow(userId: string): string | null | undefined {
  return memory.get(userId);
}

export function subscribeLastGroup(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadLastGroup(userId: string): Promise<string | null> {
  if (memory.has(userId)) return memory.get(userId) ?? null;
  let stored: string | null = null;
  try {
    const raw = await SecureStore.getItemAsync(keyFor(userId));
    stored = raw && raw.length > 0 ? raw : null;
  } catch {
    stored = null;
  }
  // Een bezoek tijdens het lezen is nieuwer dan wat het toestel had.
  if (!memory.has(userId)) set(userId, stored);
  return memory.get(userId) ?? null;
}

export async function saveLastGroup(userId: string, groupId: string): Promise<void> {
  set(userId, groupId);
  try {
    await SecureStore.setItemAsync(keyFor(userId), groupId);
  } catch {
    // A10: de groep blijft deze sessie toch de thuisgroep.
  }
}

async function remove(userId: string): Promise<void> {
  set(userId, null);
  try {
    await SecureStore.deleteItemAsync(keyFor(userId));
  } catch {
    // Stil: de user ziet het niet.
  }
}

// Alleen als dit de groep van deze user is: een andere groep blijft.
export async function forgetLastGroup(userId: string, groupId: string): Promise<void> {
  if ((await loadLastGroup(userId)) !== groupId) return;
  await remove(userId);
}

// A6: account verwijderen, pas na het gelukte verwijderen.
export async function clearLastGroup(userId: string): Promise<void> {
  await remove(userId);
}
