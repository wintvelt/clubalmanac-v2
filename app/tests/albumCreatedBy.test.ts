import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isScanned, listFiles } from "./support/sourceScan";

// WP28b, A-invariant 22 (WP28 besluit 11): de maker van een album geeft geen
// recht meer (WP28a A-keuze 2), dus de app vraagt er ook niet meer naar. Het
// foto-menu hangt af van wie kijkt, zijn rol, de eigenaar en wie de foto
// toevoegde. Spec: docs/work-packages/WP28-groepsbeheer.md §WP28b.

const APP = join(__dirname, "..");

describe("albumCreatedBy is weg uit de app", () => {
  it("geen bestand in de broncode noemt het", () => {
    const hits = listFiles(APP)
      .filter(isScanned)
      .filter((rel) => readFileSync(join(APP, rel), "utf8").includes("albumCreatedBy"));
    expect(hits).toEqual([]);
  });
});
