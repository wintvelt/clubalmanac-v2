import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFiles } from "./support/sourceScan";

// WP46: het foto-detail schermvullend, als pure logica.
//   A1, besluit A5: wie mag schermvullend. De iPhone en Android (ook een
//   Android-tablet), niet de iPad (ook niet in een smal venster) en niet het
//   web.
//   A2: de standen. Rechtop normaal of schermvullend; liggend zonder of met
//   kop. Wat er per stand te zien is: kop, infoblok, tabbalk, statusbalk,
//   zwart.
//   A5: draaien. Naar liggend zonder kop; terug naar rechtop de stand van
//   daarvoor; 180° liggend verandert niets.
//   A6: een enkele tik op een foto wacht op een eventuele dubbeltik waar die
//   zoomt; waar niets zoomt (Android) wisselt hij meteen.
//   A12, besluit 7: een tik op een filmpje verandert de stand nooit; de
//   native speler doet zelf wat hij doet.
//   A14, besluit A7: met een schermlezer blijft rechtop normaal en staat
//   liggend de kop er altijd.
// Spec: docs/work-packages/WP46-foto-detail-schermvullend.md §Testcontract.
//
// De module bestaat nog niet. Hij wordt hier los geladen, zodat elke test op
// zijn eigen `expect` rood is en niet het hele bestand op de import.

type Lib = typeof import("../src/lib/photoDetailStand");

const LIB_PATH = "../src/lib/photoDetailStand";
const lib: Partial<Lib> = await import(/* @vite-ignore */ LIB_PATH).catch(() => ({}));

function need<K extends keyof Lib>(name: K): Lib[K] {
  expect(lib[name], `${String(name)} ontbreekt in src/lib/photoDetailStand.ts`).toBeDefined();
  return lib[name] as Lib[K];
}

type Orientation = "portrait" | "landscape";
type Event = { type: "tap" } | { type: "rotate"; orientation: Orientation };

const PHONE = { fullscreenAllowed: true, screenReader: false } as const;

// Van de beginstand, via een rij gebeurtenissen, naar wat er te zien is.
function after(start: Orientation, events: Event[], ctx: { fullscreenAllowed: boolean; screenReader: boolean } = PHONE) {
  const initialStand = need("initialStand");
  const nextStand = need("nextStand");
  const standView = need("standView");
  let stand = initialStand(start);
  for (const e of events) stand = nextStand(stand, e);
  return standView(stand, ctx);
}

const tap: Event = { type: "tap" };
const toLandscape: Event = { type: "rotate", orientation: "landscape" };
const toPortrait: Event = { type: "rotate", orientation: "portrait" };

const NORMAL = { header: true, info: true, tabBar: true, statusBar: true, black: false };
const FULL = { header: false, info: false, tabBar: false, statusBar: false, black: true };
const FULL_WITH_HEADER = { header: true, info: false, tabBar: false, statusBar: false, black: true };

describe("fullscreenAllowed: wie mag schermvullend (A1, besluit A5)", () => {
  it("de iPhone wel", () => {
    expect(need("fullscreenAllowed")({ os: "ios", isPad: false })).toBe(true);
  });

  it("de iPad niet (besluit 1)", () => {
    expect(need("fullscreenAllowed")({ os: "ios", isPad: true })).toBe(false);
  });

  it("Android wel, ook een tablet (besluit A5: Android heeft geen tablet-indeling)", () => {
    expect(need("fullscreenAllowed")({ os: "android", isPad: false })).toBe(true);
  });

  it("het web niet (besluit 6)", () => {
    expect(need("fullscreenAllowed")({ os: "web", isPad: false })).toBe(false);
  });
});

describe("orientationOf: rechtop of liggend volgt het venster", () => {
  it("hoger dan breed: rechtop", () => {
    expect(need("orientationOf")({ width: 393, height: 852 })).toBe("portrait");
  });

  it("breder dan hoog: liggend", () => {
    expect(need("orientationOf")({ width: 852, height: 393 })).toBe("landscape");
  });

  it("vierkant: rechtop", () => {
    expect(need("orientationOf")({ width: 600, height: 600 })).toBe("portrait");
  });
});

describe("standView: rechtop (A2)", () => {
  it("het detail opent normaal: kop, infoblok, tabbalk, statusbalk, gewone achtergrond", () => {
    expect(after("portrait", [])).toEqual(NORMAL);
  });

  it("een tik: schermvullend, alleen de foto op zwart", () => {
    expect(after("portrait", [tap])).toEqual(FULL);
  });

  it("nog een tik: terug naar normaal", () => {
    expect(after("portrait", [tap, tap])).toEqual(NORMAL);
  });

  it("drie tikken: schermvullend", () => {
    expect(after("portrait", [tap, tap, tap])).toEqual(FULL);
  });
});

describe("standView: liggend (A2, besluit 5)", () => {
  it("het detail opent liggend: schermvullend zonder kop", () => {
    expect(after("landscape", [])).toEqual(FULL);
  });

  it("een tik: de kop met terug en Acties, verder niets; zwart blijft", () => {
    expect(after("landscape", [tap])).toEqual(FULL_WITH_HEADER);
  });

  it("nog een tik: de kop weer weg", () => {
    expect(after("landscape", [tap, tap])).toEqual(FULL);
  });

  it("nooit een infoblok, een tabbalk of een statusbalk, hoe vaak je ook tikt", () => {
    for (let n = 0; n <= 4; n += 1) {
      const view = after("landscape", Array.from({ length: n }, () => tap));
      expect(view.info, `${n} tikken`).toBe(false);
      expect(view.tabBar, `${n} tikken`).toBe(false);
      expect(view.statusBar, `${n} tikken`).toBe(false);
      expect(view.black, `${n} tikken`).toBe(true);
    }
  });
});

describe("nextStand: draaien (A5)", () => {
  it("rechtop normaal naar liggend: zonder kop", () => {
    expect(after("portrait", [toLandscape])).toEqual(FULL);
  });

  it("rechtop schermvullend naar liggend: zonder kop", () => {
    expect(after("portrait", [tap, toLandscape])).toEqual(FULL);
  });

  it("terug naar rechtop: normaal, als het rechtop normaal was", () => {
    expect(after("portrait", [toLandscape, toPortrait])).toEqual(NORMAL);
  });

  it("terug naar rechtop: schermvullend, als het rechtop schermvullend was", () => {
    expect(after("portrait", [tap, toLandscape, toPortrait])).toEqual(FULL);
  });

  it("tikken liggend verandert niet wat rechtop terugkomt", () => {
    expect(after("portrait", [toLandscape, tap, toPortrait])).toEqual(NORMAL);
    expect(after("portrait", [tap, toLandscape, tap, tap, tap, toPortrait])).toEqual(FULL);
  });

  it("liggend met kop naar rechtop en terug naar liggend: weer zonder kop", () => {
    expect(after("portrait", [toLandscape, tap, toPortrait, toLandscape])).toEqual(FULL);
  });

  it("liggend begonnen en naar rechtop: normaal", () => {
    expect(after("landscape", [toPortrait])).toEqual(NORMAL);
    expect(after("landscape", [tap, toPortrait])).toEqual(NORMAL);
  });

  it("180° liggend (opnieuw liggend): de kop blijft zoals hij was", () => {
    expect(after("landscape", [tap, toLandscape])).toEqual(FULL_WITH_HEADER);
    expect(after("landscape", [toLandscape])).toEqual(FULL);
  });

  it("opnieuw rechtop zonder te draaien: de stand blijft", () => {
    expect(after("portrait", [tap, toPortrait])).toEqual(FULL);
    expect(after("portrait", [toPortrait])).toEqual(NORMAL);
  });

  it("de stand is een waarde: nextStand verandert de vorige stand niet", () => {
    const initialStand = need("initialStand");
    const nextStand = need("nextStand");
    const standView = need("standView");
    const start = initialStand("portrait");
    nextStand(start, tap);
    nextStand(start, toLandscape);
    expect(standView(start, PHONE)).toEqual(NORMAL);
  });
});

describe("standView: iPad en web, niets veranderd (A1, besluiten 1 en 6)", () => {
  const unchanged = { fullscreenAllowed: false, screenReader: false };
  const paths: Array<[Orientation, Event[]]> = [
    ["portrait", []],
    ["portrait", [tap]],
    ["portrait", [tap, toLandscape]],
    ["landscape", []],
    ["landscape", [tap]],
    ["landscape", [tap, tap, toPortrait, tap]],
  ];

  it.each(paths)("begin %s, %j: kop, infoblok, tabbalk, statusbalk, geen zwart", (start, events) => {
    expect(after(start, events, unchanged)).toEqual(NORMAL);
  });
});

describe("standView: met een schermlezer (A14, besluit A7)", () => {
  const reader = { fullscreenAllowed: true, screenReader: true };

  it("rechtop blijft normaal, ook na een tik", () => {
    expect(after("portrait", [], reader)).toEqual(NORMAL);
    expect(after("portrait", [tap], reader)).toEqual(NORMAL);
  });

  it("liggend staat de kop er altijd", () => {
    expect(after("landscape", [], reader)).toEqual(FULL_WITH_HEADER);
    expect(after("landscape", [tap], reader)).toEqual(FULL_WITH_HEADER);
    expect(after("portrait", [toLandscape], reader)).toEqual(FULL_WITH_HEADER);
  });

  it("op de iPad gaat iPad voor: niets veranderd", () => {
    expect(after("landscape", [], { fullscreenAllowed: false, screenReader: true })).toEqual(NORMAL);
  });
});

describe("tapIntent: tik of dubbeltik op een foto (A6)", () => {
  it("DOUBLE_TAP_MS: een dubbeltik is te halen, de enkele tik voelt nog direct", () => {
    const ms = need("DOUBLE_TAP_MS");
    expect(ms).toBeGreaterThanOrEqual(200);
    expect(ms).toBeLessThanOrEqual(300);
  });

  it("de eerste tik op een foto die zoomt: wachten", () => {
    expect(need("tapIntent")({ lastTapAt: null, now: 1000, target: "zoomable" })).toBe("wait");
  });

  it("een tweede tik binnen de tijd: zoomen, de stand wisselt niet", () => {
    const ms = need("DOUBLE_TAP_MS");
    expect(need("tapIntent")({ lastTapAt: 1000, now: 1000 + ms - 1, target: "zoomable" })).toBe("zoom");
    expect(need("tapIntent")({ lastTapAt: 1000, now: 1001, target: "zoomable" })).toBe("zoom");
  });

  it("een tweede tik na de tijd telt als een nieuwe eerste tik", () => {
    const ms = need("DOUBLE_TAP_MS");
    expect(need("tapIntent")({ lastTapAt: 1000, now: 1000 + ms + 1, target: "zoomable" })).toBe("wait");
  });

  it("een foto die niet zoomt (Android): meteen de stand", () => {
    expect(need("tapIntent")({ lastTapAt: null, now: 1000, target: "photo" })).toBe("stand");
    expect(need("tapIntent")({ lastTapAt: 990, now: 1000, target: "photo" })).toBe("stand");
  });
});

describe("tapIntent: een tik op een filmpje (A12, besluit 7)", () => {
  it("verandert de stand niet: geen wisselen, geen wachten, geen zoom", () => {
    expect(need("tapIntent")({ lastTapAt: null, now: 1000, target: "video" })).toBe("none");
  });

  it("ook niet als tweede tik vlak na een tik op een foto (vegen naar een filmpje)", () => {
    expect(need("tapIntent")({ lastTapAt: 990, now: 1000, target: "video" })).toBe("none");
  });
});

describe("bronscan: de app gebruikt de logica (testcontract)", () => {
  const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");
  const outsideLib = listFiles(SRC)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("lib/"))
    .map((f) => ({ f, text: readFileSync(join(SRC, f), "utf8") }));

  it.each(["nextStand", "standView", "fullscreenAllowed"])("%s( wordt buiten src/lib aangeroepen", (name) => {
    const hits = outsideLib.filter(({ text }) => new RegExp(`\\b${name}\\(`).test(text)).map(({ f }) => f);
    expect(hits, `geen aanroep van ${name}( in de app-code`).not.toEqual([]);
  });
});
