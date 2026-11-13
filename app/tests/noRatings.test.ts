import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isScanned, listFiles } from "./support/sourceScan";

// WP19a invariant 6 (ruimer na fix-cyclus 1, besluit 3): ratings zijn
// geschrapt, dus geen tekst in de app noemt nog ratings of likes. Dat geldt
// voor Account verwijderen, de bevestiging bij foto verwijderen en elke andere
// tekst. De iPhone-app had nooit een like-knop (spec §Vraag 1), maar het woord
// stond wel in de app: WP17b schreef "met zijn likes" bij foto verwijderen.
// Spec: docs/work-packages/WP19a-ratings-schrappen.md.

const APP = join(__dirname, "..");

// Het woord "like" of "likes", los. Een naam als `isHeicLike` telt niet mee.
const LIKE_WORD = /\blikes?\b/i;

describe("de app kent geen ratings", () => {
  it("geen bestand in de broncode noemt een rating", () => {
    const hits = listFiles(APP)
      .filter(isScanned)
      .filter((rel) => /rating/i.test(readFileSync(join(APP, rel), "utf8")));
    expect(hits).toEqual([]);
  });

  it("geen bestand in app/src noemt likes", () => {
    const hits: string[] = [];
    for (const rel of listFiles(APP).filter(isScanned).filter((r) => r.startsWith("src/"))) {
      readFileSync(join(APP, rel), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (LIKE_WORD.test(line)) hits.push(`${rel}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it("[sanity] het woord telt, een naam die op Like eindigt niet", () => {
    expect(LIKE_WORD.test("met zijn likes.")).toBe(true);
    expect(LIKE_WORD.test("Like")).toBe(true);
    expect(LIKE_WORD.test("isHeicLike(file)")).toBe(false);
    expect(LIKE_WORD.test("likely")).toBe(false);
  });

  it("Account verwijderen noemt geen ratings, wel nog de lidmaatschappen", () => {
    const text = readFileSync(join(APP, "src/screens/DeleteAccountScreen.tsx"), "utf8");
    expect(text).not.toMatch(/rating/i);
    expect(text).toMatch(/lidmaatschappen/);
  });
});
