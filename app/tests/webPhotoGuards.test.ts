import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseLocation, parseTakenAt } from "../../convex/lib/upload";
import { canRetry, reasonText, type FailReason } from "../src/lib/upload";
import {
  WEB_HEAD_BYTES,
  imageHeaderSize,
  imageSizeOfFile,
  tooManyPixels,
  webMetadataHeaders,
} from "../src/lib/webPhoto";
import { dms, exifJpeg } from "./support/exifJpeg";

// WP36 B, na audit en red-team:
// - De grens van 100 MP (U6) is niet te omzeilen met meer dan WEB_HEAD_BYTES
//   aan APP-stukken vóór de SOF: de maat komt uit het hele bestand, en een
//   JPEG zonder maat wordt geweigerd.
// - Een header die de backend niet leest, gaat niet mee: een datum met een
//   regeleinde laat `fetch` gooien ("Geen verbinding"), en een plaats in
//   e-notatie gooit de backend weg.
// - Een omgezette foto met toch een locatie krijgt een eigen reden.

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../tests/fixtures/wp36/${name}`, import.meta.url))));

/** Een JPEG: SOI, APP-stukken van samen `appBytes`, SOF0 met de maat (of niet), EOI. */
function jpeg(opts: { appBytes: number; width?: number; height?: number }): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  let left = opts.appBytes;
  while (left > 0) {
    const body = Math.min(left, 65_533 - 2);
    const len = body + 2;
    parts.push(0xff, 0xe2, len >> 8, len & 0xff, ...new Array<number>(body).fill(0x41));
    left -= body;
  }
  if (opts.width !== undefined && opts.height !== undefined) {
    const h = opts.height;
    const w = opts.width;
    parts.push(0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03);
    parts.push(0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01);
  }
  parts.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xff, 0xd9);
  return new Uint8Array(parts);
}

/** Lezen zoals `file.slice`, en tellen hoeveel er gelezen wordt. */
function reader(bytes: Uint8Array) {
  const reads: number[] = [];
  return {
    reads,
    read: async (offset: number, length: number) => {
      reads.push(length);
      return bytes.slice(offset, offset + length);
    },
  };
}

const sizeOf = (bytes: Uint8Array) => {
  const r = reader(bytes);
  return imageSizeOfFile(bytes.subarray(0, WEB_HEAD_BYTES), bytes.length, r.read);
};

describe("U6 — de maat uit het hele bestand", () => {
  it("SOF na meer dan WEB_HEAD_BYTES aan APP-stukken: toch de maat, en te groot", async () => {
    const bytes = jpeg({ appBytes: 200 * 1024, width: 20_000, height: 20_000 });
    expect(imageHeaderSize(bytes.subarray(0, WEB_HEAD_BYTES))).toEqual({ width: 0, height: 0 });
    const size = await sizeOf(bytes);
    expect(size).toEqual({ width: 20_000, height: 20_000 });
    expect(tooManyPixels(size!.width, size!.height)).toBe(true);
  });

  it("leest in stukken, niet het hele bestand in één keer", async () => {
    const bytes = jpeg({ appBytes: 2 * 1024 * 1024, width: 4000, height: 3000 });
    const r = reader(bytes);
    const size = await imageSizeOfFile(bytes.subarray(0, WEB_HEAD_BYTES), bytes.length, r.read);
    expect(size).toEqual({ width: 4000, height: 3000 });
    expect(Math.max(...r.reads)).toBeLessThanOrEqual(64 * 1024);
  });

  it("een JPEG zonder SOF vóór het beeld: geen maat (weigeren)", async () => {
    expect(await sizeOf(jpeg({ appBytes: 200 * 1024 }))).toBeNull();
    expect(await sizeOf(jpeg({ appBytes: 100 }))).toBeNull();
  });

  it("een stuk dat buiten het bestand loopt: geen maat", async () => {
    const bytes = jpeg({ appBytes: 200 * 1024, width: 100, height: 100 });
    const cut = bytes.subarray(0, 150 * 1024);
    const r = reader(cut);
    expect(await imageSizeOfFile(cut.subarray(0, WEB_HEAD_BYTES), cut.length, r.read)).toBeNull();
  });

  it("een gewone foto: de maat uit de kop, zonder extra lezen", async () => {
    const bytes = fixture("staand-6.jpg");
    const r = reader(bytes);
    const size = await imageSizeOfFile(bytes.subarray(0, WEB_HEAD_BYTES), bytes.length, r.read);
    expect(size).toEqual(imageHeaderSize(bytes));
    expect(size!.width).toBeGreaterThan(0);
    expect(r.reads).toEqual([]);
  });

  it("PNG: de maat uit de kop", async () => {
    const bytes = fixture("doorzichtig.png");
    expect(await sizeOf(bytes)).toEqual(imageHeaderSize(bytes));
  });
});

describe("headers die de backend leest", () => {
  it.each(["2024:07:14\n15:30:00", "2024:07:14 15:30:00\r\nX-Evil: 1", "14-07-2024 15:30", "2024:07:14 15:30"])(
    "een datum in een andere vorm (%j) gaat niet mee",
    (date) => {
      expect(webMetadataHeaders(exifJpeg({ dateTimeOriginal: date }))["X-Taken-At"]).toBeUndefined();
    },
  );

  it("een kapotte DateTimeOriginal: dan CreateDate", () => {
    const h = webMetadataHeaders(exifJpeg({ dateTimeOriginal: "2024:07:14\n15:30:00", createDate: "2024:07:15 10:00:00" }));
    expect(h["X-Taken-At"]).toBe("2024:07:15 10:00:00");
  });

  it("een plaats vlak bij de evenaar: geen e-notatie, de backend leest hem", () => {
    const tiny: [[number, number], [number, number], [number, number]] = [
      [0, 1],
      [0, 1],
      [1, 1000],
    ];
    const h = webMetadataHeaders(
      exifJpeg({ gps: { latRef: "S", lat: tiny, lonRef: "E", lon: dms(5, 7, 1704) } }),
    );
    expect(h["X-Latitude"]).toMatch(/^[+-]?\d+(\.\d+)?$/);
    const loc = parseLocation(h["X-Latitude"] ?? null, h["X-Longitude"] ?? null);
    expect(loc).toBeDefined();
    expect(loc!.latitude).toBeCloseTo(-0.001 / 3600, 6);
    expect(loc!.longitude).toBeCloseTo(5 + 7 / 60 + 17.04 / 3600, 6);
  });

  it.each(["staand-6.jpg", "omgekeerd-3.jpg", "staand-8.jpg", "nul-gps.jpg"])(
    "%s: elke header is geldig voor fetch en de backend leest hem",
    (name) => {
      const h = webMetadataHeaders(fixture(name));
      expect(() => new Headers(h)).not.toThrow();
      if (h["X-Taken-At"] !== undefined) expect(parseTakenAt(h["X-Taken-At"])).toBeDefined();
      if (h["X-Latitude"] !== undefined) {
        expect(parseLocation(h["X-Latitude"], h["X-Longitude"] ?? null)).toBeDefined();
      }
    },
  );
});

describe('reden "locatie"', () => {
  it("eigen tekst, anders dan de andere, geen opnieuw proberen", () => {
    const all: FailReason[] = [
      "netwerk",
      "bezig",
      "uitgelogd",
      "server",
      "limiet",
      "te_groot",
      "geen_foto",
      "geen_album",
      "formaat",
      "locatie",
    ];
    const texts = all.map(reasonText);
    expect(new Set(texts).size).toBe(all.length);
    expect(reasonText("locatie")).toMatch(/locatie/);
    expect(canRetry("locatie")).toBe(false);
  });
});
