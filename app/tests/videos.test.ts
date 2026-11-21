import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  filterEntries,
  formatDuration,
  locationFromISO6709,
  showMediaFilter,
  takenAtFromQuickTime,
  VIDEO_TARGET,
  videoFailMessage,
  videoPlayerSource,
  videoRetryable,
  videoTooLong,
  type VideoFailReason,
} from "../src/lib/videos";
import { listFiles } from "./support/sourceScan";

// WP37 — de pure logica van filmpjes in de app.
//   Besluit 1: tegel met de duur (0:42), filter Alle/Foto's/Video's, alleen
//   in een album met een filmpje (invariant 10, A-keuze).
//   Besluit 3: het doel van de compressie (1080p, H.264, 3,5–4 Mbit/s, AAC).
//   A-keuze: de grens van 3:00 telt afgerond op hele seconden, gelijk aan de
//   backend (tests/videos/mp4.test.ts).
//   A-invariant 14: de datum van een iPhone-filmpje
//   (com.apple.quicktime.creationdate, lokale tijd met tijdzone) gaat als de
//   kloktijd naar de backend, in de vorm van `X-Taken-At` (zoals bij foto's).
//   Invariant 5: per reden een NL-melding, en of opnieuw proberen zin heeft.
//   A-invariant 23: geen filmpje in de schijfcache.
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §Testcontract.

describe("formatDuration (besluit 1)", () => {
  it.each([
    [0, "0:00"],
    [499, "0:00"],
    [500, "0:01"],
    [9_000, "0:09"],
    [42_000, "0:42"],
    [65_000, "1:05"],
    [180_000, "3:00"],
    [180_499, "3:00"],
    [600_000, "10:00"],
  ])("%i ms → %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it("negatief of geen getal: 0:00", () => {
    expect(formatDuration(-5)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
  });
});

describe("videoTooLong (A-keuze: afgerond op seconden, zoals de backend)", () => {
  it("3:00,499 mag; 3:00,500 niet", () => {
    expect(videoTooLong(180_000)).toBe(false);
    expect(videoTooLong(180_499)).toBe(false);
    expect(videoTooLong(180_500)).toBe(true);
    expect(videoTooLong(25 * 60_000)).toBe(true);
  });

  it("wat de tegel als 3:00 toont, wordt nooit geweigerd", () => {
    for (let ms = 179_000; ms <= 181_000; ms += 1) {
      if (formatDuration(ms) === "3:00") expect(videoTooLong(ms)).toBe(false);
    }
  });
});

type Entry = { key: string; photo: { video?: { durationMs: number } } | null };
const foto = (key: string): Entry => ({ key, photo: {} });
const film = (key: string, durationMs = 42_000): Entry => ({ key, photo: { video: { durationMs } } });

describe("filter Alle / Foto's / Video's (besluit 1, invariant 10)", () => {
  const entries: Entry[] = [foto("a"), film("b"), foto("c"), { key: "weg", photo: null }, film("d")];

  it("alleen zichtbaar in een album met minstens één filmpje", () => {
    expect(showMediaFilter(entries)).toBe(true);
    expect(showMediaFilter([foto("a"), foto("b")])).toBe(false);
    expect(showMediaFilter([])).toBe(false);
    expect(showMediaFilter([film("x")])).toBe(true);
  });

  it("alle: alles, in dezelfde volgorde", () => {
    expect(filterEntries(entries, "alle").map((e) => e.key)).toEqual(["a", "b", "c", "weg", "d"]);
  });

  it("fotos: alleen foto's", () => {
    expect(filterEntries(entries, "fotos").map((e) => e.key)).toEqual(["a", "c"]);
  });

  it("videos: alleen filmpjes", () => {
    expect(filterEntries(entries, "videos").map((e) => e.key)).toEqual(["b", "d"]);
  });
});

describe("takenAtFromQuickTime (A-invariant 14: de kloktijd, niet UTC)", () => {
  it.each([
    ["2026-07-14T15:32:10+0200", "2026:07:14 15:32:10"],
    ["2026-07-14T15:32:10+02:00", "2026:07:14 15:32:10"],
    ["2026-07-14T15:32:10-0500", "2026:07:14 15:32:10"],
    ["2026-07-14T15:32:10Z", "2026:07:14 15:32:10"],
    ["2026-07-14T15:32:10.123+0200", "2026:07:14 15:32:10"],
    ["2026-12-31T23:59:59+0100", "2026:12:31 23:59:59"],
  ])("%s → %s", (input, header) => {
    expect(takenAtFromQuickTime(input)).toBe(header);
  });

  it.each([null, undefined, "", "gisteren", "2026-02-30T10:00:00+0100", "2026-07-14T25:00:00+0200", "0000-00-00T00:00:00Z", "2026:07:14 15:32:10"])(
    "%s → null",
    (input) => {
      expect(takenAtFromQuickTime(input as string | null | undefined)).toBeNull();
    },
  );
});

describe("locationFromISO6709 (de plaats uit het origineel)", () => {
  it.each([
    ["+52.3676+004.9041+000.000/", { latitude: 52.3676, longitude: 4.9041 }],
    ["+52.3676+004.9041/", { latitude: 52.3676, longitude: 4.9041 }],
    ["-33.8688+151.2093+012.5/", { latitude: -33.8688, longitude: 151.2093 }],
    ["+41.7151+044.8271+450.123/", { latitude: 41.7151, longitude: 44.8271 }],
    ["+52+004/", { latitude: 52, longitude: 4 }],
  ])("%s", (input, spot) => {
    expect(locationFromISO6709(input)).toEqual(spot);
  });

  it.each([null, "", "52.3676,4.9041", "+91.0000+004.0000/", "+52.0000+181.0000/", "+52.3676/", "abc"])("%s → null", (input) => {
    expect(locationFromISO6709(input as string | null)).toBeNull();
  });
});

describe("meldingen (invariant 5)", () => {
  const ALL: VideoFailReason[] = [
    "te_lang",
    "te_groot",
    "locatie",
    "codec",
    "geen_mp4",
    "index_achteraan",
    "comprimeren",
    "netwerk",
    "niet_binnen",
    "bezig",
    "limiet",
    "geen_album",
    "uitgelogd",
    "server",
  ];

  it("elke reden een eigen, Nederlandse zin", () => {
    const texts = ALL.map((r) => videoFailMessage(r));
    for (const t of texts) {
      expect(t.length).toBeGreaterThan(10);
      expect(t).not.toMatch(/\b(error|failed|upload failed|too long)\b/i);
    }
    expect(new Set(texts).size).toBe(ALL.length);
  });

  it("te lang noemt de 3 minuten en inkorten in Foto's", () => {
    const t = videoFailMessage("te_lang");
    expect(t).toMatch(/3 minuten/);
    expect(t).toMatch(/Foto's/);
  });

  it("opnieuw proberen alleen waar het kan helpen", () => {
    for (const r of ["netwerk", "niet_binnen", "server", "bezig", "comprimeren"] as const) expect(videoRetryable(r)).toBe(true);
    for (const r of ["te_lang", "te_groot", "locatie", "codec", "geen_mp4", "index_achteraan", "limiet", "geen_album", "uitgelogd"] as const) {
      expect(videoRetryable(r)).toBe(false);
    }
  });
});

describe("het doel van de compressie (besluit 3)", () => {
  it("1080p (langste zijde 1920), H.264 3,5–4 Mbit/s, AAC 128 kbit/s, hooguit 30 fps, mp4 met de index vooraan", () => {
    expect(VIDEO_TARGET.maxSide).toBe(1920);
    expect(VIDEO_TARGET.videoCodec).toBe("avc1");
    expect(VIDEO_TARGET.videoBitrate).toBeGreaterThanOrEqual(3_500_000);
    expect(VIDEO_TARGET.videoBitrate).toBeLessThanOrEqual(4_000_000);
    expect(VIDEO_TARGET.audioBitrate).toBe(128_000);
    expect(VIDEO_TARGET.maxFps).toBe(30);
    expect(VIDEO_TARGET.container).toBe("mp4");
    expect(VIDEO_TARGET.indexFirst).toBe(true);
    expect(VIDEO_TARGET.keepMetadata).toBe(false);
  });

  it("dat is ~28 MB per minuut (besluit 3), en 3 minuten past ruim onder 120 MiB", () => {
    const perMinute = ((VIDEO_TARGET.videoBitrate + VIDEO_TARGET.audioBitrate) * 60) / 8;
    expect(perMinute).toBeGreaterThan(26_000_000);
    expect(perMinute).toBeLessThan(31_000_000);
    expect(perMinute * 3).toBeLessThan(120 * 1024 * 1024 * 0.85);
  });
});

describe("afspelen zonder schijfcache (A-invariant 23)", () => {
  it("videoPlayerSource: de link, zonder cache", () => {
    const url = "https://acc.eu.r2.cloudflarestorage.com/b/videos/x.mp4?X-Amz-Signature=aaaa";
    expect(videoPlayerSource({ url, expiresAt: 1 })).toEqual({ uri: url, useCaching: false });
  });

  const srcDir = fileURLToPath(new URL("../src", import.meta.url));
  const files = listFiles(srcDir, new Set()).filter((f) => /\.(ts|tsx)$/.test(f));
  const read = (f: string) => readFileSync(`${srcDir}/${f}`, "utf8");

  it("de app kent de R2-host niet: links komen van de backend", () => {
    const hits = files.filter((f) => /r2\.cloudflarestorage\.com|R2_ENDPOINT|R2_SECRET/.test(read(f)));
    expect(hits).toEqual([]);
  });

  it("iemand vraagt api.videos.playUrl en api.videos.startUpload", () => {
    expect(files.some((f) => /api\.videos\.playUrl\b/.test(read(f)))).toBe(true);
    expect(files.some((f) => /api\.videos\.startUpload\b/.test(read(f)))).toBe(true);
  });
});
