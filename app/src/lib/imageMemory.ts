// WP35 A-invariant W3 (route A, besluit B1): op het web haalt de app een foto
// of uitnodigingscover op met het token in de header, zonder HTTP-cache, en
// houdt hem als `blob:`-URL in dit geheugen. Puur: de web-variant van de
// beeldbron (src/data/images.web.tsx) geeft `release` mee
// (`URL.revokeObjectURL`).
//
// - Begrensd: bij de grens gaat het langst niet gebruikte beeld eruit en wordt
//   het vrijgegeven. Lezen telt als gebruik.
// - Een nieuw beeld onder dezelfde sleutel geeft het oude vrij.
// - Leegmaken (uitloggen) geeft alles precies één keer vrij.

export type ImageMemory<V> = {
  get(key: string): V | undefined;
  put(key: string, value: V): void;
  /** Haalt één beeld eruit en geeft het vrij (een beeld dat niet te tonen was). */
  delete(key: string): void;
  size(): number;
  clear(): void;
};

export function createImageMemory<V>(opts: { limit: number; release: (value: V) => void }): ImageMemory<V> {
  const limit = Math.max(1, Math.floor(opts.limit));
  // Een Map houdt de volgorde van invoegen: de eerste sleutel is de langst
  // niet gebruikte. Gebruik zet hem achteraan.
  const entries = new Map<string, V>();

  const release = (value: V) => {
    try {
      opts.release(value);
    } catch {
      // Vrijgeven mag het geheugen niet breken.
    }
  };

  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key) as V;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    put(key, value) {
      if (entries.has(key)) {
        const old = entries.get(key) as V;
        entries.delete(key);
        if (old !== value) release(old);
      }
      entries.set(key, value);
      while (entries.size > limit) {
        const oldest = entries.keys().next().value as string;
        const evicted = entries.get(oldest) as V;
        entries.delete(oldest);
        release(evicted);
      }
    },
    delete(key) {
      if (!entries.has(key)) return;
      const value = entries.get(key) as V;
      entries.delete(key);
      release(value);
    },
    size() {
      return entries.size;
    },
    clear() {
      const values = [...entries.values()];
      entries.clear();
      for (const value of values) release(value);
    },
  };
}

export type ImageMemoryKind = "foto" | "uitnodiging";

/**
 * De sleutel van een beeld in het geheugen: per user, soort, id en formaat.
 * Een volgende user in dezelfde browser krijgt nooit een beeld van de vorige,
 * ook niet als leegmaken mislukte. Hangt niet af van het token (dat wisselt).
 * JSON van een array: geen scheidingsteken in een id kan twee sleutels gelijk
 * maken.
 */
export function imageMemoryKey(userId: string, kind: ImageMemoryKind, id: string, format: string): string {
  return JSON.stringify([userId, kind, id, format]);
}
