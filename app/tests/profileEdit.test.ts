import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROFILE_PHOTO_HINT, nameIsDirty, profilePhotoMenu, profilePhotoNotice } from "../src/lib/profileEdit";

// WP27: pure logica achter de pagina Profiel en de melding bij "Als
// profielfoto". Spec: docs/work-packages/WP27-profiel.md, besluit 1 en 5,
// §Spec-criticus aanvullingen (advies vraag 2 en 3, A-invariant 10). Hoe het
// eruitziet (opbouw, grootste tekst, licht en donker) toetst de gate.
//
//   nameIsDirty(draft, saved)        "Bewaar" alleen na een wijziging. `draft`
//                                    is null zolang de user niet typt. Spaties
//                                    aan begin en eind tellen niet (de backend
//                                    trimt, WP15b).
//   profilePhotoNotice(owner)        de melding vóór het instellen. `owner` is
//                                    de eigenaar van de foto: { isMe, name? }.
//   profilePhotoMenu({ hasPhoto })   het menu bij de foto op Profiel: uploaden,
//                                    en weghalen als er een beeld is. Geen
//                                    kiezer over je foto's (vraag 2, WP17c).

describe("nameIsDirty: Bewaar verschijnt pas na een wijziging (besluit 1)", () => {
  it("niet getypt: geen wijziging", () => {
    expect(nameIsDirty(null, "Alice")).toBe(false);
    expect(nameIsDirty(null, undefined)).toBe(false);
  });

  it("dezelfde naam getypt: geen wijziging", () => {
    expect(nameIsDirty("Alice", "Alice")).toBe(false);
  });

  it("alleen spaties eromheen erbij: geen wijziging", () => {
    expect(nameIsDirty("  Alice ", "Alice")).toBe(false);
  });

  it("een andere naam: wel", () => {
    expect(nameIsDirty("Alicia", "Alice")).toBe(true);
  });

  it("hoofdletters tellen", () => {
    expect(nameIsDirty("alice", "Alice")).toBe(true);
  });

  it("leeggemaakt: wel (de backend weigert, de fout staat onder het veld)", () => {
    expect(nameIsDirty("", "Alice")).toBe(true);
    expect(nameIsDirty("   ", "Alice")).toBe(true);
  });

  it("nog geen naam, nu wel een: wel", () => {
    expect(nameIsDirty("Alice", undefined)).toBe(true);
  });

  it("nog geen naam en niets getypt dan spaties: geen wijziging", () => {
    expect(nameIsDirty("  ", undefined)).toBe(false);
  });
});

describe("profilePhotoNotice: eerst zeggen dat het openbaar is (invariant 2, vraag 3)", () => {
  it("eigen foto: voor iedereen te zien, ook buiten de groep", () => {
    const n = profilePhotoNotice({ isMe: true, name: "Alice" });
    expect(n.title.length).toBeGreaterThan(0);
    expect(n.message).toMatch(/iedereen/);
    expect(n.message).toMatch(/buiten de groep/);
    // Geen eigenaar te noemen.
    expect(n.message).not.toMatch(/Alice/);
    expect(n.message).not.toMatch(/bericht/);
  });

  it("foto van een ander: noemt de eigenaar, openbaar, en dat hij geen bericht krijgt (besluit 5)", () => {
    const n = profilePhotoNotice({ isMe: false, name: "Bob" });
    expect(n.title.length).toBeGreaterThan(0);
    expect(`${n.title} ${n.message}`).toMatch(/Bob/);
    expect(n.message).toMatch(/iedereen/);
    expect(n.message).toMatch(/buiten de groep/);
    expect(n.message).toMatch(/geen bericht/);
  });

  it("foto van een ander zonder naam: 'een ander lid', nooit undefined", () => {
    for (const name of [undefined, "", "   "]) {
      const n = profilePhotoNotice({ isMe: false, name });
      const all = `${n.title} ${n.message}`;
      expect(all, String(name)).toMatch(/een ander lid/i);
      expect(all).not.toMatch(/undefined|null/);
      expect(n.message).toMatch(/geen bericht/);
    }
  });

  it("eigen en andermans melding verschillen", () => {
    expect(profilePhotoNotice({ isMe: false, name: "Bob" }).message).not.toEqual(
      profilePhotoNotice({ isMe: true, name: "Bob" }).message,
    );
  });
});

describe("profilePhotoMenu: het menu bij de foto op Profiel (vraag 2)", () => {
  it("zonder beeld: alleen uploaden", () => {
    expect(profilePhotoMenu({ hasPhoto: false })).toEqual(["upload"]);
  });

  it("met beeld: uploaden en weghalen, weghalen onderaan", () => {
    expect(profilePhotoMenu({ hasPhoto: true })).toEqual(["upload", "remove"]);
  });
});

// WP27 fix-cyclus 1, audit-nit 2 (A-invariant 21): de hulptekst onder het
// menu op Profiel zegt hoe je in het album bij "Als profielfoto" komt. In het
// album open je het foto-menu door de foto ingedrukt te houden.
describe("PROFILE_PHOTO_HINT: de hulptekst op Profiel", () => {
  it("noemt het kortste pad, in woorden van de gebruiker", () => {
    expect(PROFILE_PHOTO_HINT).toBe(
      "Een foto uit een album kiezen? Houd hem in het album ingedrukt en kies Als profielfoto.",
    );
  });
});

// Dat de schermen deze logica gebruiken, en niet een eigen kopie.
describe("bronscan: de schermen gebruiken deze module", () => {
  const src = (file: string) => readFileSync(join(__dirname, "../src/screens", file), "utf8");

  it("Profiel: nameIsDirty en profilePhotoMenu", () => {
    const text = src("ProfileScreen.tsx");
    expect(text).toMatch(/from "\.\.\/lib\/profileEdit"/);
    expect(text).toMatch(/\bnameIsDirty\(/);
    expect(text).toMatch(/\bprofilePhotoMenu\(/);
  });

  it("Profiel: de hulptekst uit de module, niet meer de oude", () => {
    const text = src("ProfileScreen.tsx");
    expect(text).toMatch(/\bPROFILE_PHOTO_HINT\b/);
    expect(text).not.toMatch(/Acties, Als profielfoto/);
  });

  it("Foto-menu: profilePhotoNotice, en niet meer de vaste tekst", () => {
    const text = src("PhotoMenu.tsx");
    expect(text).toMatch(/from "\.\.\/lib\/profileEdit"/);
    expect(text).toMatch(/\bprofilePhotoNotice\(/);
    expect(text).not.toMatch(/Je profielfoto is voor iedereen te zien/);
  });
});
