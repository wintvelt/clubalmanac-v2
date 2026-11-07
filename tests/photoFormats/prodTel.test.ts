// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import * as lib from "../../convex/lib/photoFormats";
// @ts-expect-error -- .mjs zonder typen
import * as tel from "../../scripts/wp25/prod-tel.mjs";

// WP25 fix-cyclus 1 — het telscript voor prod (besluit 7, pre-flight 10).
// Het script draait één keer, op Wouters laptop, tegen S3. Wat hier gepind
// wordt: de maat komt goed uit de kop, en de grens is die van de impl.

const FIXTURES = join(__dirname, "../fixtures/wp25");
const read = (name: string) => readFileSync(join(FIXTURES, name));

describe("prod-tel.mjs", () => {
  it("dezelfde HEIC-grens als de impl", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(tel.HEIC_MAX_PIXELS).toBe((lib as any).HEIC_MAX_PIXELS);
  });

  it("HEIC: de maat van het primaire beeld uit de kop (ook met tegels en irot)", () => {
    for (const name of ["g3.heic", "g6.heic", "g8.heic"]) {
      expect(tel.sniff(read(name)), name).toBe("heic");
      expect(tel.heifSize(read(name)), name).toEqual({ width: 1200, height: 900 });
    }
    expect(tel.heifSize(read("groot-17mp.heic"))).toEqual({ width: 4800, height: 3600 });
  });

  it("HEIC zonder meta-box in de bytes: null (dan haalt het script het hele object)", () => {
    const full = read("g6.heic");
    expect(tel.heifSize(full.subarray(0, full.readUInt32BE(0)))).toBeNull();
  });

  it("JPEG: de maat uit de SOF, ook achter een EXIF-blok, vóór de draaiing", async () => {
    const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#123456" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect(tel.sniff(jpeg)).toBe("jpeg");
    expect(tel.jpegSize(jpeg)).toEqual({ width: 300, height: 200 });
  });
});
