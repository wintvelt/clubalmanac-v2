import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  filterEntries,
  finishOutcome,
  formatDuration,
  locationFromISO6709,
  mediaCountText,
  showMediaFilter,
  startRefusalReason,
  takenAtFromQuickTime,
  VIDEO_TARGET,
  videoFailMessage,
  videoPlayerSource,
  videoRetryable,
  videoRetryRound,
  videoTooLong,
  videoTooLongToSend,
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
//   Fixronde 1: `uitgelogd` en `verlopen` opnieuw te proberen (A-invariant 32,
//   33); de albumkop telt filmpjes apart (A-invariant 34).
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

describe("videoTooLongToSend: vóór het versturen al weigeren (fixronde 3)", () => {
  // De backend telt de langste duur in het bestand, ook de AAC-aanloop van
  // het geluid (~70 ms langer dan wat de app meet). Wat de app doorlaat, moet
  // de backend ook doorlaten (tot 180,499 s): de app houdt 100 ms marge.
  it("tot 180,4 s mag, daarboven niet", () => {
    expect(videoTooLongToSend(180_000)).toBe(false);
    expect(videoTooLongToSend(180_400)).toBe(false);
    expect(videoTooLongToSend(180_401)).toBe(true);
    expect(videoTooLongToSend(180_499)).toBe(true);
    expect(videoTooLongToSend(25 * 60_000)).toBe(true);
  });

  it("wat de app doorlaat, plus de aanloop van 70 ms, laat de backend door", () => {
    for (let ms = 179_000; ms <= 181_000; ms += 7) {
      if (!videoTooLongToSend(ms)) expect(videoTooLong(ms + 70), `${ms} ms`).toBe(false);
    }
  });

  it("geen getal of negatief: niet te lang (de backend toetst het bestand zelf)", () => {
    expect(videoTooLongToSend(Number.NaN)).toBe(false);
    expect(videoTooLongToSend(-1)).toBe(false);
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
    "verlopen",
    "te_vaak",
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

  // WP42 B14: overal (iOS en Android) dezelfde tekst, zonder de app van de iPhone.
  it("te lang noemt de 3 minuten en inkorten, niet Foto's (B14)", () => {
    const t = videoFailMessage("te_lang");
    expect(t).toBe("Dit filmpje duurt langer dan 3 minuten. Kort het filmpje in en kies het opnieuw.");
    expect(t).not.toMatch(/Foto's/);
  });

  it("te groot zegt dat ook verkleinen niet hielp en noemt inkorten, niet Foto's (B14)", () => {
    const t = videoFailMessage("te_groot");
    expect(t).toBe("Dit filmpje is te groot, ook na het verkleinen. Kort het filmpje in en probeer het opnieuw.");
    expect(t).not.toMatch(/Foto's/);
  });

  it("opnieuw proberen alleen waar het kan helpen; uitgelogd met een vers token, zoals bij foto's (A-invariant 33)", () => {
    for (const r of ["netwerk", "niet_binnen", "server", "bezig", "comprimeren", "uitgelogd", "verlopen"] as const) {
      expect(videoRetryable(r), r).toBe(true);
    }
    for (const r of ["te_lang", "te_groot", "locatie", "codec", "geen_mp4", "index_achteraan", "limiet", "geen_album", "te_vaak"] as const) {
      expect(videoRetryable(r), r).toBe(false);
    }
  });

  it("verlopen zegt dat het te lang duurde en dat opnieuw proberen kan, anders dan geen_album", () => {
    const t = videoFailMessage("verlopen");
    expect(t).not.toBe(videoFailMessage("geen_album"));
    expect(t).toMatch(/opnieuw/i);
    expect(t).not.toMatch(/album/i);
  });
});

describe("te_vaak: hooguit 30 aanvragen per 24 uur (A-invariant 36)", () => {
  it("de weigering van startUpload geeft te_vaak, niet server", () => {
    expect(startRefusalReason({ code: "VIDEO_UPLOAD_REFUSED", reason: "te_vaak" })).toBe("te_vaak");
  });

  it("de melding zegt dat het later weer kan", () => {
    expect(videoFailMessage("te_vaak")).toMatch(/later|morgen/i);
  });
});

describe("videoRetryRound: Filmpjes opnieuw proberen (A-invariant 33)", () => {
  type Item = { key: string; uploadId: string; state: "wacht" | "bezig" | "klaar" | "mislukt"; reason?: VideoFailReason };
  const items: Item[] = [
    { key: "a", uploadId: "ua", state: "mislukt", reason: "uitgelogd" },
    { key: "b", uploadId: "ub", state: "mislukt", reason: "netwerk" },
    { key: "c", uploadId: "uc", state: "mislukt", reason: "locatie" },
    { key: "d", uploadId: "ud", state: "klaar" },
    { key: "e", uploadId: "ue", state: "mislukt", reason: "uitgelogd" },
  ];

  it("de herhaalbare filmpjes weer op wacht, met dezelfde upload-id; de rest blijft", () => {
    const round = videoRetryRound(items);
    expect(round.items.map((i) => [i.key, i.uploadId, i.state])).toEqual([
      ["a", "ua", "wacht"],
      ["b", "ub", "wacht"],
      ["c", "uc", "mislukt"],
      ["d", "ud", "klaar"],
      ["e", "ue", "wacht"],
    ]);
  });

  it("fresh: precies de filmpjes die uitgelogd kregen (een vers token)", () => {
    expect([...videoRetryRound(items).fresh].sort()).toEqual(["a", "e"]);
  });

  it("niets uitgelogd: fresh is leeg", () => {
    expect([...videoRetryRound(items.filter((i) => i.reason !== "uitgelogd")).fresh]).toEqual([]);
  });
});

describe("finishOutcome: het antwoord van POST /upload/video (A-invariant 32)", () => {
  it("200 met een photoId: klaar", () => {
    expect(finishOutcome(200, { photoId: "p1" })).toEqual({ ok: true, photoId: "p1" });
  });

  it("404 verlopen en 404 geen_album zijn verschillende redenen", () => {
    expect(finishOutcome(404, { error: "x", reason: "verlopen" })).toEqual({ ok: false, reason: "verlopen" });
    expect(finishOutcome(404, { error: "x", reason: "geen_album" })).toEqual({ ok: false, reason: "geen_album" });
  });

  it("een 404 zonder (bekende) reden telt als verlopen", () => {
    expect(finishOutcome(404, { error: "x" })).toEqual({ ok: false, reason: "verlopen" });
    expect(finishOutcome(404, null)).toEqual({ ok: false, reason: "verlopen" });
    expect(finishOutcome(404, { reason: "iets" })).toEqual({ ok: false, reason: "verlopen" });
  });

  it("de andere antwoorden blijven", () => {
    expect(finishOutcome(null, null)).toEqual({ ok: false, reason: "netwerk" });
    expect(finishOutcome(401, {})).toEqual({ ok: false, reason: "uitgelogd" });
    expect(finishOutcome(403, {})).toEqual({ ok: false, reason: "limiet" });
    expect(finishOutcome(409, { reason: "niet_binnen" })).toEqual({ ok: false, reason: "niet_binnen" });
    expect(finishOutcome(413, {})).toEqual({ ok: false, reason: "te_groot" });
    expect(finishOutcome(422, { reason: "locatie" })).toEqual({ ok: false, reason: "locatie" });
    expect(finishOutcome(500, {})).toEqual({ ok: false, reason: "server" });
  });
});

describe("de albumkop telt filmpjes apart (A-invariant 34)", () => {
  it.each([
    [38, 2, "38 foto's · 2 filmpjes"],
    [38, 0, "38 foto's"],
    [0, 2, "2 filmpjes"],
    [1, 1, "1 foto · 1 filmpje"],
    [1, 0, "1 foto"],
    [0, 1, "1 filmpje"],
    [0, 0, "0 foto's"],
  ])("%i foto's en %i filmpjes → %s", (photos, videos, text) => {
    expect(mediaCountText(photos, videos)).toBe(text);
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

  it("de albumkop gebruikt mediaCountText (A-invariant 34)", () => {
    expect(read("screens/AlbumScreen.tsx")).toMatch(/\bmediaCountText\(/);
  });

  it("het toevoeg-scherm weigert vooraf met videoTooLongToSend (fixronde 3)", () => {
    expect(read("screens/AddPhotosScreen.tsx")).toMatch(/\bvideoTooLongToSend\(/);
  });

  it("retryVideos in het toevoeg-scherm gebruikt videoRetryRound (een lege fresh-set kan dan niet)", () => {
    const src = read("screens/AddPhotosScreen.tsx");
    const at = src.indexOf("function retryVideos");
    expect(at, "geen retryVideos gevonden").toBeGreaterThanOrEqual(0);
    expect(src.slice(at, at + 500)).toMatch(/\bvideoRetryRound\(/);
  });

  it("opnieuw proberen na uitgelogd geeft het filmpje een vers token mee (A-invariant 33)", () => {
    // De aanroep van de video-uploader in het toevoeg-scherm geeft freshToken mee, zoals bij foto's.
    const src = read("screens/AddPhotosScreen.tsx");
    const at = src.indexOf("uploadVideo({");
    expect(at, "geen aanroep van uploadVideo({ ... }) gevonden").toBeGreaterThanOrEqual(0);
    const call = src.slice(at, at + 600);
    expect(call).toMatch(/\bfreshToken\b/);
  });
});
