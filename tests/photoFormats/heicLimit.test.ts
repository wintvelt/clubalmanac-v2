// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as lib from "../../convex/lib/photoFormats";

// WP25 fix-cyclus 1 — een te grote HEIC wordt niet gedecodeerd (A-invariant 20,
// kernvondst 8, besluit 7).
//
// Een HEIC van 24 MP laat de Node-action van 512 MB omvallen (lokaal 454–554 MB,
// Convex ~90 MB hoger). `makeFormatImages` leest daarom eerst de maat uit de
// HEIF-kop (`ispe` van het primaire item) en weigert boven 13 MP, vóór het
// decoderen. Fix-cyclus 2: 16 MP paste niet in een warme action (een tweede HEIC
// van ~16 MP: 520–540 MB op Convex). heic-decode is hier nep en gooit "decode aangeroepen": zo ziet de
// test of de stap de decoder bereikt, zonder ooit 17 MP te decoderen.

vi.mock("heic-decode", () => {
  const decode = vi.fn(async () => {
    throw new Error("decode aangeroepen");
  });
  return { default: decode, __esModule: true };
});

const FIXTURES = join(__dirname, "../fixtures/wp25");
const read = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L = lib as any;

describe("de grens", () => {
  it("HEIC_MAX_PIXELS is 13 MP: 4032×3024 (12,2 MP) erdoor, 5712×4284 (24,5 MP) niet", () => {
    expect(L.HEIC_MAX_PIXELS).toBe(13_000_000);
    expect(4032 * 3024).toBeLessThanOrEqual(L.HEIC_MAX_PIXELS);
    expect(5712 * 4284).toBeGreaterThan(L.HEIC_MAX_PIXELS);
  });
});

describe("makeFormatImages leest de maat vóór het decoderen", () => {
  it("17 MP (4800×3600): gooit 'te groot', zonder de decoder aan te roepen", async () => {
    const decode = (await import("heic-decode")).default as unknown as ReturnType<typeof vi.fn>;
    decode.mockClear();
    await expect(lib.makeFormatImages(read("groot-17mp.heic"))).rejects.toThrow(/te groot/);
    expect(decode).not.toHaveBeenCalled();
  });

  it("1,1 MP (1200×900, met tegels en irot): de grens laat hem door, de decoder wordt bereikt", async () => {
    const decode = (await import("heic-decode")).default as unknown as ReturnType<typeof vi.fn>;
    decode.mockClear();
    // De nep-decoder gooit; wat de stap daarna doet (sharp proberen) doet hier
    // niet ter zake. Het gaat erom dat de grens hem doorliet.
    await lib.makeFormatImages(read("g6.heic")).catch(() => undefined);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("een HEIC zonder leesbare maat in de kop: niet decoderen ('maat onbekend')", async () => {
    const decode = (await import("heic-decode")).default as unknown as ReturnType<typeof vi.fn>;
    decode.mockClear();
    // Alleen de ftyp-box: herkend als HEIC, maar zonder meta-box.
    const full = read("g6.heic");
    const ftypSize = new DataView(full.buffer, full.byteOffset).getUint32(0);
    const headless = full.slice(0, ftypSize);
    await expect(lib.makeFormatImages(headless)).rejects.toThrow(/maat onbekend|te groot/);
    expect(decode).not.toHaveBeenCalled();
  });
});
