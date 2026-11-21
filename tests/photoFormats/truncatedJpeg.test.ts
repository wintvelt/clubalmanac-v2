// @vitest-environment node
//
// Een licht beschadigde JPEG krijgt toch formaten (prod: "VipsJpeg: premature
// end of JPEG image" bij een origineel dat een browser gewoon toont, met een
// grijze onderkant). sharp leest het origineel daarom niet streng in: een
// afgekapt of beschadigd einde is geen reden om te weigeren. Bytes die geen
// beeld zijn, blijven mislukken (invariant 18).
//
// Echte beeldbibliotheek, zoals images.test.ts.

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { GROOT_MAX, makeFormatImages } from "../../convex/lib/photoFormats";

/** Een JPEG met ruis (zodat de scan-data groot is), 2000×1500. */
async function noisyJpeg(width = 2000, height = 1500): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 7;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = seed & 0xff;
  }
  return await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}

describe("afgekapte JPEG", () => {
  it("de laatste 30% ontbreekt (geen EOI): toch klein en groot, met de maat uit de kop", async () => {
    const full = await noisyJpeg();
    const cut = new Uint8Array(full.subarray(0, Math.floor(full.length * 0.7)));
    // Het uitgangspunt: streng ingelezen weigert sharp dit bestand.
    await expect(sharp(cut).raw().toBuffer()).rejects.toThrow(/premature end/i);

    const f = await makeFormatImages(cut);

    expect([f.width, f.height]).toEqual([2000, 1500]);
    const groot = await sharp(Buffer.from(f.groot)).metadata();
    const klein = await sharp(Buffer.from(f.klein)).metadata();
    expect([groot.format, groot.width, groot.height]).toEqual(["jpeg", GROOT_MAX, 1200]);
    expect([klein.format, klein.width, klein.height]).toEqual(["jpeg", 512, 384]);
  });

  it("alleen de laatste paar bytes weg: ook formaten", async () => {
    const full = await noisyJpeg(800, 600);
    const cut = new Uint8Array(full.subarray(0, full.length - 10));

    const f = await makeFormatImages(cut);

    expect([f.width, f.height]).toEqual([800, 600]);
  });
});

describe("geen beeld: blijft mislukken", () => {
  it("onzin-bytes", async () => {
    const junk = new Uint8Array(4096);
    for (let i = 0; i < junk.length; i++) junk[i] = (i * 37 + 11) & 0xff;
    await expect(makeFormatImages(junk)).rejects.toThrow();
  });

  it("tekst", async () => {
    await expect(makeFormatImages(new TextEncoder().encode("dit is geen foto"))).rejects.toThrow();
  });

  it("alleen het begin van een JPEG-kop, zonder beeld", async () => {
    const full = await noisyJpeg(800, 600);
    await expect(makeFormatImages(new Uint8Array(full.subarray(0, 20)))).rejects.toThrow();
  });
});
