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
// - Een beeld dat in beeld staat (`hold`), gaat er bij de grens niet uit. Een
//   weggegooid beeld trekt zijn `blob:`-URL in; iOS Safari decodeert een beeld
//   dat even uit beeld was opnieuw vanaf die URL, dat mislukt, de app haalt het
//   opnieuw op en duwt zo een ander beeld eruit: een eindeloze lus van
//   wisselende foto's. Zolang er meer in beeld staat dan de grens, groeit het
//   geheugen tijdelijk tot wat in beeld staat.

export type ImageMemory<V> = {
  get(key: string): V | undefined;
  put(key: string, value: V): void;
  /** Haalt één beeld eruit en geeft het vrij (een beeld dat niet te tonen was). */
  delete(key: string): void;
  /** Dit beeld staat in beeld: niet weggooien bij de grens. Telt per scherm. */
  hold(key: string): void;
  /** Het scherm toont het niet meer. */
  unhold(key: string): void;
  size(): number;
  clear(): void;
};

export function createImageMemory<V>(opts: { limit: number; release: (value: V) => void }): ImageMemory<V> {
  const limit = Math.max(1, Math.floor(opts.limit));
  // Een Map houdt de volgorde van invoegen: de eerste sleutel is de langst
  // niet gebruikte. Gebruik zet hem achteraan.
  const entries = new Map<string, V>();
  // Hoeveel schermen een sleutel nu tonen (ook al voordat hij binnen is).
  const holds = new Map<string, number>();

  const evict = () => {
    if (entries.size <= limit) return;
    for (const key of [...entries.keys()]) {
      if (entries.size <= limit) return;
      if ((holds.get(key) ?? 0) > 0) continue;
      const evicted = entries.get(key) as V;
      entries.delete(key);
      release(evicted);
    }
  };

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
      evict();
    },
    delete(key) {
      if (!entries.has(key)) return;
      const value = entries.get(key) as V;
      entries.delete(key);
      release(value);
    },
    hold(key) {
      holds.set(key, (holds.get(key) ?? 0) + 1);
    },
    unhold(key) {
      const n = (holds.get(key) ?? 0) - 1;
      if (n > 0) holds.set(key, n);
      else holds.delete(key);
      evict();
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

// WP41c: ook de foto van een afrekening, met de versie als variant.
export type ImageMemoryKind = "foto" | "uitnodiging" | "afrekening";

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
