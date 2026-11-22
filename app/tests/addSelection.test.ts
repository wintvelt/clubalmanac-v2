import { describe, expect, it } from "vitest";
import {
  addGrid,
  addToSelection,
  removeFromSelection,
  selectionTiles,
  videoStatusText,
} from "../src/lib/addSelection";
import { albumBatch } from "../src/lib/upload";

// WP39 — de keuze op het toevoegscherm, als pure logica.
//   Besluit 3, invariant 1, A1, A2: "Meer toevoegen" vult aan; ontdubbelen op
//   `assetId`; een dubbel gekozen item blijft waar het stond. Zonder `assetId`
//   komt een item er altijd bij (gelijk aan `albumBatch`).
//   Invariant 3, A2, A3: de volgorde van de kiezer, foto's en filmpjes door
//   elkaar; nieuw achteraan; `pairedVideo` hoort er niet in.
//   Invariant 6, A7, besluit 5: namen per soort genummerd, "te lang" al vóór de
//   ronde, de duur van een te lang filmpje nooit "3:00".
//   A13: de stand van een filmpje op zijn tegel.
//   Besluit 4, A-antwoord 3, A8: het raster met de kolomregel van het album.
// Spec: docs/work-packages/WP39-toevoegscherm.md §Testcontract.

type Asset = { uri: string; assetId?: string | null; type?: "image" | "video" | "livePhoto" | "pairedVideo" | null; duration?: number | null };

const photo = (id: string | null, uri = `file:///ImagePicker/${id ?? "zonder"}.heic`): Asset => ({
  uri,
  assetId: id,
  type: "image",
});
const clip = (id: string | null, duration: number | null = 36_000, uri = `file:///ImagePicker/${id ?? "zonder"}.mov`): Asset => ({
  uri,
  assetId: id,
  type: "video",
  duration,
});

function ids(items: readonly { asset: Asset }[]): (string | null | undefined)[] {
  return items.map((i) => i.asset.assetId);
}

describe("addToSelection: een eerste keuze", () => {
  it("houdt de volgorde van de kiezer, foto's en filmpjes door elkaar (invariant 3)", () => {
    const { items } = addToSelection([], [photo("a"), clip("b"), photo("c"), clip("d")]);
    expect(ids(items)).toEqual(["a", "b", "c", "d"]);
    expect(items.map((i) => i.kind)).toEqual(["foto", "filmpje", "foto", "filmpje"]);
  });

  it("een filmpje is type video; image, livePhoto en geen type zijn foto's (A3)", () => {
    const { items } = addToSelection(
      [],
      [
        { uri: "file:///1.heic", assetId: "1", type: "image" },
        { uri: "file:///2.heic", assetId: "2", type: "livePhoto" },
        { uri: "file:///3.jpg", assetId: "3", type: null },
        { uri: "file:///4.jpg", assetId: "4" },
        { uri: "file:///5.mov", assetId: "5", type: "video", duration: 1000 },
      ],
    );
    expect(items.map((i) => i.kind)).toEqual(["foto", "foto", "foto", "foto", "filmpje"]);
  });

  it("een pairedVideo komt niet in de keuze en staat bij skipped (A3)", () => {
    const paired: Asset = { uri: "file:///p.mov", assetId: "p", type: "pairedVideo" };
    const { items, skipped } = addToSelection([], [photo("a"), paired]);
    expect(ids(items)).toEqual(["a"]);
    expect(skipped).toContain(paired);
  });

  it("geeft het item het asset zelf mee (de upload heeft uri, exif en duur nodig)", () => {
    const a = photo("a");
    const { items } = addToSelection([], [a]);
    expect(items[0]!.asset).toBe(a);
  });

  it("elk item een eigen sleutel, ook zonder assetId", () => {
    const { items } = addToSelection([], [photo(null, "file:///x1.jpg"), photo(null, "file:///x2.jpg"), photo("a"), clip("b")]);
    expect(new Set(items.map((i) => i.key)).size).toBe(4);
    for (const i of items) expect(typeof i.key === "string" && i.key.length > 0).toBe(true);
  });

  it("verandert de keuze die erin ging niet", () => {
    const first = addToSelection([], [photo("a")]).items;
    const copy = [...first];
    addToSelection(first, [photo("b")]);
    expect(first).toEqual(copy);
  });
});

describe("addToSelection: Meer toevoegen (besluit 3, invariant 1 en 3, A1, A2)", () => {
  it("nieuw komt achteraan, in de volgorde van de kiezer", () => {
    const first = addToSelection([], [photo("a"), clip("b")]).items;
    const { items } = addToSelection(first, [clip("c"), photo("d")]);
    expect(ids(items)).toEqual(["a", "b", "c", "d"]);
  });

  it("wat al gekozen is, komt er niet dubbel in", () => {
    const first = addToSelection([], [photo("a"), clip("b"), photo("c")]).items;
    const { items } = addToSelection(first, [photo("c"), clip("b"), photo("d")]);
    expect(ids(items)).toEqual(["a", "b", "c", "d"]);
  });

  it("een dubbel gekozen item houdt zijn plek, zijn sleutel en zijn asset (de eerste kopie)", () => {
    const first = addToSelection([], [photo("a"), clip("b", 36_000, "file:///oud.mov"), photo("c")]).items;
    const again = clip("b", 36_000, "file:///nieuw.mov");
    const { items, skipped } = addToSelection(first, [again, photo("d")]);
    expect(ids(items)).toEqual(["a", "b", "c", "d"]);
    expect(items[1]!.key).toBe(first[1]!.key);
    expect(items[1]!.asset.uri).toBe("file:///oud.mov");
    // De nieuwe kopie van de kiezer kan weg (B-besluit 3).
    expect(skipped).toContain(again);
  });

  it("de items die er al stonden houden hun sleutel; de nieuwe krijgen een sleutel die nog niet bestaat", () => {
    const first = addToSelection([], [photo("a"), photo(null, "file:///x.jpg")]).items;
    const { items } = addToSelection(first, [photo("b"), photo(null, "file:///y.jpg")]);
    expect(items.slice(0, 2).map((i) => i.key)).toEqual(first.map((i) => i.key));
    expect(new Set(items.map((i) => i.key)).size).toBe(4);
  });

  it("alles al gekozen: de keuze blijft gelijk, alles in skipped", () => {
    const first = addToSelection([], [photo("a"), clip("b")]).items;
    const picked = [clip("b"), photo("a")];
    const { items, skipped } = addToSelection(first, picked);
    expect(items.map((i) => i.key)).toEqual(first.map((i) => i.key));
    expect(skipped).toHaveLength(2);
  });

  it("zonder assetId komt een item er altijd bij, ook met dezelfde uri of naam (A1)", () => {
    const first = addToSelection([], [photo(null, "file:///zelfde.jpg")]).items;
    const { items, skipped } = addToSelection(first, [photo(null, "file:///zelfde.jpg")]);
    expect(items).toHaveLength(2);
    expect(skipped).toHaveLength(0);
  });

  it("een lege keuze uit de kiezer verandert niets", () => {
    const first = addToSelection([], [photo("a")]).items;
    const { items, skipped } = addToSelection(first, []);
    expect(items.map((i) => i.key)).toEqual(first.map((i) => i.key));
    expect(skipped).toHaveLength(0);
  });
});

describe("removeFromSelection (besluit 3, invariant 3)", () => {
  it("haalt precies dat item weg; de rest houdt volgorde en sleutel", () => {
    const first = addToSelection([], [photo("a"), clip("b"), photo("c"), clip("d")]).items;
    const after = removeFromSelection(first, first[1]!.key);
    expect(ids(after)).toEqual(["a", "c", "d"]);
    expect(after.map((i) => i.key)).toEqual([first[0]!.key, first[2]!.key, first[3]!.key]);
  });

  it("een onbekende sleutel verandert niets", () => {
    const first = addToSelection([], [photo("a")]).items;
    expect(removeFromSelection(first, "bestaat-niet").map((i) => i.key)).toEqual(first.map((i) => i.key));
  });

  it("het laatste item weg: een lege keuze (A6)", () => {
    const first = addToSelection([], [photo("a")]).items;
    expect(removeFromSelection(first, first[0]!.key)).toEqual([]);
  });

  it("weggehaald en opnieuw gekozen: achteraan, als nieuw item", () => {
    const first = addToSelection([], [photo("a"), photo("b"), photo("c")]).items;
    const without = removeFromSelection(first, first[0]!.key);
    const { items } = addToSelection(without, [photo("a")]);
    expect(ids(items)).toEqual(["b", "c", "a"]);
  });
});

describe("geen dubbele uploads na aanvullen en weghalen (invariant 1, A14)", () => {
  const album = "album-wp39";
  const batch = (items: readonly { key: string; asset: Asset }[]) =>
    new Map(
      albumBatch(
        items.map((i) => ({ key: i.key, assetId: i.asset.assetId })),
        album,
      ).map((b, n) => [items[n]!.asset.assetId, b.uploadId]),
    );

  it("na Meer toevoegen heeft elk item één upload-id, en een dubbel gekozen item dezelfde als eerst", () => {
    const first = addToSelection([], [photo("w1"), clip("w2")]).items;
    const before = batch(first);
    const { items } = addToSelection(first, [clip("w2"), photo("w3")]);
    const ids = albumBatch(
      items.map((i) => ({ key: i.key, assetId: i.asset.assetId })),
      album,
    ).map((b) => b.uploadId);
    expect(new Set(ids).size).toBe(3);
    expect(batch(items).get("w2")).toBe(before.get("w2"));
  });

  it("weggehaald en opnieuw gekozen: dezelfde upload-id voor hetzelfde album", () => {
    const first = addToSelection([], [photo("w4"), photo("w5")]).items;
    const before = batch(first).get("w4");
    const without = removeFromSelection(first, first[0]!.key);
    const back = addToSelection(without, [photo("w4")]).items;
    expect(batch(back).get("w4")).toBe(before);
  });
});

describe("selectionTiles: namen en markering (invariant 6, A7, besluit 2 en 5)", () => {
  it("per soort genummerd in de volgorde van de keuze", () => {
    const { items } = addToSelection([], [photo("a"), clip("b"), photo("c"), photo("d"), clip("e")]);
    const tiles = selectionTiles(items);
    expect(tiles.map((t) => [t.kind, t.number])).toEqual([
      ["foto", 1],
      ["filmpje", 1],
      ["foto", 2],
      ["foto", 3],
      ["filmpje", 2],
    ]);
    expect(tiles.map((t) => t.key)).toEqual(items.map((i) => i.key));
  });

  it("de naam van een foto en van een filmpje met duur", () => {
    const { items } = addToSelection([], [photo("a"), photo("b"), photo("c"), clip("v", 36_000)]);
    const tiles = selectionTiles(items);
    expect(tiles[2]!.label).toBe("Foto 3");
    expect(tiles[3]!.label).toBe("Filmpje 1, 0:36");
    expect(tiles[3]!.durationText).toBe("0:36");
    expect(tiles[0]!.durationText).toBeNull();
  });

  it("de × heeft een eigen naam", () => {
    const { items } = addToSelection([], [photo("a"), photo("b"), photo("c"), clip("v")]);
    const tiles = selectionTiles(items);
    expect(tiles[2]!.removeLabel).toBe("Haal foto 3 uit je keuze");
    expect(tiles[3]!.removeLabel).toBe("Haal filmpje 1 uit je keuze");
  });

  it("na weghalen schuiven de nummers op", () => {
    const first = addToSelection([], [photo("a"), photo("b"), photo("c")]).items;
    const tiles = selectionTiles(removeFromSelection(first, first[0]!.key));
    expect(tiles.map((t) => t.label)).toEqual(["Foto 1", "Foto 2"]);
  });

  it("te lang om te versturen: al vóór de ronde gemarkeerd, met 'te lang' in de naam (besluit 5)", () => {
    const { items } = addToSelection([], [clip("lang", 200_000)]);
    const [tile] = selectionTiles(items);
    expect(tile!.tooLong).toBe(true);
    expect(tile!.label).toBe("Filmpje 1, 3:20, te lang");
  });

  it("de grens is die van het versturen (videoTooLongToSend, 180,4 s)", () => {
    const { items } = addToSelection([], [clip("ok", 180_400), clip("net", 180_401)]);
    const tiles = selectionTiles(items);
    expect(tiles[0]!.tooLong).toBe(false);
    expect(tiles[0]!.label).toBe("Filmpje 1, 3:00");
    expect(tiles[1]!.tooLong).toBe(true);
  });

  it("een te lang filmpje toont nooit 3:00: de duur naar boven afgerond (A7)", () => {
    const { items } = addToSelection([], [clip("a", 180_401), clip("b", 180_450), clip("c", 180_999)]);
    for (const t of selectionTiles(items)) {
      expect(t.tooLong).toBe(true);
      expect(t.durationText).toBe("3:01");
      expect(t.label).toContain("3:01, te lang");
    }
  });

  it("zonder duur: alleen het nummer, niet te lang", () => {
    const { items } = addToSelection([], [clip("a", null), clip("b", 1000)]);
    const [tile] = selectionTiles(items);
    expect(tile!.durationText).toBeNull();
    expect(tile!.tooLong).toBe(false);
    expect(tile!.label).toBe("Filmpje 1");
  });

  it("een foto is nooit te lang", () => {
    const { items } = addToSelection([], [photo("a")]);
    expect(selectionTiles(items)[0]!.tooLong).toBe(false);
  });

  it("een lege keuze: geen tegels", () => {
    expect(selectionTiles([])).toEqual([]);
  });
});

describe("videoStatusText: de stand van een filmpje op zijn tegel (besluit 2, A13)", () => {
  it("wacht, klaar en mislukt", () => {
    expect(videoStatusText({ state: "wacht" })).toBe("Wacht");
    expect(videoStatusText({ state: "klaar" })).toBe("In het album");
    expect(videoStatusText({ state: "mislukt", reason: "netwerk" })).toBe("Niet gelukt");
  });

  it("bezig zonder voortgang of bij voorbereiden: Voorbereiden…", () => {
    expect(videoStatusText({ state: "bezig" })).toBe("Voorbereiden…");
    expect(videoStatusText({ state: "bezig", progress: { phase: "voorbereiden", progress: 0 } })).toBe("Voorbereiden…");
  });

  it("verkleinen en versturen met een afgerond percentage", () => {
    const shrink = videoStatusText({ state: "bezig", progress: { phase: "verkleinen", progress: 0.423 } });
    expect(shrink).toContain("Verkleinen");
    expect(shrink).toContain("42%");
    const send = videoStatusText({ state: "bezig", progress: { phase: "versturen", progress: 0.996 } });
    expect(send).toContain("Versturen");
    expect(send).toContain("100%");
  });

  it("het percentage blijft tussen 0 en 100", () => {
    expect(videoStatusText({ state: "bezig", progress: { phase: "versturen", progress: 1.7 } })).toContain("100%");
    expect(videoStatusText({ state: "bezig", progress: { phase: "verkleinen", progress: -0.2 } })).toContain("0%");
    expect(videoStatusText({ state: "bezig", progress: { phase: "verkleinen", progress: -0.2 } })).not.toContain("-");
  });

  it("afronden", () => {
    expect(videoStatusText({ state: "bezig", progress: { phase: "afronden", progress: 1 } })).toBe("Afronden…");
  });
});

describe("addGrid: het raster zoals in het album (besluit 4, A-antwoord 3, A8)", () => {
  it.each([
    [320, 3],
    [375, 3],
    [393, 3],
    [430, 3],
    [599, 3],
    [600, 4],
    [704, 4],
    [768, 4],
    [852, 4],
    [899, 4],
  ])("breedte %i: %i kolommen", (width, columns) => {
    expect(addGrid(width).columns).toBe(columns);
  });

  it("vierkante tegels met 2 pt ertussen, die samen in de breedte passen", () => {
    for (const width of [320, 393, 430, 704, 768, 852]) {
      const { columns, tile } = addGrid(width);
      expect(Number.isInteger(tile)).toBe(true);
      expect(columns * tile + 2 * (columns - 1)).toBeLessThanOrEqual(width);
      // Hooguit één pt per kolom over: de tegels vullen de breedte.
      expect(width - (columns * tile + 2 * (columns - 1))).toBeLessThan(columns);
    }
  });

  it("iPhone 15 Pro staand (393 pt): tegels van 129 pt, ruim genoeg voor een × van 44 pt", () => {
    expect(addGrid(393)).toEqual({ columns: 3, tile: 129 });
  });

  it("nog geen breedte gemeten (0): minstens één kolom, geen negatieve tegel", () => {
    const { columns, tile } = addGrid(0);
    expect(columns).toBeGreaterThanOrEqual(1);
    expect(tile).toBeGreaterThanOrEqual(0);
  });
});
