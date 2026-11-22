import { describe, expect, it } from "vitest";
import {
  enterSelectionScroll,
  leaveSelectionScroll,
  selectionButtons,
  selectionHeader,
} from "../src/lib/selectionBar";

// WP40: de selectiestand in het album en in Mijn foto's, als pure logica.
//   A1, A2: de titel in de kop ("Kies foto's", "3 geselecteerd", "Bezig…") en
//   wanneer "Annuleren" uit staat (alleen tijdens een actie, invariant 3).
//   A2, A6, A7: de knoppen in de balk, per scherm, in vaste volgorde, met hun
//   VoiceOver-naam met het aantal. Grijs bij nul en tijdens een actie, nooit
//   op grond van wie de foto's zijn (WP17b A-keuze 2).
//   A3, A4, besluit 2 (aanbeveling): bij Selecteer scrolt het album naar het
//   raster, zo ver als de lijst kan; terug gaat het alleen naar de oude plek
//   als je zelf niet gescrold hebt.
// Spec: docs/work-packages/WP40-selectiebalk.md §Testcontract.

describe("selectionHeader: de titel in de kop (A1)", () => {
  it("niets gekozen: Kies foto's", () => {
    expect(selectionHeader({ count: 0, busy: false }).title).toBe("Kies foto's");
  });

  it("één gekozen: 1 geselecteerd", () => {
    expect(selectionHeader({ count: 1, busy: false }).title).toBe("1 geselecteerd");
  });

  it.each([2, 3, 48, 120])("%i gekozen: '%i geselecteerd'", (n) => {
    expect(selectionHeader({ count: n, busy: false }).title).toBe(`${n} geselecteerd`);
  });

  it("tijdens een actie: Bezig…, wat er ook gekozen is (WP17b invariant 15)", () => {
    expect(selectionHeader({ count: 3, busy: true }).title).toBe("Bezig…");
    expect(selectionHeader({ count: 1, busy: true }).title).toBe("Bezig…");
    expect(selectionHeader({ count: 0, busy: true }).title).toBe("Bezig…");
  });
});

describe("selectionHeader: Annuleren (invariant 2 en 3, A2)", () => {
  it("werkt altijd, ook bij nul", () => {
    expect(selectionHeader({ count: 0, busy: false }).cancelDisabled).toBe(false);
    expect(selectionHeader({ count: 5, busy: false }).cancelDisabled).toBe(false);
  });

  it("uit tijdens een actie", () => {
    expect(selectionHeader({ count: 5, busy: true }).cancelDisabled).toBe(true);
  });
});

describe("selectionButtons: welke knoppen, in welke volgorde (A2)", () => {
  it("album: Naar album, Uit album, Verwijderen", () => {
    const b = selectionButtons({ place: "album", count: 3, busy: false });
    expect(b.map((x) => x.action)).toEqual(["addToAlbum", "removeFromAlbum", "delete"]);
    expect(b.map((x) => x.title)).toEqual(["Naar album", "Uit album", "Verwijderen"]);
  });

  it("Mijn foto's: Naar album en Verwijderen, geen Uit album", () => {
    const b = selectionButtons({ place: "mine", count: 3, busy: false });
    expect(b.map((x) => x.action)).toEqual(["addToAlbum", "delete"]);
    expect(b.map((x) => x.title)).toEqual(["Naar album", "Verwijderen"]);
  });

  it.each(["album", "mine"] as const)("%s: alleen Verwijderen is rood, en staat als laatste", (place) => {
    const b = selectionButtons({ place, count: 2, busy: false });
    expect(b.filter((x) => x.danger).map((x) => x.action)).toEqual(["delete"]);
    expect(b.at(-1)!.action).toBe("delete");
  });

  it("geen Annuleren en geen uitlegregel in de balk", () => {
    for (const place of ["album", "mine"] as const) {
      const titles = selectionButtons({ place, count: 0, busy: false }).map((x) => x.title);
      expect(titles).not.toContain("Annuleren");
      expect(titles.join(" ")).not.toMatch(/Tik op/);
    }
  });
});

describe("selectionButtons: grijs bij nul en tijdens een actie (invariant 2 en 3, A2)", () => {
  it.each(["album", "mine"] as const)("%s: nul gekozen: alles uit, maar wel getoond", (place) => {
    const b = selectionButtons({ place, count: 0, busy: false });
    expect(b.length).toBe(place === "album" ? 3 : 2);
    expect(b.every((x) => x.disabled)).toBe(true);
  });

  it.each(["album", "mine"] as const)("%s: iets gekozen: alles aan", (place) => {
    for (const count of [1, 2, 40]) {
      expect(selectionButtons({ place, count, busy: false }).every((x) => !x.disabled)).toBe(true);
    }
  });

  it.each(["album", "mine"] as const)("%s: tijdens een actie: alles uit, ook met een keuze", (place) => {
    expect(selectionButtons({ place, count: 3, busy: true }).every((x) => x.disabled)).toBe(true);
  });
});

describe("selectionButtons: VoiceOver-namen met het aantal (invariant 5, A7)", () => {
  it("meer foto's: titel, komma, aantal foto's", () => {
    const b = selectionButtons({ place: "album", count: 3, busy: false });
    expect(b.map((x) => x.accessibilityLabel)).toEqual([
      "Naar album, 3 foto's",
      "Uit album, 3 foto's",
      "Verwijderen, 3 foto's",
    ]);
  });

  it("één foto: enkelvoud", () => {
    const b = selectionButtons({ place: "mine", count: 1, busy: false });
    expect(b.map((x) => x.accessibilityLabel)).toEqual(["Naar album, 1 foto", "Verwijderen, 1 foto"]);
  });

  it("nul: alleen de titel (VoiceOver zegt zelf 'gedimd')", () => {
    const b = selectionButtons({ place: "album", count: 0, busy: false });
    expect(b.map((x) => x.accessibilityLabel)).toEqual(["Naar album", "Uit album", "Verwijderen"]);
  });

  it("tijdens een actie blijft het aantal in de naam", () => {
    const b = selectionButtons({ place: "mine", count: 2, busy: true });
    expect(b.map((x) => x.accessibilityLabel)).toEqual(["Naar album, 2 foto's", "Verwijderen, 2 foto's"]);
  });

  it("de naam begint met de zichtbare titel (Voice Control: 'tik Verwijderen')", () => {
    for (const x of selectionButtons({ place: "album", count: 7, busy: false })) {
      expect(x.accessibilityLabel.startsWith(x.title)).toBe(true);
    }
  });
});

describe("enterSelectionScroll: Selecteer klapt de omslag in (besluit 3, A3)", () => {
  // Een album op een iPhone: het raster begint onder de kop bij 420 pt
  // gescrold; de lijst kan tot 2400.
  const gridTop = 420;
  const maxOffset = 2400;

  it("bovenaan: scrolt tot het raster direct onder de kop begint", () => {
    expect(enterSelectionScroll({ offset: 0, gridTop, maxOffset })).toBe(420);
  });

  it("halverwege de omslag: ook naar het raster", () => {
    expect(enterSelectionScroll({ offset: 150, gridTop, maxOffset })).toBe(420);
  });

  it("omlaag getrokken (negatieve positie): naar het raster", () => {
    expect(enterSelectionScroll({ offset: -40, gridTop, maxOffset })).toBe(420);
  });

  it("al precies bij het raster: blijft staan", () => {
    expect(enterSelectionScroll({ offset: 420, gridTop, maxOffset })).toBeNull();
  });

  it("al verder: blijft staan (niets beweegt)", () => {
    expect(enterSelectionScroll({ offset: 900, gridTop, maxOffset })).toBeNull();
  });

  it("weinig foto's: zo ver als de lijst kan (besluit 2, aanbeveling)", () => {
    expect(enterSelectionScroll({ offset: 0, gridTop, maxOffset: 180 })).toBe(180);
  });

  it("past alles in beeld (de lijst kan niet scrollen): blijft staan", () => {
    expect(enterSelectionScroll({ offset: 0, gridTop, maxOffset: 0 })).toBeNull();
  });

  it("nooit naar een negatieve positie", () => {
    expect(enterSelectionScroll({ offset: -40, gridTop, maxOffset: -10 })).toBe(0);
    const t = enterSelectionScroll({ offset: 0, gridTop: -5, maxOffset });
    expect(t === null || t >= 0).toBe(true);
  });
});

describe("leaveSelectionScroll: terug uit de selectie (invariant 4, A4)", () => {
  it("niet zelf gescrold: terug naar waar je stond vóór Selecteer, de omslag weer in beeld", () => {
    expect(leaveSelectionScroll({ before: 0, entered: 420, current: 420 })).toBe(0);
    expect(leaveSelectionScroll({ before: 150, entered: 420, current: 420 })).toBe(150);
  });

  it("een halve punt verschil telt als niet gescrold (afronding van het scrollen)", () => {
    expect(leaveSelectionScroll({ before: 0, entered: 420, current: 420.5 })).toBe(0);
  });

  it("wel gescrold, omlaag of omhoog: het raster blijft staan", () => {
    expect(leaveSelectionScroll({ before: 0, entered: 420, current: 1300 })).toBeNull();
    expect(leaveSelectionScroll({ before: 0, entered: 420, current: 200 })).toBeNull();
  });

  it("Selecteer scrolde niet (al verder, of brede layout): blijft staan", () => {
    expect(leaveSelectionScroll({ before: 900, entered: null, current: 900 })).toBeNull();
    expect(leaveSelectionScroll({ before: 900, entered: null, current: 1500 })).toBeNull();
  });

  it("samen: bovenaan Selecteer en meteen Annuleren eindigt waar je begon", () => {
    const before = 0;
    const entered = enterSelectionScroll({ offset: before, gridTop: 420, maxOffset: 2400 });
    expect(leaveSelectionScroll({ before, entered, current: entered ?? before })).toBe(before);
  });
});
