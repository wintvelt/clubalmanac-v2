import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  featureErrorText,
  featureStatusLabel,
  sortIdeas,
} from "../src/lib/features";

// WP20, pure logica achter ideeën en problemen. Spec:
// docs/work-packages/WP20-melden.md §A-invarianten (1: codes), A-keuze 6
// (statusnamen) en 7 (volgorde). De schermen zelf toetst de gate.

const CODES = [
  "TITLE_REQUIRED",
  "TITLE_TOO_LONG",
  "TITLE_INVALID",
  "DESCRIPTION_TOO_LONG",
  "DESCRIPTION_INVALID",
] as const;

function looksTechnical(text: string): boolean {
  return /TITLE_|DESCRIPTION_|Error|error|undefined|null|\[object/.test(text);
}

describe("grenzen, net als de backend (A-invariant 1)", () => {
  it("titel 100, omschrijving 2000 tekens", () => {
    expect(TITLE_MAX_LENGTH).toBe(100);
    expect(DESCRIPTION_MAX_LENGTH).toBe(2000);
  });
});

describe("featureErrorText", () => {
  it.each(CODES)("%s: een NL-tekst zonder code", (code) => {
    const text = featureErrorText(new ConvexError({ code }));
    expect(text.trim().length).toBeGreaterThan(0);
    expect(looksTechnical(text)).toBe(false);
  });

  it("elke code een eigen tekst, en geen ervan is de algemene melding", () => {
    const generic = featureErrorText(new Error("Server Error"));
    const texts = CODES.map((code) => featureErrorText(new ConvexError({ code })));
    expect(new Set(texts).size).toBe(CODES.length);
    for (const t of texts) expect(t).not.toBe(generic);
  });

  it("te lang noemt de grens", () => {
    expect(featureErrorText(new ConvexError({ code: "TITLE_TOO_LONG" }))).toContain("100");
    expect(featureErrorText(new ConvexError({ code: "DESCRIPTION_TOO_LONG" }))).toContain("2000");
  });

  it("andere fouten: één algemene NL-melding", () => {
    const generic = featureErrorText(new Error("Server Error"));
    expect(generic.trim().length).toBeGreaterThan(0);
    expect(looksTechnical(generic)).toBe(false);
    expect(featureErrorText(new ConvexError({ code: "IETS_ANDERS" }))).toBe(generic);
    expect(featureErrorText(new ConvexError("tekst"))).toBe(generic);
    expect(featureErrorText(undefined)).toBe(generic);
  });
});

describe("featureStatusLabel (A-keuze 6)", () => {
  it("de vijf statussen", () => {
    expect(featureStatusLabel("open")).toBe("Nieuw");
    expect(featureStatusLabel("planned")).toBe("Gepland");
    expect(featureStatusLabel("inProgress")).toBe("Mee bezig");
    expect(featureStatusLabel("done")).toBe("Klaar");
    expect(featureStatusLabel("rejected")).toBe("Afgewezen");
  });
});

describe("sortIdeas (A-keuze 7)", () => {
  it("meeste stemmen eerst; bij gelijk aantal het nieuwste eerst", () => {
    const ideas = [
      { _id: "a", upvoteCount: 1, createdAt: 10 },
      { _id: "b", upvoteCount: 3, createdAt: 5 },
      { _id: "c", upvoteCount: 1, createdAt: 20 },
      { _id: "d", upvoteCount: 0, createdAt: 30 },
    ];
    expect(sortIdeas(ideas).map((i) => i._id)).toEqual(["b", "c", "a", "d"]);
  });

  it("verandert de invoer niet", () => {
    const ideas = [
      { _id: "a", upvoteCount: 0, createdAt: 1 },
      { _id: "b", upvoteCount: 5, createdAt: 2 },
    ];
    sortIdeas(ideas);
    expect(ideas.map((i) => i._id)).toEqual(["a", "b"]);
  });
});
