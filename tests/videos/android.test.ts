import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { afterIndexHeader, inspectMp4, mp4IndexEnd, videoProblem } from "../../convex/lib/mp4";
import { as, fullUpload, newT, seedWorld, useVideosEnv, type R, type T } from "./_videos";

// WP42b — door Android gemaakte filmpjes tegen de bestaande mp4-controle van
// de backend (invariant 1 en 2: "zonder uitzondering voor Android"; de
// backend verandert niet). Bewakers: groen nu, en ze laten zien waar een
// Android-bestand tegen de controle loopt.
//   - Media3 Transformer met alle metadata weg: door de controle, ook de route.
//   - Media3 met de standaardmuxer neemt de plaats van het origineel over
//     (`©xyz` in de vorm "+52.3676+4.9041/"): `locatie` (A15).
//   - Een origineel van MediaMuxer (zoals de camera) heeft de plaats en bij
//     3 minuten de index achteraan: nooit zo versturen (A15).
//   - 3:00,349 in, na verkleinen 180 280 ms volgens de backend: binnen de
//     grens van 180 499 ms; de index (131 KB) vooraan (A19).
// Hoe de bestanden gemaakt zijn: tests/fixtures/wp42b/README.md.
// Spec: docs/work-packages/WP42-android.md §Spec-criticus aanvullingen 42b.

function android(name: string): Uint8Array<ArrayBuffer> {
  const raw = readFileSync(fileURLToPath(new URL(`../fixtures/wp42b/${name}`, import.meta.url)));
  const out = new Uint8Array(new ArrayBuffer(raw.byteLength));
  out.set(raw);
  return out;
}

type Info = Extract<ReturnType<typeof inspectMp4>, { ok: true }>["info"];

function info(bytes: Uint8Array): Info {
  const r = inspectMp4(bytes);
  expect(r.ok, `verwacht een leesbaar bestand, kreeg ${JSON.stringify(r)}`).toBe(true);
  return (r as { ok: true; info: Info }).info;
}

/** De koppen na de index, zoals de route ze afloopt (A-invariant 31): klopt alles tot het einde? */
function afterIndexOk(b: Uint8Array): boolean {
  let offset = mp4IndexEnd(b);
  if (offset === null) return false;
  for (let n = 0; n < 32 && offset < b.length; n++) {
    const end = afterIndexHeader(b.slice(offset, offset + 16), offset, b.length);
    if (end === null || end <= offset) return false;
    offset = end;
  }
  return offset === b.length;
}

/** Het begin zoals de backend het uit R2 leest (512 KiB). */
const head = (b: Uint8Array) => b.slice(0, 512 * 1024);

describe("Media3 Transformer zonder metadata haalt de controle (invariant 1)", () => {
  it.each(["media3-schoon.mp4", "media3-zonder-geluid.mp4"])("%s: mp4, H.264, AAC of geen geluid, geen plaats, index vooraan", (name) => {
    const file = android(name);
    const i = info(head(file));
    expect(i.brand).toBe("isom");
    expect(i.video?.codec).toBe("avc1");
    expect(i.tracks.filter((t) => t.handler === "soun").every((t) => t.codec === "mp4a")).toBe(true);
    expect(i.hasLocation).toBe(false);
    expect(videoProblem(inspectMp4(head(file)), file.byteLength)).toBeNull();
    // Na de index alleen `free` (de gereserveerde ruimte) en `mdat`.
    expect(afterIndexOk(file)).toBe(true);
  });

  it("de duur is de langste in het bestand: 2067 ms, zoals het origineel (de AAC-aanloop)", () => {
    expect(info(head(android("media3-schoon.mp4"))).durationMs).toBe(2067);
  });

  it("een staand filmpje: Media3 codeert het liggend (192 × 108) met een draai-matrix; de controle kijkt er niet naar", () => {
    expect(info(head(android("media3-schoon.mp4"))).video).toEqual({ codec: "avc1", width: 192, height: 108 });
  });
});

describe("waar een Android-bestand tegen de controle loopt (A15)", () => {
  it("Media3 met de standaardmuxer neemt de plaats van het origineel over: locatie", () => {
    const file = android("media3-met-plaats.mp4");
    expect(info(head(file)).hasLocation).toBe(true);
    expect(videoProblem(inspectMp4(head(file)), file.byteLength)).toBe("locatie");
  });

  it.each([
    "android-muxer-plaats.mp4",
    "android-muxer-zuid-oost.mp4",
    "android-muxer-noord-west.mp4",
    "android-muxer-staand.mp4",
  ])("een origineel van MediaMuxer met plaats (%s): locatie", (name) => {
    const file = android(name);
    expect(videoProblem(inspectMp4(head(file)), file.byteLength)).toBe("locatie");
  });

  it("een origineel van MediaMuxer van 3 minuten: de index staat achteraan", () => {
    expect(inspectMp4(android("android-muxer-180s-begin.bin"))).toEqual({ ok: false, reason: "index_achteraan" });
  });
});

describe("3 minuten na verkleinen met Media3 (A19)", () => {
  const file = android("media3-180s-begin.bin");
  const SIZE = 6_473_153;

  it("de index staat vooraan en past ruim in het eerste stuk", () => {
    const end = mp4IndexEnd(file);
    expect(end).not.toBeNull();
    expect(end!).toBeLessThan(200 * 1024);
  });

  it("3:00,349 in, 180 280 ms volgens de backend: onder de grens van 180 499 ms", () => {
    const i = info(file);
    expect(i.durationMs).toBe(180_280);
    expect(videoProblem(inspectMp4(file), SIZE)).toBeNull();
  });
});

describe("de route neemt een filmpje van Media3 aan (invariant 1, de backend verandert niet)", () => {
  const env = useVideosEnv();

  async function rowOf(t: T, photoId: string): Promise<R | null> {
    return (await t.run(async (ctx) => ctx.db.get(photoId as Id<"photos">))) as R | null;
  }

  it("200; duur 2067 ms en de grootte van het bestand in de rij; datum en plaats alleen uit de headers", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const file = android("media3-schoon.mp4");
    const { res } = await fullUpload(as.alice(t), env.r2, {
      uploadId: "android-1",
      albumId: w.albums.georgie,
      file,
      durationMs: 2067,
      headers: { "X-Taken-At": "2026:07:14 15:32:10", "X-Latitude": "52.3676", "X-Longitude": "4.9041" },
    });
    expect(res.status).toBe(200);
    const { photoId } = (await res.json()) as R;
    const row = (await rowOf(t, photoId))!;
    expect(row.video).toEqual({ key: row.video.key, durationMs: 2067, bytes: file.byteLength });
    expect(row.latitude).toBe(52.3676);
    expect(row.longitude).toBe(4.9041);
  });

  it("Media3 met de plaats van het origineel: 422 locatie, niets blijft staan", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { res, key } = await fullUpload(as.alice(t), env.r2, {
      uploadId: "android-2",
      albumId: w.albums.georgie,
      file: android("media3-met-plaats.mp4"),
      durationMs: 2067,
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as R).reason).toBe("locatie");
    expect(env.r2.objects.has(key)).toBe(false);
  });
});
