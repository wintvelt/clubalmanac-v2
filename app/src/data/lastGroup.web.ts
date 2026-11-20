// WP35 A-invariant W6: op het web staat de thuisgroep alleen in het geheugen
// van dit tabblad, per user (de Clerk-user-id). Niets in de browser bewaard:
// na herladen of in een ander tabblad kiest Home opnieuw, en een volgende user
// in dezelfde browser ziet niets van de vorige. Dezelfde vorm als
// lastGroup.ts (iOS, met de keychain).

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
  if (!memory.has(userId)) set(userId, null);
  return memory.get(userId) ?? null;
}

export async function saveLastGroup(userId: string, groupId: string): Promise<void> {
  set(userId, groupId);
}

export async function forgetLastGroup(userId: string, groupId: string): Promise<void> {
  if ((await loadLastGroup(userId)) !== groupId) return;
  set(userId, null);
}

export async function clearLastGroup(userId: string): Promise<void> {
  set(userId, null);
}
