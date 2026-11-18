import { describe, expect, it } from "vitest";
import {
  appearFeedback,
  headerFade,
  headerMotion,
  infoOpacity,
  newlyArrived,
  pressFeedback,
  pressRelease,
  type HeaderLayout,
} from "../src/lib/motion";

// WP33: subtiele animaties. Pure logica; de schermen, de haptics en of het
// subtiel genoeg is, toetst B in de simulator en Wouter op een toestel.
// Spec: docs/work-packages/WP33-animaties.md, invarianten 1–3, 5–9, 11 en 12,
// A-aanvullingen A1, A2, A4, A5, B1, B2, B6, B7, C1–C3, D4, F2 en F4, open
// vraag 1, besluit 5.
//
// Afspraken voor de kop (Groep en Album; geen navigatiebalk):
// - `offset`: de scrollpositie van het scherm. 0 = bovenaan, positief = de
//   inhoud is omhoog gescrold, negatief = bovenaan omlaag getrokken.
// - `layout.height`: de gemeten hoogte van de kop in rust, inclusief de
//   statusbalk (groeit mee met grote tekst). `layout.topInset`: de statusbalk.
// - y = 0 is de bovenrand van het scherm; daar begint de kop in rust.
// - `coverTop`: y van de bovenrand van de cover (of het verloop) op het scherm.
//   Zonder enige beweging zou dat `-offset` zijn, net als de inhoud.
// - `coverHeight`: hoe hoog de cover op het scherm is.
// - `coverZoom`: hoe ver de foto binnen dat vlak is ingezoomd (1 = past precies).
// - `headerFade(offset, elementTop, ...)`: een element in de kop (de
//   letter-tegel, de terugknop-pil) dat in rust op y = `elementTop` staat en
//   met de kop meebeweegt. Op het scherm staat zijn bovenkant dus op
//   `elementTop + coverTop`.

const LAYOUTS: { name: string; layout: HeaderLayout }[] = [
  // Kleinste iPhone: statusbalk 20, kop 20 + 168.
  { name: "kleine iPhone, groep", layout: { height: 188, topInset: 20 } },
  { name: "iPhone met eiland, groep", layout: { height: 227, topInset: 59 } },
  { name: "iPhone met eiland, album", layout: { height: 295, topInset: 59 } },
  // A5: grote tekst maakt de kop hoger.
  { name: "grootste tekst", layout: { height: 420, topInset: 59 } },
  { name: "iPad", layout: { height: 292, topInset: 24 } },
];

const MOVE = { cover: true, reduceMotion: false };
const NO_COVER = { cover: false, reduceMotion: false };
const STILL = { cover: true, reduceMotion: true };

function range(from: number, to: number, step = 1): number[] {
  const out: number[] = [];
  for (let x = from; x <= to + 1e-9; x += step) out.push(Math.round(x * 1000) / 1000);
  return out;
}

describe.each(LAYOUTS)("de kop: $name", ({ layout }) => {
  const { height, topInset } = layout;
  const up = range(0, 2 * height);
  // Elementen in de kop: de pil vlak onder de statusbalk, iets lager, en de
  // letter-tegel in het midden.
  const elementTops = [topInset + 8, topInset + 40, Math.round(height / 2)];

  describe("in rust", () => {
    it("de cover staat bovenaan, op volle hoogte, licht ingezoomd (invariant 1)", () => {
      const m = headerMotion(0, layout, MOVE);
      expect(m.coverTop).toBeCloseTo(0, 6);
      expect(m.coverHeight).toBeCloseTo(height, 6);
      expect(m.coverZoom).toBeGreaterThanOrEqual(1.1);
      expect(m.coverZoom).toBeLessThanOrEqual(1.2);
    });

    it("zonder cover geen zoom (invariant 3)", () => {
      expect(headerMotion(0, layout, NO_COVER).coverZoom).toBe(1);
    });

    it("letter-tegel en pil volledig zichtbaar, op ware grootte", () => {
      for (const top of elementTops) {
        const f = headerFade(0, top, layout, { reduceMotion: false });
        expect(f.opacity).toBe(1);
        expect(f.scale).toBe(1);
      }
    });
  });

  describe("omhoog scrollen (invariant 1, A1)", () => {
    it("de cover gaat omhoog, maar langzamer dan de inhoud", () => {
      for (const offset of range(1, height)) {
        const { coverTop } = headerMotion(offset, layout, MOVE);
        expect(coverTop).toBeGreaterThan(-offset);
        // Hij beweegt wel: minstens een kwart van de snelheid van de inhoud.
        expect(coverTop).toBeLessThanOrEqual(-0.25 * offset);
      }
    });

    it("de cover gaat nooit terug omlaag en springt niet", () => {
      let prev = headerMotion(0, layout, MOVE).coverTop;
      for (const offset of up.slice(1)) {
        const { coverTop } = headerMotion(offset, layout, MOVE);
        expect(coverTop).toBeLessThanOrEqual(prev + 1e-9);
        // Nooit sneller dan de inhoud: per punt scrollen hoogstens een punt.
        expect(prev - coverTop).toBeLessThanOrEqual(1 + 1e-9);
        prev = coverTop;
      }
    });

    it("geen gat tussen de cover en de inhoud eronder", () => {
      for (const offset of up) {
        const { coverTop, coverHeight } = headerMotion(offset, layout, MOVE);
        expect(coverTop + coverHeight).toBeGreaterThanOrEqual(height - offset - 1e-9);
      }
    });

    it("de cover zoomt geleidelijk uit naar 1× en nooit verder", () => {
      let prev = headerMotion(0, layout, MOVE).coverZoom;
      for (const offset of up.slice(1)) {
        const { coverZoom } = headerMotion(offset, layout, MOVE);
        expect(coverZoom).toBeLessThanOrEqual(prev + 1e-9);
        expect(prev - coverZoom).toBeLessThanOrEqual(0.01);
        expect(coverZoom).toBeGreaterThanOrEqual(1);
        prev = coverZoom;
      }
      // Uiterlijk als de kop uit beeld is: precies 1×.
      expect(headerMotion(height, layout, MOVE).coverZoom).toBeCloseTo(1, 6);
      expect(headerMotion(10_000, layout, MOVE).coverZoom).toBeCloseTo(1, 6);
    });

    it("zonder cover dezelfde beweging, zonder zoom (invariant 3)", () => {
      for (const offset of up) {
        const a = headerMotion(offset, layout, MOVE);
        const b = headerMotion(offset, layout, NO_COVER);
        expect(b.coverTop).toBeCloseTo(a.coverTop, 9);
        expect(b.coverHeight).toBeCloseTo(a.coverHeight, 9);
        expect(b.coverZoom).toBe(1);
      }
    });

    it("blijft eindig bij een extreme scrollpositie", () => {
      const m = headerMotion(100_000, layout, MOVE);
      expect(Number.isFinite(m.coverTop)).toBe(true);
      expect(Number.isFinite(m.coverHeight)).toBe(true);
      expect(Number.isFinite(m.coverZoom)).toBe(true);
    });
  });

  describe("vervagen en krimpen in de kop (invariant 1, A2)", () => {
    it("volledig vervaagd voordat de bovenkant onder de statusbalk komt", () => {
      for (const top of elementTops) {
        for (const offset of up) {
          const { coverTop } = headerMotion(offset, layout, MOVE);
          const f = headerFade(offset, top, layout, { reduceMotion: false });
          if (top + coverTop < topInset) expect(f.opacity).toBeCloseTo(0, 6);
        }
      }
    });

    it("vervaagt geleidelijk en komt niet terug zolang je verder scrolt", () => {
      for (const top of elementTops) {
        let prev = headerFade(0, top, layout, { reduceMotion: false }).opacity;
        for (const offset of up.slice(1)) {
          const { opacity } = headerFade(offset, top, layout, { reduceMotion: false });
          expect(opacity).toBeGreaterThanOrEqual(0);
          expect(opacity).toBeLessThanOrEqual(1);
          expect(opacity).toBeLessThanOrEqual(prev + 1e-9);
          expect(prev - opacity).toBeLessThanOrEqual(0.15);
          prev = opacity;
        }
      }
    });

    it("krimpt licht, nooit kleiner dan 0,8, en niet terug", () => {
      for (const top of elementTops) {
        let prev = 1;
        for (const offset of up) {
          const { scale } = headerFade(offset, top, layout, { reduceMotion: false });
          expect(scale).toBeGreaterThanOrEqual(0.8);
          expect(scale).toBeLessThanOrEqual(prev + 1e-9);
          prev = scale;
        }
      }
    });

    it("de letter-tegel is al zichtbaar kleiner voordat hij weg is", () => {
      const top = Math.round(height / 2);
      const visible = up.filter((o) => headerFade(o, top, layout, { reduceMotion: false }).opacity > 0);
      const last = visible[visible.length - 1]!;
      expect(headerFade(last, top, layout, { reduceMotion: false }).scale).toBeLessThan(1);
    });
  });

  describe("bovenaan omlaag trekken (invariant 2, A4)", () => {
    const pulls = range(1, 240);

    it("de cover blijft aan de bovenkant vast en rekt tot aan de inhoud", () => {
      for (const pull of pulls) {
        for (const opts of [MOVE, NO_COVER]) {
          const { coverTop, coverHeight } = headerMotion(-pull, layout, opts);
          expect(coverTop).toBeCloseTo(0, 6);
          // De inhoud begint nu op height + pull: geen lege rand ertussen.
          expect(coverTop + coverHeight).toBeGreaterThanOrEqual(height + pull - 1e-6);
        }
      }
    });

    it("de foto vult het gerekte vlak; zonder cover geen zoom", () => {
      for (const pull of pulls) {
        expect(headerMotion(-pull, layout, MOVE).coverZoom).toBeGreaterThanOrEqual(1);
        expect(headerMotion(-pull, layout, NO_COVER).coverZoom).toBe(1);
      }
    });

    it("letter-tegel en pil vervagen en krimpen niet", () => {
      for (const pull of pulls) {
        for (const top of elementTops) {
          const f = headerFade(-pull, top, layout, { reduceMotion: false });
          expect(f.opacity).toBe(1);
          expect(f.scale).toBe(1);
        }
      }
    });
  });

  describe("Beperk beweging (invariant 11, F2): de kop van nu", () => {
    it("scrolt gewoon mee, cover op 1×, niets vervaagt of krimpt", () => {
      for (const offset of up) {
        for (const opts of [STILL, { cover: false, reduceMotion: true }]) {
          const m = headerMotion(offset, layout, opts);
          expect(m.coverTop).toBeCloseTo(-offset, 9);
          expect(m.coverHeight).toBeCloseTo(height, 9);
          expect(m.coverZoom).toBe(1);
        }
        for (const top of elementTops) {
          const f = headerFade(offset, top, layout, { reduceMotion: true });
          expect(f.opacity).toBe(1);
          expect(f.scale).toBe(1);
        }
      }
    });
  });

  // Open vraag 1 aan regie. Advies: de stretch blijft, want hij volgt de vinger
  // en is geen animatie. Besluit regie anders, dan verandert alleen dit blok.
  describe("trekken met Beperk beweging (open vraag 1, advies: stretch blijft)", () => {
    it("geen lege rand boven de cover, geen zoom", () => {
      for (const pull of range(1, 240)) {
        const m = headerMotion(-pull, layout, STILL);
        expect(m.coverTop).toBeCloseTo(0, 6);
        expect(m.coverTop + m.coverHeight).toBeGreaterThanOrEqual(height + pull - 1e-6);
        expect(m.coverZoom).toBe(1);
      }
    });
  });
});

// --- Foto-detail (invariant 7, C1–C3) -----------------------------------------------
//
// `position`: de horizontale scrollpositie in pagina's (0 = eerste foto, 2,5 =
// halverwege de derde en de vierde). `shownIndex`: de foto waarvan het
// informatieblok nu de gegevens toont. `count`: het aantal foto's.

describe("informatieblok tijdens het swipen", () => {
  const COUNT = 6;

  it("volledig zichtbaar als de foto van het blok stilstaat in beeld", () => {
    for (let i = 0; i < COUNT; i++) expect(infoOpacity(i, i, COUNT, false)).toBe(1);
  });

  it("onzichtbaar zodra de foto van het blok halverwege of verder weg is (C1)", () => {
    // Dus ook op het moment dat de gegevens wisselen: halverwege twee foto's
    // is het blok onzichtbaar, welke van de twee het ook toont.
    for (let shown = 0; shown < COUNT; shown++) {
      for (const position of range(0, COUNT - 1, 0.05)) {
        if (Math.abs(position - shown) >= 0.5 - 1e-9) expect(infoOpacity(position, shown, COUNT, false)).toBeCloseTo(0, 6);
      }
    }
    expect(infoOpacity(2.5, 2, COUNT, false)).toBeCloseTo(0, 6);
    expect(infoOpacity(2.5, 3, COUNT, false)).toBeCloseTo(0, 6);
  });

  it("vervaagt mee met de swipe: geleidelijk, zonder sprong (C1, C2)", () => {
    for (let shown = 0; shown < COUNT; shown++) {
      let prev = infoOpacity(Math.max(0, shown - 1), shown, COUNT, false);
      for (const position of range(Math.max(0, shown - 1), Math.min(COUNT - 1, shown + 1), 0.01).slice(1)) {
        const o = infoOpacity(position, shown, COUNT, false);
        expect(o).toBeGreaterThanOrEqual(0);
        expect(o).toBeLessThanOrEqual(1);
        expect(Math.abs(o - prev)).toBeLessThanOrEqual(0.05);
        prev = o;
      }
    }
  });

  it("hoe verder weg, hoe doorzichtiger", () => {
    for (const d of range(0, 0.99, 0.01)) {
      const near = infoOpacity(3 + d, 3, COUNT, false);
      const far = infoOpacity(3 + d + 0.01, 3, COUNT, false);
      expect(far).toBeLessThanOrEqual(near + 1e-9);
      expect(infoOpacity(3 - d - 0.01, 3, COUNT, false)).toBeLessThanOrEqual(infoOpacity(3 - d, 3, COUNT, false) + 1e-9);
    }
  });

  it("voorbij de eerste of laatste foto trekken laat het blok staan (C3)", () => {
    for (const over of [0.01, 0.1, 0.3, 0.6]) {
      expect(infoOpacity(-over, 0, COUNT, false)).toBe(1);
      expect(infoOpacity(COUNT - 1 + over, COUNT - 1, COUNT, false)).toBe(1);
    }
  });

  it("één foto: altijd zichtbaar", () => {
    for (const position of [-0.4, 0, 0.3]) expect(infoOpacity(position, 0, 1, false)).toBe(1);
  });

  it("Beperk beweging: het blok blijft zichtbaar (invariant 11, F2)", () => {
    for (const position of range(0, COUNT - 1, 0.1)) {
      for (let shown = 0; shown < COUNT; shown++) expect(infoOpacity(position, shown, COUNT, true)).toBe(1);
    }
  });
});

// --- Indrukken en verschijnen (invarianten 5, 6, 8, 9, 12; F4) ----------------------

// Besluit 5 (na de gate): indrukken moet op het toestel duidelijk te zien zijn.
// `pressFeedback(kind, reduceMotion)`:
// - `scale`: de hele knop of tegel krimpt hiertoe;
// - `coverZoom`: de cover in een tegel zoomt hiertoe in, binnen zijn vak
//   (een foto-tegel heeft geen cover erin en gebruikt dit niet; knop: 1);
// - `shade`: dekking van een donkere laag over de tegel (knop: 0);
// - `dim`: het bestaande dimmen of oplichten van een knop (alleen met
//   "Beperk beweging");
// - `inDuration`, `outDuration`: in ms, indrukken en terugveren.
// `pressRelease(heldMs, kind, reduceMotion)`: na loslaten, `heldMs` na het
// indrukken: hoe lang nog wachten (`delay`) en hoe lang het terugveren duurt
// (`duration`), beide in ms. De actie zelf wacht hier niet op (B5).

const KINDS = ["button", "tile"] as const;

describe("indrukken (invarianten 5, 6, 12; besluit 5)", () => {
  it("knoppen krimpen duidelijk, rond 0,94×, en worden niet donkerder (B3, B7)", () => {
    const f = pressFeedback("button", false);
    expect(f.scale).toBeGreaterThanOrEqual(0.92);
    expect(f.scale).toBeLessThanOrEqual(0.96);
    expect(f.coverZoom).toBe(1);
    expect(f.shade).toBe(0);
    expect(f.dim).toBe(false);
  });

  it("tegels (ook foto-tegels) krimpen duidelijk, rond 0,94×, en worden iets donkerder (B1, B2, B7)", () => {
    const f = pressFeedback("tile", false);
    expect(f.scale).toBeGreaterThanOrEqual(0.92);
    expect(f.scale).toBeLessThanOrEqual(0.96);
    expect(f.shade).toBeGreaterThanOrEqual(0.08);
    expect(f.shade).toBeLessThanOrEqual(0.2);
    // Het donkerder worden vervangt het oplichten of dimmen van nu.
    expect(f.dim).toBe(false);
  });

  it("de cover in een tegel zoomt duidelijker in dan voor de gate (1,06×), binnen een krimpende tegel (B1, B7)", () => {
    const f = pressFeedback("tile", false);
    expect(f.coverZoom).toBeGreaterThanOrEqual(1.1);
    expect(f.coverZoom).toBeLessThanOrEqual(1.2);
  });

  it.each(KINDS)("%s: in en terug samen rond 150 ms, elk deel zichtbaar lang (B6, B7, invariant 12)", (kind) => {
    const f = pressFeedback(kind, false);
    expect(f.inDuration).toBeGreaterThanOrEqual(50);
    expect(f.outDuration).toBeGreaterThanOrEqual(60);
    expect(f.inDuration + f.outDuration).toBeGreaterThanOrEqual(120);
    expect(f.inDuration + f.outDuration).toBeLessThanOrEqual(200);
  });

  it("Beperk beweging: geen schaal, geen zoom, geen duur; knoppen dimmen, tegels worden donkerder (invariant 11, F2)", () => {
    const button = pressFeedback("button", true);
    expect(button).toMatchObject({ scale: 1, coverZoom: 1, shade: 0, dim: true, inDuration: 0, outDuration: 0 });
    const tile = pressFeedback("tile", true);
    expect(tile).toMatchObject({ scale: 1, coverZoom: 1, dim: false, inDuration: 0, outDuration: 0 });
    // Dezelfde donkerte als zonder "Beperk beweging" (F4: één donkerte).
    expect(tile.shade).toBe(pressFeedback("tile", false).shade);
  });
});

describe("loslaten na een snelle tik (B6, besluit 5)", () => {
  it.each(KINDS)("%s: losgelaten vóór de eindstand: eerst door tot de eindstand, dan terug", (kind) => {
    const { inDuration, outDuration } = pressFeedback(kind, false);
    for (const held of range(0, inDuration, 5)) {
      const r = pressRelease(held, kind, false);
      // Het terugveren begint precies als de eindstand bereikt is.
      expect(held + r.delay).toBeCloseTo(inDuration, 6);
      expect(r.duration).toBe(outDuration);
    }
  });

  it.each(KINDS)("%s: een tik van 0 ms is even lang zichtbaar als in plus terug", (kind) => {
    const { inDuration, outDuration } = pressFeedback(kind, false);
    const r = pressRelease(0, kind, false);
    expect(r.delay + r.duration).toBe(inDuration + outDuration);
  });

  it.each(KINDS)("%s: langer ingedrukt: meteen terug bij loslaten, niet later", (kind) => {
    const { inDuration, outDuration } = pressFeedback(kind, false);
    for (const held of [inDuration, inDuration + 1, 300, 600, 5000]) {
      expect(pressRelease(held, kind, false)).toEqual({ delay: 0, duration: outDuration });
    }
  });

  it.each(KINDS)("%s: elke tik is minstens 120 ms zichtbaar, van indrukken tot terug", (kind) => {
    for (const held of range(0, 400, 10)) {
      const r = pressRelease(held, kind, false);
      expect(held + r.delay + r.duration).toBeGreaterThanOrEqual(120);
      expect(r.delay).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(KINDS)("%s: een klok die terugloopt (negatieve tijd) telt als een tik van 0 ms", (kind) => {
    expect(pressRelease(-30, kind, false)).toEqual(pressRelease(0, kind, false));
  });

  it.each(KINDS)("%s: Beperk beweging: meteen terug, zonder duur (invariant 11, F2)", (kind) => {
    for (const held of [-5, 0, 20, 500]) expect(pressRelease(held, kind, true)).toEqual({ delay: 0, duration: 0 });
  });
});

describe("verschijnen", () => {
  it("meldingen, tegels en rijen faden kort in (invarianten 8, 9, 12)", () => {
    const f = appearFeedback(false);
    expect(f.fromOpacity).toBeGreaterThanOrEqual(0);
    expect(f.fromOpacity).toBeLessThanOrEqual(0.5);
    expect(f.duration).toBeGreaterThanOrEqual(150);
    expect(f.duration).toBeLessThanOrEqual(250);
  });

  it("Beperk beweging: meteen volledig zichtbaar (invariant 11)", () => {
    expect(appearFeedback(true)).toEqual({ fromOpacity: 1, duration: 0 });
  });
});

// --- Wat er binnenkomt (invariant 9, D4) ---------------------------------------------
//
// `previous`: de ids die dit scherm al toonde (undefined = de lijst laadde nog).
// `next`: de ids nu (undefined = laadt). Een scherm dat opent met de gegevens
// er al, geeft die als `previous` mee: dan fadet er niets.

describe("newlyArrived", () => {
  it("de lijst laadt nog: niets", () => {
    expect(newlyArrived(undefined, undefined)).toEqual([]);
    expect(newlyArrived(["a"], undefined)).toEqual([]);
  });

  it("de gegevens komen binnen na het laden: alles", () => {
    expect(newlyArrived(undefined, ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("dezelfde gegevens opnieuw, of alleen gewijzigd: niets", () => {
    expect(newlyArrived(["a", "b"], ["a", "b"])).toEqual([]);
    expect(newlyArrived(["a", "b"], ["b", "a"])).toEqual([]);
  });

  it("een nieuw item via een live update: alleen dat item", () => {
    expect(newlyArrived(["a", "b"], ["a", "c", "b"])).toEqual(["c"]);
    expect(newlyArrived(["a"], ["d", "a", "e"])).toEqual(["d", "e"]);
  });

  it("een item dat weggaat: niets", () => {
    expect(newlyArrived(["a", "b"], ["b"])).toEqual([]);
  });

  it("een lege lijst die binnenkomt: niets", () => {
    expect(newlyArrived(undefined, [])).toEqual([]);
  });

  it("verandert de invoer niet", () => {
    const previous = ["a"];
    const next = ["a", "b"];
    newlyArrived(previous, next);
    expect(previous).toEqual(["a"]);
    expect(next).toEqual(["a", "b"]);
  });
});
