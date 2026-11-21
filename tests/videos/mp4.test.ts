import { existsSync, openSync, readSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inspectMp4, videoProblem } from "../../convex/lib/mp4";
import { MAX_OPEN_VIDEO_UPLOADS, MAX_VIDEO_BYTES, MAX_VIDEO_MS } from "../../convex/lib/constants";
import { fixture, MAX_VIDEO_BYTES_ORACLE } from "./_videos";
import { ascii, box, ftyp, full, mdat, mdtaMeta, movie, mvhd, trak, u16, u32, zeros } from "./_boxes";

// WP37 — de backend bekijkt het bestand zelf (invariant 2 en 7, A-invariant
// 12, 13, 25). `inspectMp4` krijgt het begin van het bestand zoals de backend
// het uit R2 leest; `videoProblem` zegt of het filmpje erin mag.
//
// Twee onafhankelijke bronnen (anti-pattern "gedeelde bron"):
//   - testfilmpjes van AVFoundation (tests/fixtures/wp37, zie de README):
//     wat een echte encoder schrijft, inclusief de vorm die we niet zelf
//     bedachten (in .mp4 wordt een locatie een binair `loci`-blok);
//   - met de hand gebouwde blokken hieronder, voor randgevallen (lange duur,
//     64-bit mvhd, metadata-spoor, locatie op spoor-niveau, "location" in de
//     beelddata).
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §Testcontract.

type Info = Extract<ReturnType<typeof inspectMp4>, { ok: true }>["info"];

function info(bytes: Uint8Array): Info {
  const r = inspectMp4(bytes);
  expect(r.ok, `verwacht een leesbaar bestand, kreeg ${JSON.stringify(r)}`).toBe(true);
  return (r as { ok: true; info: Info }).info;
}

// --- testfilmpjes van AVFoundation -------------------------------------------

describe("inspectMp4 op testfilmpjes van AVFoundation", () => {
  it("plain.mp4: mp42, 2 s, H.264 108×192, AAC, geen locatie", () => {
    const i = info(fixture("plain.mp4"));
    expect(i.brand).toBe("mp42");
    expect(i.durationMs).toBe(2000);
    expect(i.video).toEqual({ codec: "avc1", width: 108, height: 192 });
    expect(i.audio).toEqual({ codec: "mp4a" });
    expect(i.hasLocation).toBe(false);
  });

  it("noaudio.mp4: geen geluidsspoor", () => {
    const i = info(fixture("noaudio.mp4"));
    expect(i.audio).toBeNull();
    expect(i.video?.codec).toBe("avc1");
    expect(i.durationMs).toBe(2000);
  });

  it("hevc.mp4: codec hvc1", () => {
    expect(info(fixture("hevc.mp4")).video?.codec).toBe("hvc1");
  });

  it("date-only.mp4: een datum is geen locatie", () => {
    expect(info(fixture("date-only.mp4")).hasLocation).toBe(false);
  });

  it("location-loci.mp4: de locatie als binair `loci`-blok (zo schrijft AVFoundation hem in mp4)", () => {
    expect(info(fixture("location-loci.mp4")).hasLocation).toBe(true);
  });

  it("location-loci-date.mp4: locatie plus datum", () => {
    expect(info(fixture("location-loci-date.mp4")).hasLocation).toBe(true);
  });

  it("iphone-like.mov: QuickTime met ©xyz en com.apple.quicktime.location.ISO6709", () => {
    const i = info(fixture("iphone-like.mov"));
    expect(i.brand).toBe("qt  ");
    expect(i.hasLocation).toBe(true);
  });

  it("moov-at-end.mp4: index achteraan, ook als het hele bestand er is", () => {
    expect(inspectMp4(fixture("moov-at-end.mp4"))).toEqual({ ok: false, reason: "index_achteraan" });
  });

  it("alleen het begin van een bestand met de index achteraan: index_achteraan", () => {
    expect(inspectMp4(fixture("moov-at-end.mp4").subarray(0, 2000))).toEqual({ ok: false, reason: "index_achteraan" });
  });

  it("het begin van plain.mp4 tot net na de index is genoeg", () => {
    const bytes = fixture("plain.mp4");
    // ftyp (28) + moov (1895): de beelddata erna hoeft er niet bij.
    expect(info(bytes.subarray(0, 28 + 1895)).durationMs).toBe(2000);
  });
});

// --- geen mp4 -------------------------------------------------------------------

describe("inspectMp4: geen ISO-BMFF", () => {
  it.each([
    ["leeg", new Uint8Array()],
    ["JPEG", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii("JFIF")])],
    ["tekst", new Uint8Array(ascii("<html><body>geen video</body></html>"))],
    ["afgekapt ftyp", new Uint8Array([0, 0, 0, 0x20, ...ascii("ftyp")])],
  ])("%s → geen_mp4", (_naam, bytes) => {
    expect(inspectMp4(bytes)).toEqual({ ok: false, reason: "geen_mp4" });
  });

  it("een blok met een onmogelijke grootte geeft geen fout maar een weigering", () => {
    const bad = new Uint8Array([...ftyp("mp42"), ...u32(0xfffffff0), ...ascii("moov"), ...zeros(16)]);
    const r = inspectMp4(bad);
    expect(r.ok).toBe(false);
  });
});

// --- met de hand gebouwd ----------------------------------------------------------

describe("inspectMp4: duur uit mvhd", () => {
  it("timescale 600, 108300 → 180500 ms", () => {
    expect(info(movie({ timescale: 600, duration: 108_300 })).durationMs).toBe(180_500);
  });

  it("64-bit mvhd (versie 1)", () => {
    expect(info(movie({ mvhdVersion: 1, timescale: 90_000, duration: 90_000 * 95 })).durationMs).toBe(95_000);
  });

  it("afgerond op de milliseconde", () => {
    expect(info(movie({ timescale: 3, duration: 1 })).durationMs).toBe(333);
  });

  it("een index ná de beelddata (mdat eerst): index_achteraan", () => {
    expect(inspectMp4(movie({ mdatFirst: true }))).toEqual({ ok: false, reason: "index_achteraan" });
  });

  it("een `free`- of `wide`-blok vóór de index mag", () => {
    const bytes = new Uint8Array([...ftyp("isom"), ...box("free", zeros(8)), ...box("moov", mvhd(600, 600), trak("vide", "avc1")), ...mdat()]);
    expect(info(bytes).durationMs).toBe(1000);
  });
});

describe("inspectMp4: locatie in elke vorm (A-invariant 13)", () => {
  const xyz = box("\xa9xyz", u16(18), u16(0x15c7), ascii("+52.3676+004.9041/"));
  const loci = box("loci", full(0), u16(0x55c4), [0], u32(0x3436), u32(0x4e7), u32(0), ascii("earth"), [0], [0]);

  it("geen metadata: geen locatie", () => {
    expect(info(movie()).hasLocation).toBe(false);
  });

  it("©xyz in moov/udta (ook in een mp4)", () => {
    expect(info(movie({ moovExtra: [box("udta", xyz)] })).hasLocation).toBe(true);
  });

  it("loci in moov/udta", () => {
    expect(info(movie({ moovExtra: [box("udta", loci)] })).hasLocation).toBe(true);
  });

  it("©xyz in de udta van een spoor", () => {
    const tracks = [trak("vide", "avc1", box("udta", xyz)), trak("soun", "mp4a")];
    expect(info(movie({ tracks })).hasLocation).toBe(true);
  });

  it("mdta-sleutel com.apple.quicktime.location.ISO6709", () => {
    expect(info(movie({ moovExtra: [mdtaMeta("com.apple.quicktime.location.ISO6709")] })).hasLocation).toBe(true);
  });

  it("alleen een andere locatie-sleutel (nauwkeurigheid) telt ook", () => {
    expect(info(movie({ moovExtra: [mdtaMeta("com.apple.quicktime.location.accuracy.horizontal")] })).hasLocation).toBe(true);
  });

  it("mdta-sleutels zonder locatie (merk, model, datum): geen locatie", () => {
    const meta = mdtaMeta("com.apple.quicktime.make", "com.apple.quicktime.model", "com.apple.quicktime.creationdate");
    expect(info(movie({ moovExtra: [meta] })).hasLocation).toBe(false);
  });

  it("een metadata-spoor (hdlr `meta`) telt als locatie, ook zonder te weten wat erin zit", () => {
    const tracks = [trak("vide", "avc1"), trak("soun", "mp4a"), trak("meta", "mebx")];
    expect(info(movie({ tracks })).hasLocation).toBe(true);
  });

  it("'©xyz' en 'location' in de beelddata ná de index zijn geen metadata", () => {
    const after = mdat([...xyz, ...ascii("com.apple.quicktime.location.ISO6709"), ...zeros(32)]);
    expect(info(movie({ after })).hasLocation).toBe(false);
  });
});

describe("inspectMp4: sporen", () => {
  it("geen beeldspoor: video null", () => {
    expect(info(movie({ tracks: [trak("soun", "mp4a")] })).video).toBeNull();
  });

  it("de breedte en hoogte uit tkhd", () => {
    expect(info(movie({ tracks: [trak("vide", "avc1", [], 1080, 1920)] })).video).toEqual({ codec: "avc1", width: 1080, height: 1920 });
  });
});

// --- videoProblem -------------------------------------------------------------

describe("videoProblem (A-invariant 12, A-keuzes)", () => {
  const ok = () => inspectMp4(movie({ timescale: 1000, duration: 60_000 }));
  const SIZE = 30_000_000;

  it("de grenzen zijn die uit de spec (los van de code uitgeschreven)", () => {
    expect(MAX_VIDEO_MS).toBe(180_000);
    expect(MAX_VIDEO_BYTES).toBe(MAX_VIDEO_BYTES_ORACLE);
    expect(MAX_OPEN_VIDEO_UPLOADS).toBe(3);
  });

  it("een mp4 met H.264 en AAC, 1 minuut, 30 MB: geen probleem", () => {
    expect(videoProblem(ok(), SIZE)).toBeNull();
  });

  it("zonder geluid mag", () => {
    expect(videoProblem(inspectMp4(fixture("noaudio.mp4")), 4000)).toBeNull();
  });

  it.each(["mp42", "isom", "mp41", "avc1", "iso2"])("merk %s mag", (brand) => {
    expect(videoProblem(inspectMp4(movie({ brand })), SIZE)).toBeNull();
  });

  it("QuickTime (qt  ) is geen mp4", () => {
    expect(videoProblem(inspectMp4(movie({ brand: "qt  " })), SIZE)).toBe("geen_mp4");
  });

  it("geen ISO-BMFF: geen_mp4", () => {
    expect(videoProblem(inspectMp4(new Uint8Array(ascii("hallo"))), 5)).toBe("geen_mp4");
  });

  it("index achteraan", () => {
    expect(videoProblem(inspectMp4(fixture("moov-at-end.mp4")), 11_430)).toBe("index_achteraan");
  });

  it("met locatie: locatie", () => {
    expect(videoProblem(inspectMp4(fixture("location-loci.mp4")), 11_455)).toBe("locatie");
  });

  it("HEVC: codec", () => {
    expect(videoProblem(inspectMp4(fixture("hevc.mp4")), 11_419)).toBe("codec");
  });

  it("geen beeldspoor: codec", () => {
    expect(videoProblem(inspectMp4(movie({ tracks: [trak("soun", "mp4a")] })), SIZE)).toBe("codec");
  });

  it("geluid dat geen AAC is: codec", () => {
    expect(videoProblem(inspectMp4(movie({ tracks: [trak("vide", "avc1"), trak("soun", "ac-3")] })), SIZE)).toBe("codec");
  });

  it("3:00,499 mag (afgerond 3:00), 3:00,500 is te lang", () => {
    expect(videoProblem(inspectMp4(movie({ timescale: 1000, duration: 180_499 })), SIZE)).toBeNull();
    expect(videoProblem(inspectMp4(movie({ timescale: 1000, duration: 180_500 })), SIZE)).toBe("te_lang");
    expect(videoProblem(inspectMp4(movie({ timescale: 1000, duration: 600_000 })), SIZE)).toBe("te_lang");
  });

  it("precies 120 MiB mag, één byte meer is te groot", () => {
    expect(videoProblem(ok(), MAX_VIDEO_BYTES_ORACLE)).toBeNull();
    expect(videoProblem(ok(), MAX_VIDEO_BYTES_ORACLE + 1)).toBe("te_groot");
  });

  it("een .mov met locatie wordt geweigerd (als geen mp4)", () => {
    expect(videoProblem(inspectMp4(fixture("iphone-like.mov")), 12_003)).toBe("geen_mp4");
  });
});

// --- Wouters voorbeeld (lokaal; gitignored, in CI overgeslagen) ---------------

const SAMPLE = fileURLToPath(new URL("../../builds/video/daatfilmpje.mp4", import.meta.url));

describe.skipIf(!existsSync(SAMPLE))("Wouters voorbeeld (alleen lokaal)", () => {
  it("het begin (1 MiB) is genoeg; 72,8 s, H.264 1080×1920, AAC, geen locatie, mag erin", () => {
    const fd = openSync(SAMPLE, "r");
    const head = new Uint8Array(1024 * 1024);
    readSync(fd, head, 0, head.length, 0);
    closeSync(fd);
    const r = inspectMp4(head);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.abs(r.info.durationMs - 72_800)).toBeLessThan(100);
    expect(r.info.video).toEqual({ codec: "avc1", width: 1080, height: 1920 });
    expect(r.info.audio).toEqual({ codec: "mp4a" });
    expect(r.info.hasLocation).toBe(false);
    expect(videoProblem(r, 33_509_535)).toBeNull();
  });
});
