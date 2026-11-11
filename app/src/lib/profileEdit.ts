// WP27: pure logica achter de pagina Profiel en de melding bij "Als
// profielfoto". Spec: docs/work-packages/WP27-profiel.md, besluit 1 en 5,
// §Spec-criticus aanvullingen (advies vraag 2 en 3, A-invariant 10). De
// schermen tonen het.

// "Bewaar" verschijnt pas na een wijziging (besluit 1). `draft` is null zolang
// de user niet typt. Spaties aan begin en eind tellen niet mee, zoals in de
// backend (WP15b).
export function nameIsDirty(draft: string | null, saved: string | undefined): boolean {
  if (draft === null) return false;
  return draft.trim() !== (saved ?? "").trim();
}

export type ProfilePhotoNotice = { title: string; message: string };

// De melding vóór het instellen (invariant 2, vraag 3). Bij de foto van een
// ander: wie de eigenaar is, en dat hij er geen bericht van krijgt (besluit 5).
export function profilePhotoNotice(owner: { isMe: boolean; name?: string }): ProfilePhotoNotice {
  if (owner.isMe) {
    return {
      title: "Profielfoto is openbaar",
      message: "Je profielfoto is voor iedereen te zien, ook buiten de groep.",
    };
  }
  const name = owner.name?.trim();
  const who = name ? name : "een ander lid";
  const whoStart = name ? name : "Een ander lid";
  return {
    title: "Als profielfoto instellen?",
    message: `Deze foto is van ${who}. Als profielfoto is hij voor iedereen te zien, ook buiten de groep. ${whoStart} krijgt daar geen bericht van.`,
  };
}

// WP27 A-invariant 21: de hulptekst onder het menu op Profiel. In het album
// opent lang drukken op een foto het foto-menu, met "Als profielfoto".
export const PROFILE_PHOTO_HINT =
  "Een foto uit een album kiezen? Houd hem in het album ingedrukt en kies Als profielfoto.";

export type ProfilePhotoMenuItem = "upload" | "remove";

// Het menu bij de foto op Profiel (vraag 2): uploaden, en weghalen als er een
// beeld is. De foto van een ander kies je in het foto-menu, niet hier.
export function profilePhotoMenu({ hasPhoto }: { hasPhoto: boolean }): ProfilePhotoMenuItem[] {
  return hasPhoto ? ["upload", "remove"] : ["upload"];
}
