// WP17b: pure logica achter het foto-menu, het selectiemenu en het
// draaischerm. Spec: docs/work-packages/WP17b-foto-acties.md §Spec-criticus
// aanvullingen (invariant 1, 7, 10, 11; A-keuze 2). De schermen tonen het.

import { orientationOf, type Orientation } from "./photos";

export type PhotoAction =
  | "albumCover"
  | "groupCover"
  | "profilePhoto"
  | "rotate"
  | "removeFromAlbum"
  | "delete";

export type Role = "admin" | "member";

// --- Het menu per foto (invariant 1 en 10) -------------------------------------------
//
// Dezelfde regels als de backend, zonder er code mee te delen:
//   albumcover     admin                               (albums.update, WP28 A-keuze 2)
//   groepscover    admin                               (groups.update, WP24)
//   profielfoto    eigenaar                            (users.setProfilePhoto)
//   draaien        eigenaar, of admin                  (photos.rotate, WP8)
//   uit album      wie hem toevoegde, of admin         (albums.removePhoto)
//   verwijderen    eigenaar                            (photos.remove)
// De rol is die in de groep van dit album. Een admin van een andere groep met
// dezelfde foto mag in de backend ook draaien; het menu mag dan strenger zijn.

type MenuInput = {
  me: string;
  role: Role;
  ownerId: string;
  addedBy: string;
  albumCreatedBy: string;
};

const RULES: Record<PhotoAction, (i: MenuInput) => boolean> = {
  albumCover: (i) => i.role === "admin",
  groupCover: (i) => i.role === "admin",
  profilePhoto: (i) => i.ownerId === i.me,
  rotate: (i) => i.role === "admin" || i.ownerId === i.me,
  removeFromAlbum: (i) => i.role === "admin" || i.addedBy === i.me,
  delete: (i) => i.ownerId === i.me,
};

// De volgorde van het menu: verwijderen (rood) altijd onderaan.
const MENU_ORDER: PhotoAction[] = [
  "albumCover",
  "groupCover",
  "profilePhoto",
  "rotate",
  "removeFromAlbum",
  "delete",
];

export function photoActions(input: MenuInput): PhotoAction[] {
  return MENU_ORDER.filter((a) => RULES[a](input));
}

export function photoActionLabel(action: PhotoAction): string {
  switch (action) {
    case "albumCover":
      return "Als albumcover";
    case "groupCover":
      return "Als groepscover";
    case "profilePhoto":
      return "Als profielfoto";
    case "rotate":
      return "Draaien of spiegelen";
    case "removeFromAlbum":
      return "Uit album halen";
    case "delete":
      return "Overal verwijderen";
  }
}

// --- Selectie (invariant 7, A-keuze 2) ------------------------------------------------

export type SelectionAction = "delete" | "removeFromAlbum";

type SelectionItem<P extends string> = { photoId: P; ownerId: string; addedBy: string };

// Per foto, met de regel van het menu. Alleen `allowed` gaat naar de backend;
// de volgorde van de selectie blijft.
export function selectionPlan<P extends string>(
  action: SelectionAction,
  items: readonly SelectionItem<P>[],
  ctx: { me: string; role: Role; albumCreatedBy: string },
): { allowed: P[]; notAllowed: P[] } {
  const allowed: P[] = [];
  const notAllowed: P[] = [];
  for (const item of items) {
    const ok = RULES[action]({ ...ctx, ownerId: item.ownerId, addedBy: item.addedBy });
    (ok ? allowed : notAllowed).push(item.photoId);
  }
  return { allowed, notAllowed };
}

function photos(n: number): string {
  return n === 1 ? "1 foto" : `${n} foto's`;
}

// Na afloop: hoeveel niet, en waarom. Alles gelukt: geen melding (null).
// "Niet toegestaan" weet de app vooraf; "mislukt" is wat de backend daarna
// nog weigerde of wat niet aankwam.
export function selectionSummary(
  action: SelectionAction,
  counts: { done: number; notAllowed: number; failed: number },
): string | null {
  const parts: string[] = [];
  if (counts.notAllowed > 0) {
    parts.push(
      action === "delete"
        ? `${photos(counts.notAllowed)} niet verwijderd: alleen de eigenaar kan een foto verwijderen.`
        : `${photos(counts.notAllowed)} niet uit het album gehaald: dat kan alleen wie de foto toevoegde, of een admin.`,
    );
  }
  if (counts.failed > 0) {
    parts.push(`Bij ${photos(counts.failed)} lukte het niet. Probeer het later opnieuw.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

// --- Draaischerm (invariant 11, WP8 §Frontend-contract) -------------------------------
//
// Een stand is "eerst spiegelen (als flip), dan rot graden met de klok mee",
// op het beeld zoals de user het ziet. Zo werkt ook photos.rotate.

export type RotateStep = "left" | "right" | "mirror";
export type Rotation = 0 | 90 | 180 | 270;
export type RotationEdit = { rotation: Rotation; flipY: boolean };

type Transform = { flip: boolean; rot: number };

const norm = (deg: number): Rotation => ((((deg % 360) + 360) % 360) as Rotation);

// Eerst `first`, dan `then`. Spiegelen na een draaiing keert die draaiing om
// (M·R(r) = R(−r)·M).
function compose(first: Transform, then: Transform): Transform {
  return then.flip
    ? { flip: !first.flip, rot: norm(then.rot - first.rot) }
    : { flip: first.flip, rot: norm(then.rot + first.rot) };
}

const STEP: Record<RotateStep, Transform> = {
  right: { flip: false, rot: 90 },
  left: { flip: false, rot: 270 },
  mirror: { flip: true, rot: 0 },
};

// De knoppen samen als één photos.rotate. Komt het uit op de begintoestand,
// dan null: niets te bewaren.
export function composeRotation(steps: readonly RotateStep[]): RotationEdit | null {
  const t = steps.reduce<Transform>((acc, s) => compose(acc, STEP[s]), { flip: false, rot: 0 });
  if (!t.flip && t.rot === 0) return null;
  return { rotation: norm(t.rot), flipY: t.flip };
}

// De EXIF-stand na de draaiing: de stand die het voorbeeld toont, en die de
// backend na photos.rotate vastlegt.
export function previewOrientation(current: number | undefined, edit: RotationEdit): number {
  const now: Orientation = orientationOf(current);
  const next = compose({ flip: now.mirror, rot: now.rotate }, { flip: edit.flipY, rot: edit.rotation });
  for (let tag = 1; tag <= 8; tag++) {
    const o = orientationOf(tag);
    if (o.mirror === next.flip && o.rotate === next.rot) return tag;
  }
  return 1;
}
