import { describe, expect, it } from "vitest";
import {
  composeRotation,
  photoActions,
  previewOrientation,
  selectionPlan,
  selectionSummary,
  type PhotoAction,
} from "../src/lib/photoActions";

// WP17b, pure logica achter het foto-menu, het selectiemenu en het
// draaischerm. Spec: docs/work-packages/WP17b-foto-acties.md §Spec-criticus
// aanvullingen (invariant 1, 7, 10, 11; A-keuze 2). De schermen zelf toetst de
// gate. Of het menu klopt met de backend, pint
// tests/photoActions/menuMatchesBackend.test.ts (root).

// --- Het menu per foto (invariant 1 en 10) -------------------------------------------
//
// Orakel met de hand, uit de regels van de backend (WP8, WP24, WP17a
// invariant 16, WP28 A-keuze 2), niet uit een tabel die de implementatie deelt:
//   draaien        eigenaar, of admin
//   albumcover     admin (WP28: de maker van het album heeft geen eigen recht;
//                  WP28b A-invariant 22: het menu kent de maker niet meer)
//   groepscover    admin
//   profielfoto    eigenaar
//   uit album      wie hem toevoegde, of admin
//   verwijderen    eigenaar

const ME = "me";
const OTHER = "other";

type Input = Parameters<typeof photoActions>[0];

function menu(input: Input): PhotoAction[] {
  return [...photoActions(input)].sort();
}

function sorted(actions: PhotoAction[]): PhotoAction[] {
  return [...actions].sort();
}

describe("photoActions: wat het menu toont", () => {
  it("eigen foto, lid", () => {
    expect(
      menu({ me: ME, role: "member", ownerId: ME, addedBy: ME }),
    ).toEqual(sorted(["rotate", "profilePhoto", "removeFromAlbum", "delete"]));
  });

  it("eigen foto, admin: alles", () => {
    expect(
      menu({ me: ME, role: "admin", ownerId: ME, addedBy: ME }),
    ).toEqual(
      sorted(["rotate", "albumCover", "groupCover", "profilePhoto", "removeFromAlbum", "delete"]),
    );
  });

  it("foto van een ander, lid: niets", () => {
    expect(
      menu({ me: ME, role: "member", ownerId: OTHER, addedBy: OTHER }),
    ).toEqual([]);
  });

  it("foto van een ander, admin: draaien, covers en uit album; geen profielfoto, niet verwijderen", () => {
    expect(
      menu({ me: ME, role: "admin", ownerId: OTHER, addedBy: OTHER }),
    ).toEqual(sorted(["rotate", "albumCover", "groupCover", "removeFromAlbum"]));
  });

  it("foto van een ander die de user zelf toevoegde (oude data): uit album mag", () => {
    expect(
      menu({ me: ME, role: "member", ownerId: OTHER, addedBy: ME }),
    ).toEqual(["removeFromAlbum"]);
  });

  it("verwijderen staat als laatste", () => {
    const shown = photoActions({ me: ME, role: "admin", ownerId: ME, addedBy: ME });
    expect(shown[shown.length - 1]).toBe("delete");
    expect(new Set(shown).size).toBe(shown.length);
  });
});

// --- Selectie (invariant 7, A-keuze 2) ------------------------------------------------

describe("selectionPlan: per foto, met de regel van het menu", () => {
  const items = [
    { photoId: "p1", ownerId: ME, addedBy: ME },
    { photoId: "p2", ownerId: OTHER, addedBy: OTHER },
    { photoId: "p3", ownerId: ME, addedBy: ME },
    { photoId: "p4", ownerId: OTHER, addedBy: ME },
  ];

  it("verwijderen: alleen eigen foto's, ook voor een admin; de rest telt als niet toegestaan", () => {
    for (const role of ["member", "admin"] as const) {
      expect(
        selectionPlan("delete", items, { me: ME, role }),
        role,
      ).toEqual({ allowed: ["p1", "p3"], notAllowed: ["p2", "p4"] });
    }
  });

  it("uit album, lid: wat de user toevoegde", () => {
    expect(
      selectionPlan("removeFromAlbum", items, { me: ME, role: "member" }),
    ).toEqual({ allowed: ["p1", "p3", "p4"], notAllowed: ["p2"] });
  });

  it("uit album, admin: alles", () => {
    expect(
      selectionPlan("removeFromAlbum", items, { me: ME, role: "admin" }),
    ).toEqual({ allowed: ["p1", "p2", "p3", "p4"], notAllowed: [] });
  });

  it("de volgorde van de selectie blijft", () => {
    const reversed = [...items].reverse();
    expect(
      selectionPlan("removeFromAlbum", reversed, { me: ME, role: "admin" })
        .allowed,
    ).toEqual(["p4", "p3", "p2", "p1"]);
  });
});

describe("selectionSummary: hoeveel niet, en waarom", () => {
  for (const action of ["delete", "removeFromAlbum"] as const) {
    it(`${action}: alles gelukt geeft geen melding`, () => {
      expect(selectionSummary(action, { done: 5, notAllowed: 0, failed: 0 })).toBeNull();
    });

    it(`${action}: niet toegestaan noemt het aantal`, () => {
      const msg = selectionSummary(action, { done: 3, notAllowed: 2, failed: 0 });
      expect(msg).toMatch(/\b2\b/);
    });

    it(`${action}: mislukt noemt het aantal, en is een andere reden dan niet toegestaan`, () => {
      const failed = selectionSummary(action, { done: 3, notAllowed: 0, failed: 2 });
      const notAllowed = selectionSummary(action, { done: 3, notAllowed: 2, failed: 0 });
      expect(failed).toMatch(/\b2\b/);
      expect(failed).not.toEqual(notAllowed);
    });

    it(`${action}: beide redenen tegelijk noemen beide aantallen`, () => {
      const msg = selectionSummary(action, { done: 1, notAllowed: 2, failed: 3 });
      expect(msg).toMatch(/\b2\b/);
      expect(msg).toMatch(/\b3\b/);
    });
  }
});

// --- Draaischerm (invariant 11, WP8 §Frontend-contract) -------------------------------
//
// Onafhankelijk orakel: een pixelrooster van 2×3 met unieke cellen. De stand
// per EXIF-tag komt uit de EXIF-definitie (waar rij 0 en kolom 0 van het
// opgeslagen beeld zichtbaar terechtkomen), met indexformules, niet uit de
// tabellen in app/src/lib/photos.ts of convex/lib/exifOrientation.ts.
//
// De knoppen werken op het beeld zoals de user het ziet: rechts = een
// kwartslag met de klok mee, links = tegen de klok in, spiegelen = links en
// rechts wisselen. `photos.rotate({ rotation, flipY })` spiegelt eerst (als
// flipY) en draait dan `rotation` graden met de klok mee, ook op het getoonde
// beeld (WP8).

type Grid = string[][];
const STORED: Grid = [
  ["a", "b", "c"],
  ["d", "e", "f"],
];

const rows = (g: Grid) => g.length;
const cols = (g: Grid) => g[0]!.length;
const build = (r: number, c: number, cell: (i: number, j: number) => string): Grid =>
  Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => cell(i, j)));

const rotCW = (g: Grid) => build(cols(g), rows(g), (i, j) => g[rows(g) - 1 - j]![i]!);
const rotCCW = (g: Grid) => build(cols(g), rows(g), (i, j) => g[j]![cols(g) - 1 - i]!);
const rot180 = (g: Grid) => build(rows(g), cols(g), (i, j) => g[rows(g) - 1 - i]![cols(g) - 1 - j]!);
const mirrorH = (g: Grid) => build(rows(g), cols(g), (i, j) => g[i]![cols(g) - 1 - j]!);
const mirrorV = (g: Grid) => build(rows(g), cols(g), (i, j) => g[rows(g) - 1 - i]![j]!);
const transpose = (g: Grid) => build(cols(g), rows(g), (i, j) => g[j]![i]!);
const transverse = (g: Grid) =>
  build(cols(g), rows(g), (i, j) => g[rows(g) - 1 - j]![cols(g) - 1 - i]!);

// Wat de user ziet bij een opgeslagen beeld met deze tag.
const SHOWN: Record<number, (g: Grid) => Grid> = {
  1: (g) => g,
  2: mirrorH,
  3: rot180,
  4: mirrorV,
  5: transpose,
  6: rotCW,
  7: transverse,
  8: rotCCW,
};

type Step = "left" | "right" | "mirror";
const STEP: Record<Step, (g: Grid) => Grid> = { left: rotCCW, right: rotCW, mirror: mirrorH };

type Edit = { rotation: 0 | 90 | 180 | 270; flipY: boolean };
function applyEdit(g: Grid, e: Edit): Grid {
  let out = e.flipY ? mirrorH(g) : g;
  for (let k = 0; k < e.rotation / 90; k++) out = rotCW(out);
  return out;
}

function sequences(maxLen: number): Step[][] {
  const out: Step[][] = [[]];
  let frontier: Step[][] = [[]];
  for (let n = 0; n < maxLen; n++) {
    frontier = frontier.flatMap((s) => (["left", "right", "mirror"] as const).map((x) => [...s, x]));
    out.push(...frontier);
  }
  return out;
}

const eq = (a: Grid, b: Grid) => JSON.stringify(a) === JSON.stringify(b);

describe("composeRotation: de knoppen samen als één photos.rotate", () => {
  it("ankers: één knop", () => {
    expect(composeRotation(["right"])).toEqual({ rotation: 90, flipY: false });
    expect(composeRotation(["left"])).toEqual({ rotation: 270, flipY: false });
    expect(composeRotation(["mirror"])).toEqual({ rotation: 0, flipY: true });
  });

  it("ankers: volgorde telt", () => {
    // Eerst draaien, dan spiegelen = eerst spiegelen, dan de andere kant op draaien.
    expect(composeRotation(["right", "mirror"])).toEqual({ rotation: 270, flipY: true });
    expect(composeRotation(["mirror", "right"])).toEqual({ rotation: 90, flipY: true });
  });

  it("niets veranderd: null (niets te bewaren)", () => {
    expect(composeRotation([])).toBeNull();
    expect(composeRotation(["right", "left"])).toBeNull();
    expect(composeRotation(["right", "right", "right", "right"])).toBeNull();
    expect(composeRotation(["mirror", "mirror"])).toBeNull();
    expect(composeRotation(["mirror", "right", "mirror", "right"])).toBeNull();
  });

  it("elke reeks tot 5 knoppen: de bewaarde draaiing geeft precies het voorbeeld", () => {
    for (const steps of sequences(5)) {
      const shown = steps.reduce((g, s) => STEP[s](g), STORED);
      const edit = composeRotation(steps);
      if (eq(shown, STORED)) {
        expect(edit, steps.join(",")).toBeNull();
      } else {
        expect(edit, steps.join(",")).not.toBeNull();
        expect(eq(applyEdit(STORED, edit!), shown), steps.join(",")).toBe(true);
      }
    }
  });
});

describe("previewOrientation: de stand van de foto na bewaren", () => {
  const edits: Edit[] = [0, 90, 180, 270].flatMap((rotation) =>
    [false, true].map((flipY) => ({ rotation: rotation as Edit["rotation"], flipY })),
  );

  it("voor elke huidige stand en elke draaiing: het beeld met de nieuwe stand is het gedraaide beeld", () => {
    for (const current of [undefined, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const shownNow = SHOWN[current ?? 1]!(STORED);
      for (const e of edits) {
        const next = previewOrientation(current, e);
        const label = `${current}, ${e.rotation}, ${e.flipY}`;
        expect(Number.isInteger(next) && next >= 1 && next <= 8, label).toBe(true);
        expect(eq(SHOWN[next]!(STORED), applyEdit(shownNow, e)), label).toBe(true);
      }
    }
  });

  it("anker: een rechtopstaande foto een kwartslag naar rechts is tag 6", () => {
    expect(previewOrientation(undefined, { rotation: 90, flipY: false })).toBe(6);
    expect(previewOrientation(1, { rotation: 90, flipY: false })).toBe(6);
  });
});
