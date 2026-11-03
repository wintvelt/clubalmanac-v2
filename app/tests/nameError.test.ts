import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { NAME_MAX_LENGTH, nameErrorText } from "../src/lib/nameError";

// WP15b invarianten 1 en 10: de melding onder het naamveld komt uit de code
// van de ConvexError die users.updateProfile gooit, niet uit de tekst van de
// fout (die is in productie "Server Error"). Elke andere fout geeft een
// algemene NL-melding. Nooit een code of Engelse tekst voor de user.

const CODES = ["NAME_EMPTY", "NAME_TOO_LONG", "NAME_INVALID"] as const;

function looksTechnical(text: string): boolean {
  return /NAME_|Error|error|undefined|null|\[object/.test(text);
}

describe("NAME_MAX_LENGTH", () => {
  it("is 50, net als in de backend", () => {
    expect(NAME_MAX_LENGTH).toBe(50);
  });
});

describe("nameErrorText", () => {
  it.each(CODES)("%s: een NL-tekst zonder code", (code) => {
    const text = nameErrorText(new ConvexError({ code }));
    expect(text.trim().length).toBeGreaterThan(0);
    expect(looksTechnical(text)).toBe(false);
  });

  it("de drie codes geven drie verschillende teksten", () => {
    const texts = new Set(CODES.map((code) => nameErrorText(new ConvexError({ code }))));
    expect(texts.size).toBe(3);
  });

  it("NAME_TOO_LONG noemt het maximum", () => {
    expect(nameErrorText(new ConvexError({ code: "NAME_TOO_LONG" }))).toContain(String(NAME_MAX_LENGTH));
  });

  it("een gewone Error met dezelfde tekst als een code: de algemene melding", () => {
    // De tekst van een fout telt niet, alleen de code van een ConvexError.
    const generic = nameErrorText(new Error("iets anders"));
    expect(nameErrorText(new Error("NAME_EMPTY"))).toBe(generic);
  });

  it.each<[string, unknown]>([
    ["Server Error", new Error("[Request ID: abc] Server Error")],
    ["geen netwerk", new TypeError("Network request failed")],
    ["ConvexError met een onbekende code", new ConvexError({ code: "PHOTO_LIMIT_REACHED" })],
    ["ConvexError met een string", new ConvexError("NAME_EMPTY")],
    ["ConvexError zonder code", new ConvexError({})],
    ["geen Error", "NAME_EMPTY"],
    ["undefined", undefined],
  ])("%s: de algemene NL-melding", (_label, error) => {
    const text = nameErrorText(error);
    expect(text).toBe(nameErrorText(new Error("iets anders")));
    expect(text.trim().length).toBeGreaterThan(0);
    expect(looksTechnical(text)).toBe(false);
  });

  it("de algemene melding is een andere dan de drie naamfouten", () => {
    const generic = nameErrorText(new Error("x"));
    for (const code of CODES) expect(nameErrorText(new ConvexError({ code }))).not.toBe(generic);
  });
});
