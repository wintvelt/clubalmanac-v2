import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { inviteRefusalText } from "../src/lib/invites";

// WP19b fix-cyclus 1, N1 (A-invariant 19). Uitnodigen van een adres waarvan
// het account wordt verwijderd, geeft ConvexError { code: "EMAIL_BEING_DELETED",
// email }. De app noemt het adres en zegt dat het later wel kan; niet de
// algemene melding "Controleer je verbinding" (spec-invariant 1: de admin ziet
// per adres waarom het niet lukte).

const GENERIC = /verbinding/i;

describe("inviteRefusalText — EMAIL_BEING_DELETED", () => {
  const err = new ConvexError({ code: "EMAIL_BEING_DELETED", email: "rex@x.test" });

  it("noemt het adres, niet de algemene verbindingsmelding", () => {
    const text = inviteRefusalText(err, "create");
    expect(text).toContain("rex@x.test");
    expect(text).not.toMatch(GENERIC);
  });

  it("zegt dat het account wordt verwijderd en dat het later opnieuw kan", () => {
    const text = inviteRefusalText(err, "create");
    expect(text).toMatch(/verwijderd/i);
    expect(text).toMatch(/later/i);
  });

  it("alleen de code telt: een gewone fout met dezelfde tekst blijft de algemene melding", () => {
    const plain = new Error("Dit adres hoort bij een account dat wordt verwijderd. Probeer het later opnieuw.");
    expect(inviteRefusalText(plain, "create")).toMatch(GENERIC);
  });
});
