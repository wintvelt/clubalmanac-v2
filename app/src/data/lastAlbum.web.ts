import type { StoredAlbum } from "../lib/lastAlbum";

// WP39 besluit 9: op het web wordt geen album onthouden. Dezelfde vorm als
// lastAlbum.ts (iOS, met de keychain), zonder keychain.

export async function loadLastAlbum(_userId: string): Promise<StoredAlbum | null> {
  return null;
}

export async function saveLastAlbum(_userId: string, _album: StoredAlbum): Promise<void> {}

export async function forgetLastAlbum(_userId: string, _albumId: string): Promise<void> {}

export async function clearLastAlbum(_userId: string): Promise<void> {}
