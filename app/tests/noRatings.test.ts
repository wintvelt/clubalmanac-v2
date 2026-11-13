import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isScanned, listFiles } from "./support/sourceScan";

// WP19a invariant 6: ratings zijn geschrapt, dus de app noemt ze nergens meer.
// Ook de uitleg bij Account verwijderen niet. Een "like" bestond in de app
// nooit (spec §Vraag 1). Spec: docs/work-packages/WP19a-ratings-schrappen.md.

const APP = join(__dirname, "..");

describe("de app kent geen ratings", () => {
  it("geen bestand in de broncode noemt een rating", () => {
    const hits = listFiles(APP)
      .filter(isScanned)
      .filter((rel) => /rating/i.test(readFileSync(join(APP, rel), "utf8")));
    expect(hits).toEqual([]);
  });

  it("Account verwijderen noemt geen ratings, wel nog de lidmaatschappen", () => {
    const text = readFileSync(join(APP, "src/screens/DeleteAccountScreen.tsx"), "utf8");
    expect(text).not.toMatch(/rating/i);
    expect(text).toMatch(/lidmaatschappen/);
  });
});
