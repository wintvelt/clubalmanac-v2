import { describe, expect, it } from "vitest";
import {
  formatPhotoDate,
  keepNewMarkers,
  nextAfterRemoval,
  orientationOf,
  orientationTransform,
  photoDate,
  shouldMarkSeen,
  sortAlbumPhotos,
  swapsAspect,
} from "../src/lib/photos";

// WP17a, pure logica achter het albumscherm en het foto-detail.
// Spec: docs/work-packages/WP17a-fotos-bekijken.md §Spec-criticus aanvullingen
// (pariteit-checklist, invarianten 4, 11, 12, vraag 6). De schermen zelf test
// de gate; hier staat wat er getoond wordt en wanneer, niet hoe.

const at = (iso: string) => Date.parse(iso);

type Entry = {
  albumPhoto: { photoId: string; addedAt: number };
  photo: { _id: string; takenAt?: number; createdAt: number } | null;
  isNew: boolean;
};

function entry(id: string, opts: { takenAt?: number; createdAt: number; isNew?: boolean }): Entry {
  return {
    albumPhoto: { photoId: id, addedAt: opts.createdAt },
    photo: {
      _id: id,
      ...(opts.takenAt !== undefined ? { takenAt: opts.takenAt } : {}),
      createdAt: opts.createdAt,
    },
    isNew: opts.isNew ?? false,
  };
}

// --- Datum van een foto ---------------------------------------------------------

describe("photoDate: de datum van de foto, anders de upload", () => {
  it("takenAt als die er is", () => {
    expect(photoDate({ takenAt: 100, createdAt: 200 })).toBe(100);
  });

  it("zonder takenAt: createdAt", () => {
    expect(photoDate({ createdAt: 200 })).toBe(200);
  });
});

// Fix-cyclus 1, S3 (regie-besluit): de datum van een foto is de datum op de
// klok van de camera. `takenAt` komt uit exif-parser (en uit v1 als
// kalenderdag), die de kloktijd van de camera opslaat alsof het UTC is. De app
// rekent die dus niet om: de dag is de UTC-kalenderdag van `takenAt`. Zonder
// `takenAt` is `createdAt` de datum: een echt tijdstip, dus in Nederlandse
// tijd.
describe("formatPhotoDate: de datum van de foto, Nederlands, zonder tijd", () => {
  it("een gewone dag", () => {
    expect(formatPhotoDate({ takenAt: at("2023-03-12T10:00:00Z"), createdAt: 0 })).toBe(
      "12 maart 2023",
    );
  });

  it("takenAt: een avondfoto blijft op de dag van de camera, ook in de zomer", () => {
    // De camera zei 1 juli 22:30; geen omrekening naar 2 juli.
    expect(formatPhotoDate({ takenAt: at("2023-07-01T22:30:00Z"), createdAt: 0 })).toBe(
      "1 juli 2023",
    );
  });

  it("takenAt: oudjaarsavond 23:30 blijft 31 december", () => {
    expect(formatPhotoDate({ takenAt: at("2022-12-31T23:30:00Z"), createdAt: 0 })).toBe(
      "31 december 2022",
    );
  });

  it("takenAt uit v1 (kalenderdag, UTC-middernacht): die dag", () => {
    expect(formatPhotoDate({ takenAt: at("2019-05-04T00:00:00Z"), createdAt: 0 })).toBe(
      "4 mei 2019",
    );
  });

  it("takenAt wint van createdAt", () => {
    expect(
      formatPhotoDate({ takenAt: at("2020-02-02T12:00:00Z"), createdAt: at("2024-06-01T12:00:00Z") }),
    ).toBe("2 februari 2020");
  });

  it("zonder takenAt, zomertijd: createdAt 22:30 UTC is in Nederland al de volgende dag", () => {
    expect(formatPhotoDate({ createdAt: at("2023-07-01T22:30:00Z") })).toBe("2 juli 2023");
  });

  it("zonder takenAt, wintertijd: createdAt 23:30 UTC op oudjaar is in Nederland nieuwjaarsdag", () => {
    expect(formatPhotoDate({ createdAt: at("2022-12-31T23:30:00Z") })).toBe("1 januari 2023");
  });

  it("zonder takenAt, wintertijd: createdAt 22:30 UTC is in Nederland nog dezelfde dag", () => {
    expect(formatPhotoDate({ createdAt: at("2023-01-10T22:30:00Z") })).toBe("10 januari 2023");
  });
});

// --- Volgorde in het album --------------------------------------------------------

describe("sortAlbumPhotos: zoals v1, nieuwste foto eerst", () => {
  it("op de datum van de foto (takenAt, anders createdAt), nieuwste eerst", () => {
    const old = entry("a", { takenAt: at("2019-05-01T12:00:00Z"), createdAt: at("2024-01-01T00:00:00Z") });
    const mid = entry("b", { createdAt: at("2021-01-01T00:00:00Z") });
    const recent = entry("c", { takenAt: at("2023-05-01T12:00:00Z"), createdAt: at("2023-06-01T00:00:00Z") });
    expect(sortAlbumPhotos([old, mid, recent]).map((e) => e.albumPhoto.photoId)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("gelijke datum: nieuw eerst, dan op id (vaste volgorde)", () => {
    const d = at("2023-05-01T12:00:00Z");
    const list = [
      entry("z", { takenAt: d, createdAt: d }),
      entry("y", { takenAt: d, createdAt: d, isNew: true }),
      entry("x", { takenAt: d, createdAt: d }),
    ];
    expect(sortAlbumPhotos(list).map((e) => e.albumPhoto.photoId)).toEqual(["y", "x", "z"]);
  });

  it("een publicatie zonder foto-rij wordt niet getoond", () => {
    const gone: Entry = { albumPhoto: { photoId: "weg", addedAt: 1 }, photo: null, isNew: false };
    const ok = entry("ok", { createdAt: 5 });
    expect(sortAlbumPhotos([gone, ok]).map((e) => e.albumPhoto.photoId)).toEqual(["ok"]);
  });

  it("laat de invoer ongemoeid", () => {
    const list = [entry("a", { createdAt: 1 }), entry("b", { createdAt: 2 })];
    sortAlbumPhotos(list);
    expect(list.map((e) => e.albumPhoto.photoId)).toEqual(["a", "b"]);
  });
});

// --- Oriëntatie (invariant 4, WP8 §Frontend-contract) -------------------------------
//
// orientationOf(exifOrientation) geeft { rotate, mirror }: wat de app op de
// opgeslagen pixels toepast om de foto rechtop te tonen. Volgorde: eerst
// horizontaal spiegelen (als mirror), dan `rotate` graden met de klok mee.
//
// Oracle (ab-audit-workflow §Vorm 1): onafhankelijk afgeleid uit de
// EXIF-definitie, niet uit de tabel in convex/lib/exifOrientation.ts. Per tag
// zegt EXIF welke kant van het beeld de 0e rij en de 0e kolom van de
// opgeslagen pixels zijn. In schermcoördinaten (x naar rechts, y omlaag) gaat
// de bovenrand van de opslag (richting -y) naar de buitennormaal van die kant,
// en de linkerrand (richting -x) idem. De kolommen van de matrix die opslag
// naar beeld afbeeldt zijn dus: M·e_x = -n(kolom0), M·e_y = -n(rij0).

type Side = "top" | "bottom" | "left" | "right";
type Mat = [[number, number], [number, number]];

const NORMAL: Record<Side, [number, number]> = {
  top: [0, -1],
  bottom: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

// EXIF 2.3, tag 0x0112: [0e rij, 0e kolom] als zichtbare kant.
const EXIF_DEFINITION: Record<number, [Side, Side]> = {
  1: ["top", "left"],
  2: ["top", "right"],
  3: ["bottom", "right"],
  4: ["bottom", "left"],
  5: ["left", "top"],
  6: ["right", "top"],
  7: ["right", "bottom"],
  8: ["left", "bottom"],
};

function oracle(tag: number): Mat {
  const [row0, col0] = EXIF_DEFINITION[tag]!;
  const ex = NORMAL[col0].map((v) => -v) as [number, number];
  const ey = NORMAL[row0].map((v) => -v) as [number, number];
  return [
    [ex[0], ey[0]],
    [ex[1], ey[1]],
  ];
}

function mul(a: Mat, b: Mat): Mat {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]],
  ];
}

// Met de klok mee in schermcoördinaten (y omlaag): (1,0) → (0,1) bij 90°.
function rotation(deg: number): Mat {
  const r = (((deg % 360) + 360) % 360) / 90;
  const c = [1, 0, -1, 0][r]!;
  const s = [0, 1, 0, -1][r]!;
  return [
    [c, -s],
    [s, c],
  ];
}

const MIRROR: Mat = [
  [-1, 0],
  [0, 1],
];
const IDENTITY: Mat = [
  [1, 0],
  [0, 1],
];

function matrixOf(o: { rotate: number; mirror: boolean }): Mat {
  return mul(rotation(o.rotate), o.mirror ? MIRROR : IDENTITY);
}

// 0 + 0 = 0, ook als een berekening -0 oplevert.
const norm = (m: Mat): Mat => m.map((r) => r.map((v) => v + 0)) as Mat;

describe("orientationOf: tegen de EXIF-definitie (onafhankelijke oracle)", () => {
  it("sanity: de oracle geeft voor tag 6 een kwartslag met de klok mee", () => {
    expect(norm(oracle(6))).toEqual(norm(rotation(90)));
    expect(norm(oracle(1))).toEqual(IDENTITY);
  });

  for (const tag of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`tag ${tag}`, () => {
      const o = orientationOf(tag);
      expect([0, 90, 180, 270]).toContain(o.rotate);
      expect(typeof o.mirror).toBe("boolean");
      expect(norm(matrixOf(o))).toEqual(norm(oracle(tag)));
    });
  }

  it("de acht tags geven acht verschillende standen", () => {
    const keys = [1, 2, 3, 4, 5, 6, 7, 8].map((tag) => JSON.stringify(orientationOf(tag)));
    expect(new Set(keys).size).toBe(8);
  });

  it.each([undefined, 0, 9, -1, 1.5, Number.NaN])("geen of ongeldige waarde (%s): rechtop zoals opgeslagen", (v) => {
    expect(orientationOf(v)).toEqual({ rotate: 0, mirror: false });
  });
});

describe("swapsAspect: breedte en hoogte wisselen bij een kwartslag", () => {
  for (const tag of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`tag ${tag}`, () => {
      // Uit de oracle: buiten de diagonaal staat iets = een kwartslag.
      const swapped = oracle(tag)[0][0] === 0;
      expect(swapsAspect(tag)).toBe(swapped);
    });
  }

  it("geen waarde: niet gewisseld", () => {
    expect(swapsAspect(undefined)).toBe(false);
  });
});

// --- De transform die het beeld echt krijgt (fix-cyclus 1, S2) ----------------------
//
// orientationTransform(exif) is de `transform`-lijst voor React Native. De
// test leest die lijst zoals React Native hem toepast, en vergelijkt het
// resultaat met de EXIF-oracle hierboven. Zo valt een verwisseling van
// spiegelen en draaien in de lijst op (tags 5 en 7), ook als orientationOf
// zelf klopt.
//
// Hoe React Native de lijst toepast, uit de bron (react-native 0.88,
// ReactCommon/react/renderer): BaseViewProps::resolveTransform vermenigvuldigt
// per item `M = M * T_i`, en Transform::operator* rekent met rijvectoren
// (p' = p · M) zo dat het laatste item als eerste op het beeld werkt. Zoals
// in CSS. `rotate: "90deg"` draait met de klok mee op het scherm (y omlaag),
// `scaleX: -1` spiegelt horizontaal. Te zien in de simulator met een
// testbeeld per tag (gate).

type RNOp = { rotate?: string; scaleX?: number } & Record<string, unknown>;

function opMatrix(op: RNOp): Mat {
  const keys = Object.keys(op);
  expect(keys, `alleen rotate of scaleX per item: ${JSON.stringify(op)}`).toHaveLength(1);
  if (op.rotate !== undefined) {
    const m = /^(-?\d+)deg$/.exec(op.rotate);
    expect(m, `rotate in graden: ${op.rotate}`).not.toBeNull();
    return rotation(Number(m![1]));
  }
  if (op.scaleX !== undefined) {
    expect(op.scaleX === 1 || op.scaleX === -1).toBe(true);
    return op.scaleX === -1 ? MIRROR : IDENTITY;
  }
  throw new Error(`onverwacht item: ${JSON.stringify(op)}`);
}

// Het laatste item werkt als eerste: M = T0 · T1 · … · Tn (kolomvectoren).
function rnMatrix(ops: readonly RNOp[]): Mat {
  return ops.reduce<Mat>((m, op) => mul(m, opMatrix(op)), IDENTITY);
}

describe("orientationTransform: wat React Native op het beeld toepast", () => {
  it("sanity: de lezing van de lijst ziet het verschil tussen eerst spiegelen en eerst draaien", () => {
    const mirrorFirst = rnMatrix([{ rotate: "90deg" }, { scaleX: -1 }]);
    const rotateFirst = rnMatrix([{ scaleX: -1 }, { rotate: "90deg" }]);
    expect(norm(mirrorFirst)).toEqual(norm(oracle(7)));
    expect(norm(rotateFirst)).toEqual(norm(oracle(5)));
  });

  for (const tag of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`tag ${tag}: het beeld staat rechtop volgens de EXIF-definitie`, () => {
      const ops = orientationTransform(tag) as RNOp[];
      expect(norm(rnMatrix(ops))).toEqual(norm(oracle(tag)));
    });
  }

  it.each([undefined, 0, 9, 1.5])("geen of ongeldige waarde (%s): geen transform", (v) => {
    expect(norm(rnMatrix(orientationTransform(v) as RNOp[]))).toEqual(IDENTITY);
  });
});

// --- Markeringen blijven staan (invariant 12) ---------------------------------------

describe("keepNewMarkers: wat nieuw was, blijft gemarkeerd zolang het scherm open is", () => {
  const items = (news: string[], all: string[]) =>
    all.map((id) => ({ albumPhoto: { photoId: id }, isNew: news.includes(id) }));

  it("eerste lading: de nieuwe foto's", () => {
    expect([...keepNewMarkers(new Set(), items(["a"], ["a", "b"]))].sort()).toEqual(["a"]);
  });

  it("na markSeen is niets meer isNew, maar de markering blijft", () => {
    const first = keepNewMarkers(new Set(), items(["a", "b"], ["a", "b", "c"]));
    const afterSeen = keepNewMarkers(first, items([], ["a", "b", "c"]));
    expect([...afterSeen].sort()).toEqual(["a", "b"]);
  });

  it("een foto die erbij komt terwijl het scherm open is, krijgt ook een markering", () => {
    const first = keepNewMarkers(new Set(), items(["a"], ["a", "b"]));
    const later = keepNewMarkers(first, items(["d"], ["a", "b", "d"]));
    expect([...later].sort()).toEqual(["a", "d"]);
  });

  it("laat de vorige set ongemoeid", () => {
    const first = new Set(["a"]);
    keepNewMarkers(first, items(["b"], ["a", "b"]));
    expect([...first]).toEqual(["a"]);
  });
});

// --- Wanneer markSeen loopt (vraag 6, WP16 invariant 3) -------------------------------

describe("shouldMarkSeen", () => {
  const base = { inView: true, loaded: true, photoIds: ["a", "b"], markedIds: null };

  it("in beeld, geladen, met foto's, nog niet gemarkeerd: ja", () => {
    expect(shouldMarkSeen(base)).toBe(true);
  });

  it("laden telt niet als gezien", () => {
    expect(shouldMarkSeen({ ...base, loaded: false })).toBe(false);
  });

  it("niet in beeld (andere tab, achtergrond): nee", () => {
    expect(shouldMarkSeen({ ...base, inView: false })).toBe(false);
  });

  it("een leeg album: niets te zien, geen aanroep", () => {
    expect(shouldMarkSeen({ ...base, photoIds: [] })).toBe(false);
  });

  it("al gemarkeerd voor deze foto's: nee", () => {
    expect(shouldMarkSeen({ ...base, markedIds: new Set(["a", "b"]) })).toBe(false);
  });

  it("er kwam een foto bij terwijl het scherm in beeld is: opnieuw", () => {
    expect(shouldMarkSeen({ ...base, photoIds: ["a", "b", "c"], markedIds: new Set(["a", "b"]) })).toBe(true);
  });

  it("er verdween alleen een foto: nee", () => {
    expect(shouldMarkSeen({ ...base, photoIds: ["a"], markedIds: new Set(["a", "b"]) })).toBe(false);
  });
});

// --- Detail: de foto in beeld verdwijnt (edge case) -------------------------------------

describe("nextAfterRemoval: welke foto het detail toont als de huidige verdwijnt", () => {
  it("de huidige staat er nog: blijft", () => {
    expect(nextAfterRemoval(["a", "b", "c"], ["a", "b", "c"], "b")).toBe("b");
  });

  it("de huidige is weg: de volgende in de oude volgorde die er nog is", () => {
    expect(nextAfterRemoval(["a", "b", "c"], ["a", "c"], "b")).toBe("c");
  });

  it("de laatste is weg: de vorige", () => {
    expect(nextAfterRemoval(["a", "b", "c"], ["a", "b"], "c")).toBe("b");
  });

  it("de volgende is ook weg: de eerstvolgende die er nog is", () => {
    expect(nextAfterRemoval(["a", "b", "c", "d"], ["a", "d"], "b")).toBe("d");
  });

  it("niets meer over: null (terug naar het album)", () => {
    expect(nextAfterRemoval(["a"], [], "a")).toBeNull();
  });
});
