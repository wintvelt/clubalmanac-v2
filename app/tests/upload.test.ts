import { describe, expect, it } from "vitest";
import {
  UPLOAD_MAX_SIDE,
  applyOutcome,
  batchSummary,
  canRetry,
  fitWithin,
  newBatch,
  reasonText,
  retryBatch,
  startItem,
  uploadOutcome,
  type FailReason,
  type UploadItem,
} from "../src/lib/upload";

// WP18 — de pure logica achter "Foto's toevoegen".
//
// A-invariant 18 (invariant 1 en 2): per gekozen foto één upload-id, gelijk bij
// opnieuw proberen; een nieuwe keuze krijgt een nieuwe id. Na een ronde: hoeveel
// in het album, hoeveel mislukt, per reden met aantal. Opnieuw proberen stuurt
// alleen de mislukte foto's waar dat zin heeft. Na "limiet" start de app de
// wachtende foto's niet meer (invariant 7).
// A-keuze 1: een 200 van /upload met album betekent "in het album".
// A-keuze 3: de maat na omzetten, langste zijde hooguit 4032.
//
// Spec: docs/work-packages/WP18-foto-upload.md §Spec-criticus aanvullingen.

const ALL_REASONS: FailReason[] = [
  "netwerk",
  "bezig",
  "uitgelogd",
  "server",
  "limiet",
  "te_groot",
  "geen_foto",
  "geen_album",
];

const ok = (photoId: string) => ({ ok: true as const, photoId });
const fail = (reason: FailReason) => ({ ok: false as const, reason });

function byKey(items: UploadItem[], key: string): UploadItem {
  const item = items.find((i) => i.key === key);
  if (!item) throw new Error(`geen item ${key}`);
  return item;
}

describe("newBatch: één upload-id per gekozen foto", () => {
  it("elk item wacht, in de volgorde van de keuze, met een eigen niet-lege id", () => {
    const items = newBatch(["a", "b", "c"]);
    expect(items.map((i) => i.key)).toEqual(["a", "b", "c"]);
    expect(items.every((i) => i.state === "wacht")).toBe(true);
    for (const i of items) {
      expect(typeof i.uploadId).toBe("string");
      expect(i.uploadId.trim()).toBe(i.uploadId);
      expect(i.uploadId.length).toBeGreaterThan(0);
    }
    expect(new Set(items.map((i) => i.uploadId)).size).toBe(3);
  });

  it("een nieuwe ronde met dezelfde foto's krijgt nieuwe ids (een nieuwe keuze)", () => {
    const first = newBatch(["a", "b"]);
    const second = newBatch(["a", "b"]);
    const ids = new Set([...first, ...second].map((i) => i.uploadId));
    expect(ids.size).toBe(4);
  });

  it("geen botsing over veel rondes", () => {
    const ids = new Set<string>();
    for (let r = 0; r < 200; r++) for (const i of newBatch(["a", "b", "c", "d", "e"])) ids.add(i.uploadId);
    expect(ids.size).toBe(1000);
  });

  it("dezelfde foto twee keer in één keuze: twee items, twee ids", () => {
    const items = newBatch(["a", "a"]);
    expect(items).toHaveLength(2);
    expect(items[0]!.uploadId).not.toBe(items[1]!.uploadId);
  });
});

describe("uploadOutcome: het antwoord van /upload", () => {
  it("200 met een photoId: in het album", () => {
    expect(uploadOutcome(200, { photoId: "p1" })).toEqual(ok("p1"));
  });

  it("200 zonder bruikbaar photoId is geen succes", () => {
    for (const body of [null, {}, { photoId: "" }, { photoId: 7 }, "p1"]) {
      expect(uploadOutcome(200, body)).toEqual(fail("server"));
    }
  });

  it.each<[number | null, FailReason]>([
    [null, "netwerk"],
    [409, "bezig"],
    [401, "uitgelogd"],
    [403, "limiet"],
    [404, "geen_album"],
    [413, "te_groot"],
    [415, "geen_foto"],
    [400, "server"],
    [500, "server"],
    [502, "server"],
    [503, "server"],
  ])("status %s → %s", (status, reason) => {
    expect(uploadOutcome(status, { error: "x" })).toEqual(fail(reason));
  });
});

describe("canRetry: opnieuw proberen heeft alleen zin als het kan lukken", () => {
  it.each<[FailReason, boolean]>([
    ["netwerk", true],
    ["bezig", true],
    ["uitgelogd", true],
    ["server", true],
    ["limiet", false],
    ["te_groot", false],
    ["geen_foto", false],
    ["geen_album", false],
  ])("%s → %s", (reason, expected) => {
    expect(canRetry(reason)).toBe(expected);
  });
});

describe("applyOutcome en startItem", () => {
  it("startItem zet één item op bezig, de rest blijft", () => {
    const items = startItem(newBatch(["a", "b"]), "a");
    expect(byKey(items, "a").state).toBe("bezig");
    expect(byKey(items, "b").state).toBe("wacht");
  });

  it("succes: klaar met het photoId; mislukt: met de reden; de id blijft", () => {
    let items = newBatch(["a", "b"]);
    const ids = items.map((i) => i.uploadId);
    items = applyOutcome(startItem(items, "a"), "a", ok("p1"));
    items = applyOutcome(startItem(items, "b"), "b", fail("netwerk"));
    expect(byKey(items, "a")).toMatchObject({ state: "klaar", photoId: "p1" });
    expect(byKey(items, "b")).toMatchObject({ state: "mislukt", reason: "netwerk" });
    expect(items.map((i) => i.uploadId)).toEqual(ids);
  });

  it("de invoer verandert niet (puur)", () => {
    const items = newBatch(["a"]);
    const copy = structuredClone(items);
    applyOutcome(startItem(items, "a"), "a", ok("p1"));
    expect(items).toEqual(copy);
  });

  it("limiet: de wachtende foto's tellen als mislukt met dezelfde reden; klaar en bezig blijven", () => {
    let items = newBatch(["a", "b", "c", "d"]);
    items = applyOutcome(startItem(items, "a"), "a", ok("p1"));
    items = startItem(items, "c");
    items = applyOutcome(startItem(items, "b"), "b", fail("limiet"));
    expect(byKey(items, "a")).toMatchObject({ state: "klaar", photoId: "p1" });
    expect(byKey(items, "b")).toMatchObject({ state: "mislukt", reason: "limiet" });
    expect(byKey(items, "c").state).toBe("bezig");
    expect(byKey(items, "d")).toMatchObject({ state: "mislukt", reason: "limiet" });
  });

  it("een andere fout raakt de wachtende foto's niet", () => {
    let items = newBatch(["a", "b"]);
    items = applyOutcome(startItem(items, "a"), "a", fail("server"));
    expect(byKey(items, "b").state).toBe("wacht");
  });
});

describe("retryBatch: alleen de mislukte foto's waar het zin heeft, met dezelfde id", () => {
  function finished(): UploadItem[] {
    let items = newBatch(["a", "b", "c", "d", "e"]);
    items = applyOutcome(startItem(items, "a"), "a", ok("p1"));
    items = applyOutcome(startItem(items, "b"), "b", fail("netwerk"));
    items = applyOutcome(startItem(items, "c"), "c", fail("bezig"));
    items = applyOutcome(startItem(items, "d"), "d", fail("te_groot"));
    items = applyOutcome(startItem(items, "e"), "e", fail("server"));
    return items;
  }

  it("netwerk, bezig en server gaan terug naar wacht, met dezelfde upload-id", () => {
    const before = finished();
    const after = retryBatch(before);
    for (const key of ["b", "c", "e"]) {
      expect(byKey(after, key).state).toBe("wacht");
      expect(byKey(after, key).uploadId).toBe(byKey(before, key).uploadId);
      expect(byKey(after, key).reason).toBeUndefined();
    }
  });

  it("klaar blijft klaar; te groot blijft mislukt met zijn reden", () => {
    const after = retryBatch(finished());
    expect(byKey(after, "a")).toMatchObject({ state: "klaar", photoId: "p1" });
    expect(byKey(after, "d")).toMatchObject({ state: "mislukt", reason: "te_groot" });
  });

  it("na een limiet komt niets terug", () => {
    let items = newBatch(["a", "b"]);
    items = applyOutcome(startItem(items, "a"), "a", fail("limiet"));
    const after = retryBatch(items);
    expect(after.every((i) => i.state === "mislukt" && i.reason === "limiet")).toBe(true);
  });
});

describe("batchSummary: per foto weten wat er gebeurde (invariant 2)", () => {
  it("telt klaar, mislukt en open, en per reden met aantal", () => {
    let items = newBatch(["a", "b", "c", "d", "e"]);
    items = applyOutcome(startItem(items, "a"), "a", ok("p1"));
    items = applyOutcome(startItem(items, "b"), "b", fail("netwerk"));
    items = applyOutcome(startItem(items, "c"), "c", fail("netwerk"));
    items = applyOutcome(startItem(items, "d"), "d", fail("geen_foto"));
    const s = batchSummary(items);
    expect(s).toMatchObject({ total: 5, klaar: 1, mislukt: 3, open: 1, done: false, allInAlbum: false, retryable: 2 });
    expect(s.reasons).toHaveLength(2);
    expect(s.reasons).toEqual(
      expect.arrayContaining([
        { reason: "netwerk", count: 2 },
        { reason: "geen_foto", count: 1 },
      ]),
    );
  });

  it("klaar pas als niets meer wacht of bezig is", () => {
    let items = newBatch(["a", "b"]);
    items = applyOutcome(startItem(items, "a"), "a", ok("p1"));
    items = startItem(items, "b");
    expect(batchSummary(items).done).toBe(false);
    items = applyOutcome(items, "b", fail("server"));
    expect(batchSummary(items)).toMatchObject({ done: true, allInAlbum: false, retryable: 1 });
  });

  it("alles in het album", () => {
    let items = newBatch(["a", "b"]);
    items = applyOutcome(startItem(items, "a"), "a", ok("p1"));
    items = applyOutcome(startItem(items, "b"), "b", ok("p2"));
    expect(batchSummary(items)).toMatchObject({
      total: 2,
      klaar: 2,
      mislukt: 0,
      open: 0,
      done: true,
      allInAlbum: true,
      retryable: 0,
      reasons: [],
    });
  });

  it("een lege ronde is niet 'alles in het album'", () => {
    expect(batchSummary([])).toMatchObject({ total: 0, done: true, allInAlbum: false });
  });
});

describe("reasonText: elke reden in het NL", () => {
  it("niet leeg, per reden anders, zonder statuscode of Engelse foutterm", () => {
    const texts = ALL_REASONS.map(reasonText);
    expect(new Set(texts).size).toBe(ALL_REASONS.length);
    for (const text of texts) {
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\b\d{3}\b|error|failed|server error/i);
    }
  });

  it("de limiet en het album zijn herkenbaar", () => {
    expect(reasonText("limiet").toLowerCase()).toContain("limiet");
    expect(reasonText("geen_album").toLowerCase()).toContain("album");
  });
});

describe("fitWithin: de maat na omzetten (A-keuze 3)", () => {
  it("de grens is 4032", () => {
    expect(UPLOAD_MAX_SIDE).toBe(4032);
  });

  it.each([
    [4032, 3024, 4032, 3024],
    [3024, 4032, 3024, 4032],
    [8064, 6048, 4032, 3024],
    [6048, 8064, 3024, 4032],
    [5712, 4284, 4032, 3024],
    [1000, 500, 1000, 500],
    [5000, 3333, 4032, 2688],
    [10000, 1, 4032, 1],
  ])("%i×%i → %i×%i", (w, h, ew, eh) => {
    expect(fitWithin(w, h)).toEqual({ width: ew, height: eh });
  });

  it("nooit groter maken, altijd hele pixels binnen de grens", () => {
    for (const [w, h] of [
      [4033, 3025],
      [7, 9],
      [12345, 6789],
      [4032, 4032],
      [9000, 9000],
    ] as const) {
      const r = fitWithin(w, h);
      expect(Number.isInteger(r.width) && Number.isInteger(r.height)).toBe(true);
      expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(Math.min(UPLOAD_MAX_SIDE, Math.max(w, h)));
      expect(r.width).toBeLessThanOrEqual(w);
      expect(r.height).toBeLessThanOrEqual(h);
      expect(r.width).toBeGreaterThanOrEqual(1);
      expect(r.height).toBeGreaterThanOrEqual(1);
    }
  });
});
