import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as uploadLib from "../src/lib/upload";
import { parse } from "./support/sourceScan";
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

// ── Fix-cyclus 1 (spec §Fix-cyclus 1) ─────────────────────────────────────

type ProfileRetry = { step: "upload"; uploadId: string } | { step: "opslaan"; photoId: string } | null;
const fixLib = uploadLib as unknown as {
  UPLOAD_TIMEOUT_MS?: number;
  profileRetry?: (item: UploadItem) => ProfileRetry;
};

describe("invariant 20: de termijn van een upload", () => {
  it("UPLOAD_TIMEOUT_MS is 120 s (ruim: niet korter dan 60 s, niet langer dan 180 s)", () => {
    expect(fixLib.UPLOAD_TIMEOUT_MS).toBe(120_000);
  });
});

describe("invariant 21: profielfoto opnieuw proberen (profileRetry)", () => {
  const retry = (item: UploadItem) => {
    expect(typeof fixLib.profileRetry, "profileRetry ontbreekt in src/lib/upload.ts").toBe("function");
    return fixLib.profileRetry!(item);
  };
  const failedWith = (reason: FailReason) => {
    const [item] = newBatch(["profiel"]);
    return applyOutcome(startItem([item!], "profiel"), "profiel", fail(reason))[0]!;
  };

  it.each<FailReason>(["netwerk", "bezig", "uitgelogd", "server"])(
    "na %s: de upload opnieuw, met dezelfde upload-id",
    (reason) => {
      const item = failedWith(reason);
      expect(retry(item)).toEqual({ step: "upload", uploadId: item.uploadId });
    },
  );

  it.each<FailReason>(["limiet", "te_groot", "geen_foto", "geen_album"])(
    "na %s: niets (een andere foto kiezen is een nieuwe keuze)",
    (reason) => {
      expect(retry(failedWith(reason))).toBeNull();
    },
  );

  it("upload gelukt, opslaan als profielfoto mislukt: alleen het opslaan, met de foto die er is", () => {
    const [item] = newBatch(["profiel"]);
    const uploaded = applyOutcome(startItem([item!], "profiel"), "profiel", ok("p9"))[0]!;
    expect(retry(uploaded)).toEqual({ step: "opslaan", photoId: "p9" });
  });

  it("zolang de upload wacht of loopt: niets", () => {
    const [item] = newBatch(["profiel"]);
    expect(retry(item!)).toBeNull();
    expect(retry(startItem([item!], "profiel")[0]!)).toBeNull();
  });

  it("Profiel gebruikt profileRetry (bronscan)", () => {
    const file = new URL("../src/screens/ProfileScreen.tsx", import.meta.url);
    const sf = parse(readFileSync(file, "utf8"), "ProfileScreen.tsx");
    let calls = 0;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "profileRetry") calls++;
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(calls, "ProfileScreen.tsx roept profileRetry niet aan").toBeGreaterThan(0);
  });
});

// ── Fix-cyclus 2 (spec §Fix-cyclus 2) ─────────────────────────────────────
//
// A-invariant 25 (red-team Z3): dezelfde foto (de `assetId` van de kiezer) in
// hetzelfde album krijgt binnen een app-sessie dezelfde upload-id, ook in een
// nieuwe ronde. Kwam hij na "Geen verbinding" toch binnen, dan geeft de backend
// hem terug in plaats van een tweede foto te maken. Ander album of geen
// assetId: een nieuwe id. Binnen één ronde: elke foto een eigen id.
//
// Het geheugen hoort bij de module (een app-sessie). Elke test gebruikt eigen
// assetIds, zodat de tests elkaar niet raken.

type Pick = { key: string; assetId?: string | null };
const fix2Lib = uploadLib as unknown as {
  albumBatch?: (picks: readonly Pick[], albumId: string) => UploadItem[];
};

describe("A-invariant 25: dezelfde foto, hetzelfde album, dezelfde upload-id (albumBatch)", () => {
  const batch = (picks: readonly Pick[], albumId: string) => {
    expect(typeof fix2Lib.albumBatch, "albumBatch ontbreekt in src/lib/upload.ts").toBe("function");
    return fix2Lib.albumBatch!(picks, albumId);
  };
  const idOf = (items: UploadItem[], key: string) => byKey(items, key).uploadId;

  it("elke gekozen foto wacht, met zijn sleutel, in volgorde", () => {
    const items = batch(
      [
        { key: "1-0", assetId: "t1-a" },
        { key: "1-1", assetId: "t1-b" },
      ],
      "album-1",
    );
    expect(items.map((i) => [i.key, i.state])).toEqual([
      ["1-0", "wacht"],
      ["1-1", "wacht"],
    ]);
    for (const i of items) expect(i.uploadId.length).toBeGreaterThan(0);
  });

  it("een nieuwe ronde met dezelfde foto voor hetzelfde album: dezelfde id", () => {
    const first = batch([{ key: "1-0", assetId: "t2-a" }], "album-1");
    const second = batch(
      [
        { key: "2-0", assetId: "t2-b" },
        { key: "2-1", assetId: "t2-a" },
      ],
      "album-1",
    );
    expect(idOf(second, "2-1")).toBe(idOf(first, "1-0"));
    expect(idOf(second, "2-0")).not.toBe(idOf(first, "1-0"));
  });

  it("ook na een mislukte en na een gelukte ronde (de uitkomst maakt niet uit)", () => {
    const first = batch([{ key: "1-0", assetId: "t3-a" }, { key: "1-1", assetId: "t3-b" }], "album-1");
    let done = applyOutcome(startItem(first, "1-0"), "1-0", fail("netwerk"));
    done = applyOutcome(startItem(done, "1-1"), "1-1", ok("p1"));
    const second = batch([{ key: "2-0", assetId: "t3-a" }, { key: "2-1", assetId: "t3-b" }], "album-1");
    expect(idOf(second, "2-0")).toBe(byKey(done, "1-0").uploadId);
    expect(idOf(second, "2-1")).toBe(byKey(done, "1-1").uploadId);
  });

  it("dezelfde foto voor een ander album: een andere id", () => {
    const a = batch([{ key: "1-0", assetId: "t4-a" }], "album-1");
    const b = batch([{ key: "2-0", assetId: "t4-a" }], "album-2");
    expect(idOf(b, "2-0")).not.toBe(idOf(a, "1-0"));
    // En terug naar het eerste album: weer de eerste id.
    const c = batch([{ key: "3-0", assetId: "t4-a" }], "album-1");
    expect(idOf(c, "3-0")).toBe(idOf(a, "1-0"));
  });

  it.each<[string, string | null | undefined]>([
    ["null", null],
    ["ontbreekt", undefined],
    ["leeg", ""],
  ])("zonder assetId (%s): elke ronde een nieuwe id", (_label, assetId) => {
    const pick = (key: string): Pick => (assetId === undefined ? { key } : { key, assetId });
    const a = batch([pick("1-0")], "album-1");
    const b = batch([pick("2-0")], "album-1");
    expect(idOf(b, "2-0")).not.toBe(idOf(a, "1-0"));
  });

  it("binnen één ronde heeft elke foto een eigen id, ook bij dezelfde assetId", () => {
    const items = batch(
      [
        { key: "1-0", assetId: "t6-a" },
        { key: "1-1", assetId: "t6-a" },
        { key: "1-2", assetId: null },
        { key: "1-3" },
      ],
      "album-1",
    );
    expect(new Set(items.map((i) => i.uploadId)).size).toBe(4);
  });

  it("andere foto's in hetzelfde album: andere ids", () => {
    const items = batch(
      Array.from({ length: 20 }, (_, n) => ({ key: `1-${n}`, assetId: `t7-${n}` })),
      "album-1",
    );
    expect(new Set(items.map((i) => i.uploadId)).size).toBe(20);
  });

  it("newBatch (de profielfoto) blijft elke keer nieuwe ids geven", () => {
    expect(newBatch(["profiel"])[0]!.uploadId).not.toBe(newBatch(["profiel"])[0]!.uploadId);
  });

  it("AddPhotosScreen maakt een ronde met albumBatch, met de assetId, en niet met newBatch (bronscan)", () => {
    const file = new URL("../src/screens/AddPhotosScreen.tsx", import.meta.url);
    const sf = parse(readFileSync(file, "utf8"), "AddPhotosScreen.tsx");
    const calls = new Map<string, number>();
    let assetIdUsed = 0;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        calls.set(node.expression.text, (calls.get(node.expression.text) ?? 0) + 1);
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === "assetId") assetIdUsed++;
      if (ts.isShorthandPropertyAssignment(node) && node.name.text === "assetId") assetIdUsed++;
      if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && node.name.text === "assetId") assetIdUsed++;
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(calls.get("albumBatch") ?? 0, "AddPhotosScreen.tsx roept albumBatch niet aan").toBeGreaterThan(0);
    expect(calls.get("newBatch") ?? 0, "AddPhotosScreen.tsx roept nog newBatch aan").toBe(0);
    expect(assetIdUsed, "AddPhotosScreen.tsx geeft de assetId van de kiezer niet mee").toBeGreaterThan(0);
  });
});
