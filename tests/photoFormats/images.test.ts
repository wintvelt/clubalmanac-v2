// @vitest-environment node
//
// WP25 — de pixels van een formaat (invariant 6 en 18, A-kernvondst 1).
//
// Deze file draait in de Node-omgeving, met de echte beeldbibliotheek: wat hier
// gepind wordt (welke kant boven is, of een HEIC dubbel draait) is niet te mocken
// zonder de vraag zelf weg te mocken. sharp dient hier ook als oracle: om een
// invoer-JPEG met een EXIF-tag te maken, en om een formaat terug te lezen en de
// teruggegeven stand toe te passen zoals een viewer dat doet.
//
// De afspraak die gepind wordt:
//   - een formaat bevat de ruwe pixels: niet gedraaid, zonder EXIF;
//   - `exifOrientation` is de stand ten opzichte van die pixels;
//   - wie de stand toepast op het formaat, ziet het beeld rechtop. Precies één
//     keer gedraaid, ook bij een HEIC van Apple (irot én EXIF-tag).
//
// Het rode vlak is het herkenningspunt: in de ruwe pixels staat het linksboven.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { makeFormatImages } from "../../convex/lib/photoFormats";

const FIXTURES = join(__dirname, "../fixtures/wp25");

type Spot = { width: number; height: number; x: number; y: number };

/** Een JPEG: blauw, rood vlak linksboven in de ruwe pixels, optioneel een tag. */
async function makeJpeg(width: number, height: number, orientation?: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const red = x < width / 5 && y < height / 5;
      raw[i] = red ? 255 : 0;
      raw[i + 1] = 0;
      raw[i + 2] = red ? 0 : 255;
    }
  }
  let img = sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 });
  if (orientation !== undefined) img = img.withMetadata({ orientation });
  return new Uint8Array(await img.toBuffer());
}

/**
 * Waar staat het rode vlak, als een viewer de stand `orientation` toepast?
 * Zonder stand (of 1): de pixels zoals ze zijn. Geeft afmeting en het
 * zwaartepunt van rood als fractie (0..1) van breedte en hoogte.
 */
async function redSpot(bytes: Uint8Array, orientation?: number): Promise<Spot> {
  let input = Buffer.from(bytes);
  if (orientation !== undefined && orientation !== 1) {
    input = await sharp(input).withMetadata({ orientation }).jpeg({ quality: 95 }).toBuffer();
  }
  const { data, info } = await sharp(input).rotate().raw().toBuffer({ resolveWithObject: true });
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i]! > 180 && data[i + 2]! < 90) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  expect(n, "geen rood vlak gevonden").toBeGreaterThan(0);
  return { width: info.width, height: info.height, x: sx / n / info.width, y: sy / n / info.height };
}

const corner = (s: Spot) => `${s.y < 0.5 ? "boven" : "onder"}-${s.x < 0.5 ? "links" : "rechts"}`;
const shape = (s: Spot) => (s.width > s.height ? "liggend" : s.width < s.height ? "staand" : "vierkant");

// Waar het rode vlak (ruw linksboven) staat na het toepassen van de EXIF-stand.
const UPRIGHT_CORNER: Record<number, string> = {
  1: "boven-links",
  3: "onder-rechts",
  6: "boven-rechts",
  8: "onder-links",
};

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

describe("maten (invariant 18)", () => {
  it("klein: langste zijde 512, groot: langste zijde 1600, verhouding blijft", async () => {
    const out = await makeFormatImages(await makeJpeg(2400, 1200));
    const k = await sharp(Buffer.from(out.klein)).metadata();
    const g = await sharp(Buffer.from(out.groot)).metadata();
    expect([k.width, k.height]).toEqual([512, 256]);
    expect([g.width, g.height]).toEqual([1600, 800]);
  });

  it("staand origineel: de hoogte is de langste zijde", async () => {
    const out = await makeFormatImages(await makeJpeg(1000, 3000));
    const k = await sharp(Buffer.from(out.klein)).metadata();
    const g = await sharp(Buffer.from(out.groot)).metadata();
    expect(Math.max(k.width!, k.height!)).toBe(512);
    expect(k.height).toBe(512);
    expect(g.height).toBe(1600);
  });

  it("nooit opgeschaald: een origineel kleiner dan 512 houdt zijn maat in beide formaten", async () => {
    const out = await makeFormatImages(await makeJpeg(300, 200));
    for (const f of [out.klein, out.groot]) {
      const m = await sharp(Buffer.from(f)).metadata();
      expect([m.width, m.height]).toEqual([300, 200]);
    }
  });

  it("width en height zijn de afmetingen van de ruwe pixels op volle grootte, vóór de draaiing", async () => {
    const out = await makeFormatImages(await makeJpeg(2400, 1200, 6));
    expect([out.width, out.height]).toEqual([2400, 1200]);
  });
});

describe("alleen pixels (invariant 18)", () => {
  it("elk formaat is een JPEG, ook als het origineel een PNG is", async () => {
    const png = await sharp(Buffer.from(await makeJpeg(800, 600))).png().toBuffer();
    const out = await makeFormatImages(new Uint8Array(png));
    for (const f of [out.klein, out.groot]) {
      expect(isJpeg(f)).toBe(true);
      expect((await sharp(Buffer.from(f)).metadata()).format).toBe("jpeg");
    }
  });

  it("geen EXIF en geen oriëntatie-tag in een formaat (ook geen GPS)", async () => {
    const out = await makeFormatImages(await makeJpeg(2400, 1200, 6));
    for (const f of [out.klein, out.groot]) {
      const m = await sharp(Buffer.from(f)).metadata();
      expect(m.exif, "EXIF in een formaat").toBeUndefined();
      expect(m.orientation ?? 1).toBe(1);
      expect(m.icc, "ICC-profiel in een formaat").toBeUndefined();
    }
  });

  it("transparantie wordt wit, niet zwart (open vraag 2: advies wit)", async () => {
    // 200×200, helemaal transparant behalve een rood vlak linksboven.
    const raw = Buffer.alloc(200 * 200 * 4);
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 200; x++) {
        const i = (y * 200 + x) * 4;
        if (x < 40 && y < 40) {
          raw[i] = 255;
          raw[i + 3] = 255;
        }
      }
    }
    const png = await sharp(raw, { raw: { width: 200, height: 200, channels: 4 } }).png().toBuffer();
    const out = await makeFormatImages(new Uint8Array(png));
    const { data, info } = await sharp(Buffer.from(out.klein)).raw().toBuffer({ resolveWithObject: true });
    const i = (150 * info.width + 150) * info.channels; // ver in het transparante deel
    expect([data[i], data[i + 1], data[i + 2]].every((c) => c! > 240)).toBe(true);
  });

  it("bytes die geen beeld zijn: de functie gooit, er komt geen formaat", async () => {
    await expect(makeFormatImages(new TextEncoder().encode("dit is geen foto"))).rejects.toThrow();
  });
});

describe("JPEG: ruwe pixels plus de tag uit het bestand (invariant 6, 12)", () => {
  it.each([1, 3, 6, 8])("tag %i: het formaat is niet gedraaid, en de stand is de tag", async (tag) => {
    const out = await makeFormatImages(await makeJpeg(1200, 900, tag));
    expect(out.exifOrientation).toBe(tag);

    // De ruwe pixels: liggend, rood linksboven, voor elke tag.
    const raw = await redSpot(out.klein);
    expect(shape(raw)).toBe("liggend");
    expect(corner(raw)).toBe("boven-links");

    // Wie de stand toepast, ziet de bedoelde stand: precies één keer gedraaid.
    const shown = await redSpot(out.groot, out.exifOrientation);
    expect(corner(shown)).toBe(UPRIGHT_CORNER[tag]);
    expect(shape(shown)).toBe(tag === 6 || tag === 8 ? "staand" : "liggend");
  });

  it("zonder tag: geen stand (leeg), en de pixels zoals ze zijn", async () => {
    const out = await makeFormatImages(await makeJpeg(1200, 900));
    expect(out.exifOrientation).toBeUndefined();
    expect(corner(await redSpot(out.klein))).toBe("boven-links");
  });
});

describe("HEIC van Apple: irot én EXIF-tag, toch precies één keer gedraaid (A-kernvondst 1)", () => {
  const cases = [
    { file: "g3.heic", tag: 3, shape: "liggend", corner: "onder-rechts" },
    { file: "g6.heic", tag: 6, shape: "staand", corner: "boven-rechts" },
    { file: "g8.heic", tag: 8, shape: "staand", corner: "onder-links" },
  ];

  it.each(cases)("$file: rechtop na het toepassen van de teruggegeven stand", async (c) => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, c.file)));
    const out = await makeFormatImages(bytes);

    for (const f of [out.klein, out.groot]) expect(isJpeg(f)).toBe(true);

    // De decoder heeft irot al toegepast. De EXIF-tag in het bestand (3, 6, 8)
    // mag dus niet nog eens gelden: de stand is leeg of 1.
    expect([undefined, 1]).toContain(out.exifOrientation);

    const shown = await redSpot(out.groot, out.exifOrientation);
    expect(shape(shown)).toBe(c.shape);
    expect(corner(shown)).toBe(c.corner);
  });

  it("g6.heic: width/height zijn die van de gedecodeerde (al gedraaide) pixels", async () => {
    const out = await makeFormatImages(new Uint8Array(readFileSync(join(FIXTURES, "g6.heic"))));
    expect([out.width, out.height]).toEqual([900, 1200]);
    const k = await sharp(Buffer.from(out.klein)).metadata();
    expect([k.width, k.height]).toEqual([384, 512]);
  });
});
