import { formatDuration, videoTooLongToSend } from "./videos";

// WP39: de keuze op het toevoegscherm, als pure logica (geen React, geen
// native modules). AddPhotosScreen.tsx gebruikt dit.
//
// - Besluit 3, A1, A2: "Meer toevoegen" vult aan. Ontdubbelen op `assetId`;
//   een dubbel gekozen item houdt zijn plek, sleutel en asset (de eerste
//   kopie van de kiezer). Zonder `assetId` komt een item er altijd bij, net
//   als `albumBatch` hem een nieuwe upload-id geeft.
// - Invariant 3, A3: de volgorde van de kiezer, foto's en filmpjes door
//   elkaar; nieuw achteraan. Een `pairedVideo` hoort er niet in.
// - Invariant 6, A7, besluit 5: namen per soort genummerd; "te lang" al vóór
//   de ronde, en dan de duur naar boven afgerond (nooit "3:00").
// - A13: de stand van een filmpje op zijn tegel.
// - Besluit 4, A-antwoord 3, A8: het raster met de kolomregel van het album.

/** Wat de kiezer per item geeft, voor zover de keuze het nodig heeft. */
export type PickedAsset = {
  uri: string;
  assetId?: string | null;
  type?: string | null;
  duration?: number | null;
};

export type SelectionKind = "foto" | "filmpje";

export type SelectionItem<A extends PickedAsset = PickedAsset> = {
  key: string;
  kind: SelectionKind;
  asset: A;
};

let keyCounter = 0;

function newKey(): string {
  keyCounter += 1;
  return `k${keyCounter.toString(36)}`;
}

/**
 * De keuze aangevuld met wat net gekozen is. `skipped`: de gekozen assets die
 * er niet bij kwamen (dubbel of `pairedVideo`); hun kopie kan weg.
 */
export function addToSelection<A extends PickedAsset>(
  current: readonly SelectionItem<A>[],
  picked: readonly A[],
): { items: SelectionItem<A>[]; skipped: A[] } {
  const items = [...current];
  const skipped: A[] = [];
  const seen = new Set<string>();
  for (const i of current) if (i.asset.assetId) seen.add(i.asset.assetId);
  for (const asset of picked) {
    if (asset.type === "pairedVideo") {
      skipped.push(asset);
      continue;
    }
    const id = asset.assetId;
    if (id) {
      if (seen.has(id)) {
        skipped.push(asset);
        continue;
      }
      seen.add(id);
    }
    items.push({ key: newKey(), kind: asset.type === "video" ? "filmpje" : "foto", asset });
  }
  return { items, skipped };
}

/** De keuze zonder het item met deze sleutel; de rest in dezelfde volgorde. */
export function removeFromSelection<A extends PickedAsset>(
  current: readonly SelectionItem<A>[],
  key: string,
): SelectionItem<A>[] {
  return current.filter((i) => i.key !== key);
}

export type SelectionTile = {
  key: string;
  kind: SelectionKind;
  /** Per soort genummerd, vanaf 1, in de volgorde van de keuze. */
  number: number;
  durationText: string | null;
  tooLong: boolean;
  /** De naam voor VoiceOver. */
  label: string;
  /** De naam van de × voor VoiceOver. */
  removeLabel: string;
};

export function selectionTiles(items: readonly SelectionItem[]): SelectionTile[] {
  let photos = 0;
  let clips = 0;
  return items.map((item) => {
    if (item.kind === "foto") {
      photos += 1;
      return {
        key: item.key,
        kind: item.kind,
        number: photos,
        durationText: null,
        tooLong: false,
        label: `Foto ${photos}`,
        removeLabel: `Haal foto ${photos} uit je keuze`,
      };
    }
    clips += 1;
    const ms = item.asset.duration;
    const known = typeof ms === "number" && Number.isFinite(ms);
    const tooLong = known && videoTooLongToSend(ms);
    // A7: te lang toont nooit "3:00"; naar boven afgerond op hele seconden.
    const durationText = !known ? null : tooLong ? formatDuration(Math.ceil(ms / 1000) * 1000) : formatDuration(ms);
    return {
      key: item.key,
      kind: item.kind,
      number: clips,
      durationText,
      tooLong,
      label: [`Filmpje ${clips}`, durationText, tooLong ? "te lang" : null].filter(Boolean).join(", "),
      removeLabel: `Haal filmpje ${clips} uit je keuze`,
    };
  });
}

/** De stappen van een filmpje (gelijk aan `VideoPhase` in src/data/videoUpload.ts). */
export type VideoStatusPhase = "voorbereiden" | "verkleinen" | "versturen" | "afronden";

export type VideoStatus = {
  state: "wacht" | "bezig" | "klaar" | "mislukt";
  progress?: { phase: VideoStatusPhase; progress: number };
  reason?: string;
};

/** A13: de stand van een filmpje, op zijn tegel en in zijn naam. */
export function videoStatusText(item: VideoStatus): string {
  switch (item.state) {
    case "wacht":
      return "Wacht";
    case "klaar":
      return "In het album";
    case "mislukt":
      return "Niet gelukt";
    case "bezig": {
      const p = item.progress;
      if (!p || p.phase === "voorbereiden") return "Voorbereiden…";
      const fraction = Number.isFinite(p.progress) ? Math.min(1, Math.max(0, p.progress)) : 0;
      const pct = `${Math.round(fraction * 100)}%`;
      if (p.phase === "verkleinen") return `Verkleinen… ${pct}`;
      if (p.phase === "versturen") return `Versturen… ${pct}`;
      return "Afronden…";
    }
  }
}

/** De tussenruimte van het raster, gelijk aan het album. */
export const ADD_GRID_GAP = 2;

/**
 * A-antwoord 3, A8: kolommen en tegelmaat uit de breedte die het raster zelf
 * krijgt. Dezelfde kolomregel als `columnsFor` in AlbumScreen.tsx.
 */
export function addGrid(width: number): { columns: number; tile: number } {
  const w = Number.isFinite(width) ? Math.max(0, width) : 0;
  const columns = w < 600 ? 3 : w < 900 ? 4 : w < 1100 ? 5 : 6;
  const tile = Math.max(0, Math.floor((w - ADD_GRID_GAP * (columns - 1)) / columns));
  return { columns, tile };
}

export type AddButtonAction = "toevoegen" | "kies-album";

/**
 * Fixronde gate 1, besluit 1, F6, besluit 7: de knop onderin. Met een album
 * "Toevoegen aan album"; zonder album grijs "Kies eerst een album", en een tik
 * opent het kiesscherm; zolang het album nog gecontroleerd wordt, uit.
 */
export function addButton(album: "chosen" | "none" | "unknown"): { title: string; action: AddButtonAction | null } {
  if (album === "chosen") return { title: "Toevoegen aan album", action: "toevoegen" };
  if (album === "none") return { title: "Kies eerst een album", action: "kies-album" };
  return { title: "Toevoegen aan album", action: null };
}
