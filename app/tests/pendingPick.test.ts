import { describe, expect, it } from "vitest";
import {
  PENDING_PICK_MAX_MS,
  PICK_AGAIN_TEXT,
  pendingPickAction,
  pickMarkFromStore,
  pickMarkToStore,
  type PickMark,
} from "../src/lib/pendingPick";

// WP42c invariant 8, A36 (punt 7 van 42a): sluit Android de app terwijl de
// kiezer open is, dan staat de keuze na terugkomen in het toevoegscherm, of
// ziet het lid dat hij opnieuw moet kiezen.
//   - Vóór het openen van de kiezer onthoudt de app waarvoor (toevoegen, met
//     het gekozen album, of de profielfoto) en wanneer.
//   - Bij de start legt de app dat naast wat `getPendingResultAsync` geeft.
//   - Een keuze voor de profielfoto, of zonder bekend doel, komt nooit in het
//     toevoegscherm terecht: de kopieën gaan weg.
//   - Zonder resultaat (Android gaf niets terug, of het lid koos niets) en
//     kort na het openen: "kies opnieuw". Lang daarna niets.
// Spec: docs/work-packages/WP42-android.md §Spec-criticus aanvullingen 42c.

type Asset = { uri: string; type?: string };

const T = Date.UTC(2026, 10, 27, 12, 0, 0);
const A1: Asset = { uri: "file:///cache/ImagePicker/a.mp4", type: "video" };
const A2: Asset = { uri: "file:///cache/ImagePicker/b.jpg", type: "image" };

const adding = (albumId: string | null, at = T): PickMark => ({ kind: "toevoegen", albumId, at });
const profile = (at = T): PickMark => ({ kind: "profiel", at });

describe("de keuze komt terug in het toevoegscherm", () => {
  it("met de gekozen bestanden, in volgorde, en het album van toen", () => {
    expect(
      pendingPickAction<Asset>({ mark: adding("album-y"), result: { canceled: false, assets: [A1, A2] }, now: T + 60_000 }),
    ).toEqual({ kind: "toevoegen", albumId: "album-y", assets: [A1, A2] });
  });

  it("zonder album van toen: het toevoegscherm kiest zelf (laatst gekozen album)", () => {
    expect(
      pendingPickAction<Asset>({ mark: adding(null), result: { canceled: false, assets: [A1] }, now: T + 60_000 }),
    ).toEqual({ kind: "toevoegen", albumId: null, assets: [A1] });
  });

  it("ook als het lid lang in de kiezer bleef: een echte keuze telt altijd", () => {
    expect(
      pendingPickAction<Asset>({
        mark: adding("album-y"),
        result: { canceled: false, assets: [A1] },
        now: T + 5 * PENDING_PICK_MAX_MS,
      }),
    ).toEqual({ kind: "toevoegen", albumId: "album-y", assets: [A1] });
  });
});

describe("opnieuw kiezen", () => {
  it("geen resultaat, kort na het openen van de kiezer voor het toevoegscherm", () => {
    expect(pendingPickAction<Asset>({ mark: adding("album-y"), result: null, now: T + 2 * 60_000 })).toEqual({
      kind: "opnieuw_kiezen",
      albumId: "album-y",
    });
  });

  it("net onder de grens nog wel, op de grens niet meer", () => {
    expect(pendingPickAction<Asset>({ mark: adding(null), result: null, now: T + PENDING_PICK_MAX_MS - 1 }).kind).toBe(
      "opnieuw_kiezen",
    );
    expect(pendingPickAction<Asset>({ mark: adding(null), result: null, now: T + PENDING_PICK_MAX_MS })).toEqual({
      kind: "niets",
    });
  });

  it("een fout bij het ophalen van de keuze", () => {
    expect(
      pendingPickAction<Asset>({
        mark: adding("album-y"),
        result: { code: "ERR_FAILED_TO_READ_FILE", message: "x" },
        now: T + 60_000,
      }),
    ).toEqual({ kind: "opnieuw_kiezen", albumId: "album-y" });
  });

  it("de tekst zegt dat het lid opnieuw moet kiezen, zonder iets over toegang of instellingen", () => {
    expect(PICK_AGAIN_TEXT.trim().length).toBeGreaterThan(0);
    expect(PICK_AGAIN_TEXT).toMatch(/opnieuw/i);
    expect(PICK_AGAIN_TEXT).not.toMatch(/toegang|instellingen/i);
  });
});

describe("niets doen", () => {
  it("het lid annuleerde", () => {
    expect(pendingPickAction<Asset>({ mark: adding("album-y"), result: { canceled: true, assets: null }, now: T + 1 })).toEqual({
      kind: "niets",
    });
  });

  it("geen kiezer open en geen resultaat", () => {
    expect(pendingPickAction<Asset>({ mark: null, result: null, now: T })).toEqual({ kind: "niets" });
  });

  it("de profielfoto zonder resultaat of met een fout", () => {
    expect(pendingPickAction<Asset>({ mark: profile(), result: null, now: T + 1 })).toEqual({ kind: "niets" });
    expect(
      pendingPickAction<Asset>({ mark: profile(), result: { code: "E", message: "x" }, now: T + 1 }),
    ).toEqual({ kind: "niets" });
  });
});

describe("nooit in het toevoegscherm wat niet voor het toevoegscherm was", () => {
  it("een keuze voor de profielfoto: de kopieën weg", () => {
    expect(pendingPickAction<Asset>({ mark: profile(), result: { canceled: false, assets: [A2] }, now: T + 1 })).toEqual({
      kind: "weg",
      uris: [A2.uri],
    });
  });

  it("een keuze zonder bekend doel: de kopieën weg", () => {
    expect(pendingPickAction<Asset>({ mark: null, result: { canceled: false, assets: [A1, A2] }, now: T })).toEqual({
      kind: "weg",
      uris: [A1.uri, A2.uri],
    });
  });
});

describe("het doel op schijf", () => {
  it("heen en terug, voor beide doelen", () => {
    for (const mark of [adding("album-y"), adding(null), profile()]) {
      expect(pickMarkFromStore(pickMarkToStore(mark))).toEqual(mark);
    }
  });

  it("niets of iets onleesbaars is geen doel", () => {
    for (const raw of [null, "", "{", "[]", "{}", '{"kind":"anders","at":1}', '{"kind":"toevoegen"}', '{"kind":"profiel","at":"x"}']) {
      expect(pickMarkFromStore(raw), String(raw)).toBeNull();
    }
  });
});
