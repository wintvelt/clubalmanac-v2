// @vitest-environment node
//
// Een licht beschadigde JPEG krijgt toch formaten (prod: "VipsJpeg: premature
// end of JPEG image" bij een origineel dat een browser gewoon toont, met een
// grijze onderkant). sharp leest het origineel daarom niet streng in: een
// afgekapt of beschadigd einde is geen reden om te weigeren. Weigert de decode
// een JPEG toch (veel beschadigde data, bv. "found marker 0xd9 instead of
// RST3"), dan nog één poging met `unlimited`. Bytes die geen beeld zijn,
// blijven mislukken (invariant 18).
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

/**
 * Een geldige baseline-JPEG met een restart-marker na elk MCU (DRI = 1), zoals
 * `jpegtran -restart 1` hem maakt. Hier met de hand gebouwd (jpegtran staat
 * niet in CI): grijs, één component, en de kleinst mogelijke Huffman-tabellen
 * (DC en AC elk één code van één bit: DC-categorie 0 en EOB). Elk 8×8-blok is
 * dan middengrijs (DC 0 na de level shift) en kost twee bits "00", aangevuld
 * met enen tot de byte 0x3F; daarna RSTn (FF D0..D7).
 */
function restartJpeg(width: number, height: number): Buffer {
  const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  const oneCode = [1, ...new Array<number>(15).fill(0)];
  const out = [0xff, 0xd8];
  out.push(...seg(0xdb, [0x00, ...new Array<number>(64).fill(1)])); // DQT
  out.push(...seg(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0])); // SOF0
  out.push(...seg(0xc4, [0x00, ...oneCode, 0x00])); // DHT DC 0
  out.push(...seg(0xc4, [0x10, ...oneCode, 0x00])); // DHT AC 0
  out.push(...seg(0xdd, [0, 1])); // DRI: elk MCU
  out.push(...seg(0xda, [1, 1, 0x00, 0, 63, 0])); // SOS
  const mcus = Math.ceil(width / 8) * Math.ceil(height / 8);
  for (let i = 0; i < mcus; i++) {
    out.push(0x3f);
    if (i < mcus - 1) out.push(0xff, 0xd0 + (i % 8));
  }
  out.push(0xff, 0xd9);
  return Buffer.from(out);
}

/** Zoals op prod: de tweede helft nul-bytes, de EOI erachter. */
function zeroedTail(b: Buffer): Uint8Array {
  const v = Buffer.from(b);
  v.fill(0, Math.floor(b.length * 0.5), b.length - 2);
  return new Uint8Array(v);
}

/** Afgekapt op 60%, met FF D9 erachter. */
function cutWithEoi(b: Buffer): Uint8Array {
  return new Uint8Array(Buffer.concat([b.subarray(0, Math.floor(b.length * 0.6)), Buffer.from([0xff, 0xd9])]));
}

/** De eerste decode van makeFormatImages, zonder terugval. */
const strictDecode = (b: Uint8Array) => sharp(b, { pages: 1, failOn: "none" }).raw().toBuffer();

describe("JPEG met restart-markers en een beschadigd einde (terugval met `unlimited`)", () => {
  it("onbeschadigd: de fixture is een geldige JPEG", async () => {
    const f = await makeFormatImages(new Uint8Array(restartJpeg(1200, 1600)));
    expect([f.width, f.height]).toEqual([1200, 1600]);
  });

  it("tweede helft nul-bytes: zonder terugval 'instead of RST', met terugval klein en groot", async () => {
    const bytes = zeroedTail(restartJpeg(1200, 1600));
    // Het uitgangspunt: ook met `failOn: "none"` weigert sharp dit bestand.
    await expect(strictDecode(bytes)).rejects.toThrow(/instead of RST/);

    const f = await makeFormatImages(bytes);

    expect([f.width, f.height]).toEqual([1200, 1600]);
    const groot = await sharp(Buffer.from(f.groot)).metadata();
    const klein = await sharp(Buffer.from(f.klein)).metadata();
    expect([groot.format, groot.width, groot.height]).toEqual(["jpeg", 1200, GROOT_MAX]);
    expect([klein.format, klein.width, klein.height]).toEqual(["jpeg", 384, 512]);
  });

  it("afgekapt op 60% met EOI erachter: zonder terugval 'instead of RST', met terugval formaten", async () => {
    const bytes = cutWithEoi(restartJpeg(1200, 1600));
    await expect(strictDecode(bytes)).rejects.toThrow(/instead of RST/);

    const f = await makeFormatImages(bytes);

    expect([f.width, f.height]).toEqual([1200, 1600]);
  });
});

describe("geen beeld: blijft mislukken", () => {
  it("JPEG-handtekening (FF D8 FF) met onzin erachter: ook na de terugval", async () => {
    const junk = new Uint8Array(4096);
    for (let i = 0; i < junk.length; i++) junk[i] = (i * 37 + 11) & 0xff;
    junk.set([0xff, 0xd8, 0xff], 0);
    await expect(makeFormatImages(junk)).rejects.toThrow();
  });

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
