import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRuntime } from "./support/hookRuntime";

// WP17d besluit 4, A-invariant 11 (audit S3): "Opslaan" staat pas aan na een
// tik of sleep als er geen opgeslagen plek is, ook direct na "Locatie
// weghalen". Anders slaat een tik uit gewoonte midden-Nederland op, met een
// Photon-plaatsnaam, en staat de foto weer op de kaart.
//
// De speld en de knop komen uit één hook (aangenomen API, spec §Aangenomen
// API):
//   useLocationDraft(saved: Point | null) → { pin, move, canSave }
//   in app/src/lib/locationDraft.ts.
//   - pin: de opgeslagen plek, of midden-Nederland zonder plek;
//   - move(p): de speld naar p (tik op de kaart of slepen);
//   - canSave: alleen na een move, en alleen als de speld niet op de
//     opgeslagen plek staat.
// Verandert de opgeslagen plek (weggehaald, of opgeslagen), dan begint de
// speld opnieuw: op de nieuwe plek of in midden-Nederland, en Opslaan uit.
// Dezelfde plek in een nieuw object (een nieuwe uitslag van de live query)
// verandert niets.
//
// Spec: docs/work-packages/WP17d-kaart-locatie-delen.md §Spec-criticus aanvullingen.

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

type Point = { latitude: number; longitude: number };
type Draft = { pin: Point; move: (p: Point) => void; canSave: boolean };

const HOME: Point = { latitude: 52.1234, longitude: 5.9876 };
const PARIS: Point = { latitude: 48.8566, longitude: 2.3522 };

let saved: Point | null = null;
let draft: Draft;
let middle: Point;

async function mount(initial: Point | null) {
  saved = initial;
  const { useLocationDraft } = await import("../src/lib/locationDraft");
  const { MIDDLE_NL } = await import("../src/lib/placeShare");
  middle = { latitude: MIDDLE_NL.latitude, longitude: MIDDLE_NL.longitude };
  rt.runtime.render(() => {
    draft = useLocationDraft(saved) as Draft;
    return null;
  });
}

async function rerender(next: Point | null) {
  saved = next;
  await rt.runtime.settle();
}

async function move(p: Point) {
  draft.move(p);
  await rt.runtime.settle();
}

beforeEach(() => {
  saved = null;
});

describe("A-invariant 11: zonder opgeslagen plek pas Opslaan na een tik of sleep", () => {
  it("geen plek: de speld in midden-Nederland, Opslaan uit", async () => {
    await mount(null);
    expect(draft.pin).toEqual(middle);
    expect(draft.canSave).toBe(false);
  });

  it("geen plek, na een tik: Opslaan aan, de speld op die plek", async () => {
    await mount(null);
    await move(PARIS);
    expect(draft.pin).toEqual(PARIS);
    expect(draft.canSave).toBe(true);
  });

  it("geen plek, een tik op midden-Nederland zelf: ook dan mag Opslaan (de keuze is bewust)", async () => {
    await mount(null);
    await move(middle);
    expect(draft.canSave).toBe(true);
  });
});

describe("A-invariant 11: met een opgeslagen plek alleen Opslaan als de speld ergens anders staat", () => {
  it("de opgeslagen plek: de speld daar, Opslaan uit", async () => {
    await mount(HOME);
    expect(draft.pin).toEqual(HOME);
    expect(draft.canSave).toBe(false);
  });

  it("verplaatst: Opslaan aan; terug op de opgeslagen plek: weer uit", async () => {
    await mount(HOME);
    await move(PARIS);
    expect(draft.canSave).toBe(true);
    await move({ ...HOME });
    expect(draft.canSave).toBe(false);
  });

  it("dezelfde plek in een nieuw object (live query): de verplaatste speld blijft", async () => {
    await mount(HOME);
    await move(PARIS);
    await rerender({ ...HOME });
    expect(draft.pin).toEqual(PARIS);
    expect(draft.canSave).toBe(true);
  });
});

describe("A-invariant 11: direct na weghalen staat Opslaan uit (audit S3)", () => {
  it("weggehaald zonder te verplaatsen: speld in midden-Nederland, Opslaan uit", async () => {
    await mount(HOME);
    await rerender(null);
    expect(draft.pin).toEqual(middle);
    expect(draft.canSave).toBe(false);
  });

  it("eerst verplaatst, daarna weggehaald: ook dan Opslaan uit", async () => {
    await mount(HOME);
    await move(PARIS);
    await rerender(null);
    expect(draft.pin).toEqual(middle);
    expect(draft.canSave).toBe(false);
  });

  it("na weghalen een tik: Opslaan weer aan", async () => {
    await mount(HOME);
    await rerender(null);
    await move(PARIS);
    expect(draft.canSave).toBe(true);
  });

  it("na opslaan (de live query geeft de nieuwe plek): Opslaan uit, de speld op de nieuwe plek", async () => {
    await mount(null);
    await move(PARIS);
    await rerender({ ...PARIS });
    expect(draft.pin).toEqual(PARIS);
    expect(draft.canSave).toBe(false);
  });
});

describe("A-invariant 11: het scherm gebruikt de hook voor de knop", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "screens", "LocationScreen.tsx");

  it("LocationScreen roept useLocationDraft aan en zet Opslaan uit met canSave", () => {
    const text = readFileSync(SRC, "utf8");
    expect(text).toMatch(/\buseLocationDraft\(/);
    expect(text).toMatch(/disabled=\{[^}]*canSave/);
  });
});
