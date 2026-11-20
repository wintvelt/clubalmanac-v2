import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { albumBatch, canRetry, reasonText, type FailReason } from "../src/lib/upload";
import {
  WEB_MAX_PIXELS,
  isSafeToSend,
  profileSquare,
  tooManyPixels,
  webAssetId,
  webMetadataHeaders,
  webPickProblem,
} from "../src/lib/webPhoto";
import { dms, exifJpeg, plainJpeg, tiff, xmpJpeg } from "./support/exifJpeg";

// WP36: de pure logica achter uploaden in de browser (nieuwe module
// src/lib/webPhoto.ts). Spec: docs/work-packages/WP36-webapp-uploaden.md
// §Spec-criticus aanvullingen, A-invariant U3–U8.
//
// - U3: datum en plaats uit de EXIF van het gekozen bestand, als dezelfde
//   headers als de iPhone-app (`X-Taken-At` in EXIF-vorm, `X-Latitude` en
//   `X-Longitude` in decimale graden). Opnamedatum zoals de backend hem uit een
//   bestand leest: `DateTimeOriginal`, anders `CreateDate`; nooit de
//   wijzigingsdatum. Geen datum: geen header (niet "vandaag"). GPS 0/0 is wat
//   de fotokiezer van Android achterlaat als hij de plaats weghaalt: geen
//   plaats.
// - U4: wat de browser verstuurt, draagt nergens GPS (fail-closed controle
//   vóór het versturen).
// - U5: per bestand een reden, vóór het decoderen. Geen beeld, een vector
//   (SVG) of een leeg bestand: "geen foto". Een beeld dat de browser niet kan
//   lezen (HEIC in Chrome): de nieuwe reden "formaat", zonder opnieuw proberen.
// - U6: een grens op het aantal pixels, zodat één reuzenfoto de pagina niet
//   laat vastlopen; 50 MP moet kunnen.
// - U7: een vaste id per foto op het web, uit de inhoud (niet uit de naam of
//   de wijzigingsdatum, die Android per keuze anders kan geven), zodat
//   "Meer foto's" met dezelfde foto geen tweede foto maakt (WP18 A-invariant 25).
// - U8 (advies vraag 8, besluit Wouter): de profielfoto wordt in de browser
//   een vierkant uit het midden, zoals het bijsnijden op de iPhone.

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../tests/fixtures/wp36/${name}`, import.meta.url))),
  );

// exif-parser (de lezer van de backend, uit de root) als controle op de hulp.
type ExifParserModule = { create(b: Buffer): { parse(): { tags: Record<string, number> } } };
const ExifParser = createRequire(import.meta.url)("exif-parser") as ExifParserModule;

const deg = (h: Record<string, string>, key: string) => Number(h[key]);

describe("controle: de hulp bouwt EXIF zoals een camera (exif-parser leest hem)", () => {
  it.each([false, true])("bigEndian %s", (bigEndian) => {
    const bytes = exifJpeg({
      bigEndian,
      dateTimeOriginal: "2024:07:14 15:30:00",
      gps: { latRef: "S", lat: dms(33, 51, 2448), lonRef: "W", lon: dms(70, 40, 1200) },
    });
    const tags = ExifParser.create(Buffer.from(bytes)).parse().tags;
    expect(tags.DateTimeOriginal).toBe(Date.UTC(2024, 6, 14, 15, 30, 0) / 1000);
    expect(tags.GPSLatitude).toBeCloseTo(-33.8568, 4);
    expect(tags.GPSLongitude).toBeCloseTo(-70.6700, 4);
  });
});

describe("U3 — datum en plaats uit de EXIF, als de headers van de iPhone-app", () => {
  it("foto met datum en GPS (noord, oost)", () => {
    const h = webMetadataHeaders(fixture("staand-6.jpg"));
    expect(h["X-Taken-At"]).toBe("2024:07:14 15:30:00");
    expect(deg(h, "X-Latitude")).toBeCloseTo(52.0907, 5);
    expect(deg(h, "X-Longitude")).toBeCloseTo(5.1214, 5);
  });

  it("zuid en west worden negatief", () => {
    const h = webMetadataHeaders(fixture("omgekeerd-3.jpg"));
    expect(h["X-Taken-At"]).toBe("2023:12:31 23:59:59");
    expect(deg(h, "X-Latitude")).toBeCloseTo(-22.9519, 5);
    expect(deg(h, "X-Longitude")).toBeCloseTo(-43.2105, 5);
  });

  it("big-endian (MM) en little-endian (II) geven hetzelfde", () => {
    const spec = {
      dateTimeOriginal: "2021:03:04 05:06:07",
      gps: { latRef: "N", lat: dms(48, 51, 2952), lonRef: "E", lon: dms(2, 17, 4020) },
    };
    const le = webMetadataHeaders(exifJpeg(spec));
    const be = webMetadataHeaders(exifJpeg({ ...spec, bigEndian: true }));
    expect(be).toEqual(le);
    expect(le["X-Taken-At"]).toBe("2021:03:04 05:06:07");
    expect(deg(le, "X-Latitude")).toBeCloseTo(48 + 51 / 60 + 29.52 / 3600, 6);
    expect(deg(le, "X-Longitude")).toBeCloseTo(2 + 17 / 60 + 40.2 / 3600, 6);
  });

  it("alleen CreateDate (Android): die is de opnamedatum", () => {
    const h = webMetadataHeaders(fixture("staand-8.jpg"));
    expect(h["X-Taken-At"]).toBe("2022:05:01 08:00:00");
    expect(h["X-Latitude"]).toBeUndefined();
    expect(h["X-Longitude"]).toBeUndefined();
  });

  it("DateTimeOriginal wint van CreateDate", () => {
    const h = webMetadataHeaders(
      exifJpeg({ dateTimeOriginal: "2020:01:01 10:00:00", createDate: "2020:06:06 12:00:00" }),
    );
    expect(h["X-Taken-At"]).toBe("2020:01:01 10:00:00");
  });

  it("alleen de wijzigingsdatum (IFD0 DateTime): geen opnamedatum", () => {
    const h = webMetadataHeaders(exifJpeg({ dateTime: "2026:11:20 09:00:00" }));
    expect(h["X-Taken-At"]).toBeUndefined();
  });

  it("een lege of witte datum gaat niet mee", () => {
    expect(webMetadataHeaders(exifJpeg({ dateTimeOriginal: "" }))["X-Taken-At"]).toBeUndefined();
    expect(webMetadataHeaders(exifJpeg({ dateTimeOriginal: "    " }))["X-Taken-At"]).toBeUndefined();
  });

  it("GPS 0/0 (door de fotokiezer van Android weggehaald): geen plaats, de datum blijft", () => {
    const h = webMetadataHeaders(fixture("nul-gps.jpg"));
    expect(h["X-Taken-At"]).toBe("2025:01:02 03:04:05");
    expect(h["X-Latitude"]).toBeUndefined();
    expect(h["X-Longitude"]).toBeUndefined();
  });

  it("alleen een breedtegraad: geen plaats", () => {
    const h = webMetadataHeaders(exifJpeg({ gps: { latRef: "N", lat: dms(52, 0, 0) } }));
    expect(h).toEqual({});
  });

  it("een noemer 0 in de GPS: geen plaats en geen fout", () => {
    const bad: [[number, number], [number, number], [number, number]] = [
      [52, 0],
      [5, 1],
      [0, 1],
    ];
    const h = webMetadataHeaders(
      exifJpeg({ dateTimeOriginal: "2024:01:01 00:00:00", gps: { latRef: "N", lat: bad, lonRef: "E", lon: dms(5, 0, 0) } }),
    );
    expect(h["X-Latitude"]).toBeUndefined();
    expect(h["X-Longitude"]).toBeUndefined();
    expect(h["X-Taken-At"]).toBe("2024:01:01 00:00:00");
  });

  it("buiten bereik (95° noord): geen plaats", () => {
    const h = webMetadataHeaders(
      exifJpeg({ gps: { latRef: "N", lat: dms(95, 0, 0), lonRef: "E", lon: dms(5, 0, 0) } }),
    );
    expect(h["X-Latitude"]).toBeUndefined();
  });

  it("EXIF na een groot ICC-segment (APP2) wordt ook gevonden", () => {
    const exif = exifJpeg({ dateTimeOriginal: "2019:09:09 09:09:09" });
    const icc = new Uint8Array(4 + 30_000);
    icc.set([0xff, 0xe2, (30_002 >> 8) & 0xff, 30_002 & 0xff]);
    const bytes = new Uint8Array(2 + icc.length + exif.length - 2);
    bytes.set([0xff, 0xd8]);
    bytes.set(icc, 2);
    bytes.set(exif.subarray(2), 2 + icc.length);
    expect(webMetadataHeaders(bytes)["X-Taken-At"]).toBe("2019:09:09 09:09:09");
  });

  it.each<[string, Uint8Array]>([
    ["zonder EXIF (sharp)", fixture("zonder-exif.jpg")],
    ["zonder APP1", plainJpeg()],
    ["PNG", fixture("doorzichtig.png")],
    ["leeg", new Uint8Array(0)],
    ["willekeurig", Uint8Array.from({ length: 512 }, (_, i) => (i * 37 + 11) & 0xff)],
  ])("%s: geen headers, geen fout", (_label, bytes) => {
    expect(webMetadataHeaders(bytes)).toEqual({});
  });

  it("een afgekapt EXIF-segment of een wijzer buiten het bestand: geen fout", () => {
    const full = fixture("staand-6.jpg");
    for (const cut of [4, 12, 20, 40, 80, 200, 400]) {
      expect(() => webMetadataHeaders(full.subarray(0, cut))).not.toThrow();
    }
    const t = tiff({ dateTimeOriginal: "2024:01:01 00:00:00" });
    // IFD0-wijzer ver buiten het blok.
    t.set([0xff, 0xff, 0xff, 0x7f], 4);
    const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...t];
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body, 0xff, 0xd9]);
    expect(() => webMetadataHeaders(bytes)).not.toThrow();
  });
});

describe("U4 — wat de browser verstuurt, draagt nergens GPS", () => {
  it.each<[string, Uint8Array]>([
    ["JPEG zonder EXIF (zoals canvas hem maakt)", fixture("zonder-exif.jpg")],
    ["JPEG zonder APP1", plainJpeg()],
    ["JPEG met alleen een stand-tag in EXIF (sommige browsers)", exifJpeg({ orientation: 1 })],
  ])("%s: mag", (_label, bytes) => {
    expect(isSafeToSend(bytes)).toBe(true);
  });

  it.each<[string, Uint8Array]>([
    ["het origineel met GPS", fixture("staand-6.jpg")],
    ["GPS 0/0 (er staat nog een GPS-blok)", fixture("nul-gps.jpg")],
    ["GPS in big-endian", exifJpeg({ bigEndian: true, gps: { latRef: "N", lat: dms(1, 0, 0), lonRef: "E", lon: dms(1, 0, 0) } })],
    ["GPS in XMP", xmpJpeg('<x:xmpmeta><rdf:Description exif:GPSLatitude="52,5.44N"/></x:xmpmeta>')],
    ["GPS ná het beeld (een trailer)", concat(fixture("zonder-exif.jpg"), exifJpeg({ gps: { latRef: "N", lat: dms(1, 0, 0), lonRef: "E", lon: dms(1, 0, 0) } }))],
    ["PNG (de browser stuurt alleen JPEG)", fixture("doorzichtig.png")],
    ["leeg", new Uint8Array(0)],
  ])("%s: niet versturen", (_label, bytes) => {
    expect(isSafeToSend(bytes)).toBe(false);
  });
});

describe("U5 — per bestand een reden, vóór het decoderen", () => {
  const file = (type: string, name = "foto", size = 1000) => ({ type, name, size });

  it.each(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif", "image/avif"])(
    "%s: proberen",
    (type) => {
      expect(webPickProblem(file(type, "x"))).toBeNull();
    },
  );

  it.each(["IMG_0001.JPG", "foto.jpeg", "scan.png", "PXL_20261120.heic", "a.webp"])(
    "geen type maar een beeldnaam (%s): proberen",
    (name) => {
      expect(webPickProblem(file("", name))).toBeNull();
    },
  );

  it.each<[string, string]>([
    ["video/mp4", "film.mp4"],
    ["video/quicktime", "film.mov"],
    ["application/pdf", "brief.pdf"],
    ["image/svg+xml", "logo.svg"],
    ["text/html", "pagina.html"],
    ["", "bestand"],
    ["", "data.bin"],
  ])("%s (%s): geen foto", (type, name) => {
    expect(webPickProblem(file(type, name))).toBe("geen_foto");
  });

  it("leeg bestand: geen foto", () => {
    expect(webPickProblem(file("image/jpeg", "x.jpg", 0))).toBe("geen_foto");
  });

  it('nieuwe reden "formaat": eigen NL-tekst, geen opnieuw proberen', () => {
    const reason: FailReason = "formaat";
    const all: FailReason[] = ["netwerk", "bezig", "uitgelogd", "server", "limiet", "te_groot", "geen_foto", "geen_album", "formaat"];
    const texts = all.map(reasonText);
    expect(texts.every((t) => typeof t === "string" && t.trim().length > 0)).toBe(true);
    expect(new Set(texts).size).toBe(all.length);
    expect(canRetry(reason)).toBe(false);
  });
});

describe("U6 — een grens op het aantal pixels", () => {
  it("de grens laat 50 MP toe en ligt onder 200 MP", () => {
    expect(WEB_MAX_PIXELS).toBeGreaterThanOrEqual(50_000_000);
    expect(WEB_MAX_PIXELS).toBeLessThan(200_000_000);
  });

  it.each<[number, number, boolean]>([
    [4032, 3024, false],
    [3024, 4032, false],
    [8160, 6120, false],
    [16320, 12240, true],
    [50_000, 1000, false],
    [60_000, 4000, true],
  ])("%i × %i: te groot = %s", (w, h, expected) => {
    expect(tooManyPixels(w, h)).toBe(expected);
  });

  it("geen maat (0 of onbekend): niet als te groot gezien, het decoderen beslist", () => {
    expect(tooManyPixels(0, 0)).toBe(false);
  });
});

describe("U7 — een vaste id per foto op het web, uit de inhoud", () => {
  const head = (seed: number) => Uint8Array.from({ length: 65_536 }, (_, i) => (i * 31 + seed) & 0xff);

  it("dezelfde inhoud en maat: dezelfde id, ook met een kopie van de bytes", () => {
    const a = webAssetId(3_000_000, head(1));
    const b = webAssetId(3_000_000, new Uint8Array(head(1)));
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(b).toBe(a);
  });

  it("één byte anders of een andere maat: een andere id", () => {
    const base = head(1);
    const other = new Uint8Array(base);
    other[40_000] = (other[40_000]! + 1) & 0xff;
    expect(webAssetId(3_000_000, other)).not.toBe(webAssetId(3_000_000, base));
    expect(webAssetId(3_000_001, base)).not.toBe(webAssetId(3_000_000, base));
  });

  it("twee rondes met dezelfde foto voor hetzelfde album: dezelfde upload-id", () => {
    const id = webAssetId(2_500_000, head(7));
    const first = albumBatch([{ key: "1-0", assetId: id }], "album-web");
    const again = albumBatch([{ key: "2-0", assetId: webAssetId(2_500_000, head(7)) }], "album-web");
    expect(again[0]!.uploadId).toBe(first[0]!.uploadId);
    const otherPhoto = albumBatch([{ key: "3-0", assetId: webAssetId(2_500_000, head(8)) }], "album-web");
    expect(otherPhoto[0]!.uploadId).not.toBe(first[0]!.uploadId);
  });
});

describe("U8 — profielfoto: een vierkant uit het midden (advies vraag 8; vervalt bij besluit 'niet bijsnijden')", () => {
  it.each<[number, number, { originX: number; originY: number; width: number; height: number }]>([
    [4000, 3000, { originX: 500, originY: 0, width: 3000, height: 3000 }],
    [3000, 4000, { originX: 0, originY: 500, width: 3000, height: 3000 }],
    [1000, 1000, { originX: 0, originY: 0, width: 1000, height: 1000 }],
    [4001, 3000, { originX: 500, originY: 0, width: 3000, height: 3000 }],
  ])("%i × %i", (w, h, expected) => {
    expect(profileSquare(w, h)).toEqual(expected);
  });
});

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
