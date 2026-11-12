import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapRegion, placeShareActions, shareEdits, shareNotice } from "../src/lib/placeShare";

// WP17d: pure logica achter de albumkaart, "Locatie wijzigen" en delen.
// Spec: docs/work-packages/WP17d-kaart-locatie-delen.md §Spec-criticus
// aanvullingen (A-invariant 6 en 7; A-keuze 3 en 4; kernvondst 5). De
// schermen, de kaart zelf en het deelmenu toetst de gate.

const ME = "user_me";
const OTHER = "user_other";

// --- Menu (A-invariant 6) -------------------------------------------------------------

describe("placeShareActions: Locatie wijzigen alleen bij een eigen foto (A-invariant 6)", () => {
  it("eigen foto: locatie", () => {
    expect(placeShareActions({ me: ME, ownerId: ME, hasFormats: true })).toContain("location");
    expect(placeShareActions({ me: ME, ownerId: ME, hasFormats: false })).toContain("location");
  });

  it("andermans foto: geen locatie", () => {
    expect(placeShareActions({ me: ME, ownerId: OTHER, hasFormats: true })).not.toContain("location");
  });
});

describe("A-keuze 4: delen bij elke foto die je ziet, alleen met formaten", () => {
  it("eigen en andermans foto met formaten: delen", () => {
    expect(placeShareActions({ me: ME, ownerId: ME, hasFormats: true })).toContain("share");
    expect(placeShareActions({ me: ME, ownerId: OTHER, hasFormats: true })).toContain("share");
  });

  it("zonder formaten: niet delen (dan zou het origineel met GPS gaan)", () => {
    expect(placeShareActions({ me: ME, ownerId: ME, hasFormats: false })).not.toContain("share");
    expect(placeShareActions({ me: ME, ownerId: OTHER, hasFormats: false })).toEqual([]);
  });
});

// --- Melding vóór delen (A-keuze 3) -----------------------------------------------------

describe("A-keuze 3: melding vóór het delen van andermans foto", () => {
  it("eigen foto: geen melding", () => {
    expect(shareNotice({ me: ME, ownerId: ME, ownerName: "Ik" })).toBeNull();
  });

  it("andermans foto: één regel met de naam, en dat de foto de app verlaat", () => {
    const text = shareNotice({ me: ME, ownerId: OTHER, ownerName: "Mia" });
    expect(text).toMatch(/Mia/);
    expect(text).toMatch(/verlaat de app/);
    expect(text).not.toMatch(/\n/);
  });

  it("andermans foto zonder bekende naam: toch een melding, zonder 'undefined'", () => {
    const text = shareNotice({ me: ME, ownerId: OTHER, ownerName: undefined });
    expect(text).toMatch(/verlaat de app/);
    expect(text).not.toMatch(/undefined|null/);
  });
});

// --- Rechtop delen (kernvondst 5) -------------------------------------------------------
//
// *groot* bevat de ruwe pixels (WP25); de app toont ze met `exifOrientation`:
// eerst spiegelen, dan met de klok mee draaien (photos.ts, orientationOf). De
// gedeelde JPEG moet zo al rechtop staan: dezelfde stappen, in die volgorde,
// voor expo-image-manipulator (rotate: positief = met de klok mee).

describe("shareEdits: de stappen om de pixels rechtop te zetten", () => {
  it.each([
    [undefined, []],
    [1, []],
    [2, [{ flip: "horizontal" }]],
    [3, [{ rotate: 180 }]],
    [4, [{ flip: "horizontal" }, { rotate: 180 }]],
    [5, [{ flip: "horizontal" }, { rotate: 270 }]],
    [6, [{ rotate: 90 }]],
    [7, [{ flip: "horizontal" }, { rotate: 90 }]],
    [8, [{ rotate: 270 }]],
    [0, []],
    [9, []],
    [6.5, []],
  ] as const)("exifOrientation %s → %j", (tag, steps) => {
    expect(shareEdits(tag as number | undefined)).toEqual(steps);
  });
});

// --- De kaart past zich aan de foto's aan (pariteit v1) ------------------------------------

describe("mapRegion: de regio rond de plekken", () => {
  it("geen plekken: geen regio", () => {
    expect(mapRegion([])).toBeNull();
  });

  it("één plek: daar het midden, met een zichtbare uitsnede", () => {
    const r = mapRegion([{ latitude: 52.12, longitude: 5.99 }])!;
    expect(r.latitude).toBeCloseTo(52.12, 6);
    expect(r.longitude).toBeCloseTo(5.99, 6);
    expect(r.latitudeDelta).toBeGreaterThanOrEqual(0.01);
    expect(r.longitudeDelta).toBeGreaterThanOrEqual(0.01);
  });

  it("meer plekken: allemaal binnen de regio, niet op de rand", () => {
    const pts = [
      { latitude: 52.37, longitude: 4.89 },
      { latitude: 51.44, longitude: 5.48 },
      { latitude: 53.22, longitude: 6.57 },
    ];
    const r = mapRegion(pts)!;
    for (const p of pts) {
      expect(Math.abs(p.latitude - r.latitude)).toBeLessThan(0.45 * r.latitudeDelta);
      expect(Math.abs(p.longitude - r.longitude)).toBeLessThan(0.45 * r.longitudeDelta);
    }
  });

  it("plekken over de hele wereld: nooit meer dan de wereld", () => {
    const r = mapRegion([
      { latitude: -80, longitude: -170 },
      { latitude: 80, longitude: 170 },
    ])!;
    expect(r.latitudeDelta).toBeLessThanOrEqual(180);
    expect(r.longitudeDelta).toBeLessThanOrEqual(360);
  });
});

// --- Geen locatie van het toestel (A-invariant 7, draft invariant 6) ----------------------

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("A-invariant 7: de app vraagt niet naar de plek van de telefoon", () => {
  it("geen expo-location in de afhankelijkheden", () => {
    const pkg = JSON.parse(readFileSync(join(APP, "package.json"), "utf8"));
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain("expo-location");
  });

  it("geen NSLocation…-tekst en geen location-plugin in app.json", () => {
    const raw = readFileSync(join(APP, "app.json"), "utf8");
    expect(raw).not.toMatch(/NSLocation/);
    expect(raw).not.toMatch(/expo-location/);
  });

  it("geen showsUserLocation of expo-location in de broncode", () => {
    const hits = sourceFiles(join(APP, "src")).filter((f) =>
      /showsUserLocation|followsUserLocation|expo-location/.test(readFileSync(f, "utf8")),
    );
    expect(hits).toEqual([]);
  });

  it("de kaart en het delen staan in de module (sanity: de module bestaat)", () => {
    expect(typeof mapRegion).toBe("function");
  });
});
