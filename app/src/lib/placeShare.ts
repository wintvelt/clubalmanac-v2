// WP17d: pure logica achter de albumkaart, "Locatie wijzigen" en delen.
// Spec: docs/work-packages/WP17d-kaart-locatie-delen.md §Spec-criticus
// aanvullingen (A-invariant 6 en 7; besluit 3; kernvondst 5). De schermen
// tonen het; de backend beslist (photos.setLocation: alleen de eigenaar).

import { orientationOf } from "./photos";

// --- Menu (A-invariant 6, besluit 3) -----------------------------------------------------
//
//   delen            elke foto die je ziet, maar alleen met formaten: zonder
//                    formaten zou het origineel (met GPS) de app verlaten
//   locatie wijzigen alleen de eigenaar (photos.setLocation)

export type PlaceShareAction = "share" | "location";

export function placeShareActions(input: {
  me: string;
  ownerId: string;
  hasFormats: boolean;
}): PlaceShareAction[] {
  const out: PlaceShareAction[] = [];
  if (input.hasFormats) out.push("share");
  if (input.ownerId === input.me) out.push("location");
  return out;
}

export function placeShareLabel(action: PlaceShareAction): string {
  return action === "share" ? "Delen" : "Locatie wijzigen";
}

// --- Melding vóór delen (besluit 3) ------------------------------------------------------

/** Eén regel bij andermans foto; bij je eigen foto geen melding (null). */
export function shareNotice(input: {
  me: string;
  ownerId: string;
  ownerName: string | undefined;
}): string | null {
  if (input.ownerId === input.me) return null;
  const name = input.ownerName?.trim();
  return name ? `Deze foto van ${name} verlaat de app.` : "Deze foto van een ander lid verlaat de app.";
}

// --- Rechtop delen (kernvondst 5) --------------------------------------------------------
//
// *groot* bevat de ruwe pixels; de app toont ze met `exifOrientation`: eerst
// spiegelen, dan met de klok mee draaien (photos.ts, orientationOf). Dezelfde
// stappen voor expo-image-manipulator, zodat de gedeelde JPEG al rechtop staat.

export type ShareEdit = { flip: "horizontal" } | { rotate: 90 | 180 | 270 };

export function shareEdits(exifOrientation: number | undefined): ShareEdit[] {
  const { rotate, mirror } = orientationOf(exifOrientation);
  const steps: ShareEdit[] = [];
  if (mirror) steps.push({ flip: "horizontal" });
  if (rotate !== 0) steps.push({ rotate });
  return steps;
}

// --- De kaart -------------------------------------------------------------------------------

export type Point = { latitude: number; longitude: number };
export type Region = Point & { latitudeDelta: number; longitudeDelta: number };

const MIN_DELTA = 0.02;
const PADDING = 1.4;

/** De regio rond de plekken, met wat ruimte; geen plekken: null. */
export function mapRegion(points: readonly Point[]): Region | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLon = Math.min(minLon, p.longitude);
    maxLon = Math.max(maxLon, p.longitude);
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.min(180, Math.max(MIN_DELTA, (maxLat - minLat) * PADDING)),
    longitudeDelta: Math.min(360, Math.max(MIN_DELTA, (maxLon - minLon) * PADDING)),
  };
}

/** Startpunt voor "Locatie wijzigen" bij een foto zonder plek: midden-Nederland. */
export const MIDDLE_NL: Region = {
  latitude: 52.16,
  longitude: 5.39,
  latitudeDelta: 2.5,
  longitudeDelta: 2.5,
};

/** Startpunt bij een foto met plek: daar, dichtbij. */
export function spotRegion(p: Point): Region {
  return { ...p, latitudeDelta: 0.01, longitudeDelta: 0.01 };
}

// --- Spelden dicht bij elkaar (pariteit v1: één speld met een aantal) ----------------------

export type Cluster<P extends Point & { photoId: string }> = Point & { items: P[] };

/**
 * Groepeert plekken die op het scherm dicht bij elkaar liggen: een raster van
 * `cells` vakken over de breedte van de zichtbare regio. Het midden van een
 * groep is het gemiddelde van zijn plekken.
 */
export function clusterSpots<P extends Point & { photoId: string }>(
  spots: readonly P[],
  region: Pick<Region, "latitudeDelta" | "longitudeDelta">,
  cells = 8,
): Cluster<P>[] {
  const cellLat = Math.max(region.latitudeDelta / cells, 1e-6);
  const cellLon = Math.max(region.longitudeDelta / cells, 1e-6);
  const groups = new Map<string, P[]>();
  for (const s of spots) {
    const key = `${Math.floor(s.latitude / cellLat)}:${Math.floor(s.longitude / cellLon)}`;
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  return [...groups.values()].map((items) => ({
    latitude: items.reduce((n, p) => n + p.latitude, 0) / items.length,
    longitude: items.reduce((n, p) => n + p.longitude, 0) / items.length,
    items,
  }));
}
