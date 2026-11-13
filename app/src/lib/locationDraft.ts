import { useState } from "react";
import { MIDDLE_NL, type Point } from "./placeShare";

// WP17d besluit 4, A-invariant 11: de speld en de knop "Opslaan" van
// "Locatie wijzigen".
//
// - Zonder opgeslagen plek staat de speld in midden-Nederland en mag Opslaan
//   pas na een tik of sleep (ook direct na "Locatie weghalen"): anders slaat
//   een tik uit gewoonte midden-Nederland op.
// - Met een opgeslagen plek mag Opslaan alleen als de speld ergens anders staat.
// - Verandert de opgeslagen plek (weggehaald, of opgeslagen), dan begint de
//   speld opnieuw. Dezelfde plek in een nieuw object (een nieuwe uitslag van de
//   live query) verandert niets.

type Draft = { key: string; pin: Point; moved: boolean };

const keyOf = (saved: Point | null) => (saved ? `${saved.latitude},${saved.longitude}` : "geen");

const samePoint = (a: Point, b: Point) => a.latitude === b.latitude && a.longitude === b.longitude;

export function useLocationDraft(saved: Point | null): { pin: Point; move: (p: Point) => void; canSave: boolean } {
  const key = keyOf(saved);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Een concept hoort bij één opgeslagen plek; bij een andere begint de speld opnieuw.
  const current = draft !== null && draft.key === key ? draft : null;
  const pin = current?.pin ?? (saved ? { latitude: saved.latitude, longitude: saved.longitude } : middle());
  const moved = current?.moved ?? false;
  const canSave = moved && (saved === null || !samePoint(pin, saved));
  const move = (p: Point) => setDraft({ key, pin: { latitude: p.latitude, longitude: p.longitude }, moved: true });
  return { pin, move, canSave };
}

function middle(): Point {
  return { latitude: MIDDLE_NL.latitude, longitude: MIDDLE_NL.longitude };
}
