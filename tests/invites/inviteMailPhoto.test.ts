// @vitest-environment node
//
// WP19c A-invariant 1–7: de groepsfoto als inline-bijlage in de
// uitnodigingsmail. Spec: docs/work-packages/WP19c-uitnodigingsmail-opmaak.md.
//
// Deze file draait in Node met de echte sharp, om echte JPEG's te maken en de
// bijlage terug te lezen (zoals tests/photoFormats/images.test.ts). Het rode
// vlak is het herkenningspunt: in de ruwe pixels van *klein* staat het
// linksboven. Een mailclient past geen stand toe, dus de bijlage moet de stand
// al in de pixels hebben, zonder tag (A-invariant 4).

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { gpsAnywhere, isJpeg } from "../_helpers/jpeg";
import { newT, type T } from "../groups/_beheer";
import { inviteRow, secondGroup } from "./_wp19b";
import {
  clearMailEnv,
  expectNoPhoto,
  imgTags,
  mailEnv,
  mailFor,
  APPLE_APP_ID,
  seedCoverPhoto,
  setup,
  type Attachment,
  type Msg,
} from "./_wp19c";

beforeEach(() => mailEnv(APPLE_APP_ID));
afterEach(() => clearMailEnv());

// --- beelden -------------------------------------------------------------------------

type Rgb = [number, number, number];
const BLUE: Rgb = [0, 0, 255];
const GREEN: Rgb = [0, 200, 0];

/** Een JPEG met een rood vlak linksboven in de ruwe pixels; rest `fill`. */
async function jpeg(
  width: number,
  height: number,
  opts: { fill?: Rgb; gps?: boolean; quality?: number } = {},
): Promise<Uint8Array> {
  const fill = opts.fill ?? BLUE;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const red = x < width / 5 && y < height / 5;
      raw[i] = red ? 255 : fill[0];
      raw[i + 1] = red ? 0 : fill[1];
      raw[i + 2] = red ? 0 : fill[2];
    }
  }
  let img = sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: opts.quality ?? 85 });
  if (opts.gps) {
    img = img.withExif({
      IFD0: { Copyright: "Fotograaf X", Orientation: "1" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "52/1 6/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "6/1 0/1 0/1",
      },
    });
  }
  return new Uint8Array(await img.toBuffer());
}

/** Ruis: een JPEG die niet te comprimeren is (A-invariant 6). */
async function noise(width: number, height: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer());
}

type Seen = { width: number; height: number; x: number; y: number; center: Rgb };

/**
 * Wat een mailclient toont: de pixels zoals ze zijn, zonder stand toe te passen.
 * Het zwaartepunt van rood als fractie, plus de kleur in het midden.
 */
async function seen(bytes: Uint8Array): Promise<Seen> {
  const { data, info } = await sharp(Buffer.from(bytes)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i]! > 180 && data[i + 1]! < 80 && data[i + 2]! < 80) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  const c = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return {
    width: info.width,
    height: info.height,
    x: n ? sx / n / info.width : -1,
    y: n ? sy / n / info.height : -1,
    center: [data[c]!, data[c + 1]!, data[c + 2]!],
  };
}

/** De APPn-markers vóór de eerste scan (0xE0–0xEF). */
function appMarkers(b: Uint8Array): number[] {
  const out: number[] = [];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const m = b[i + 1]!;
    if (m === 0xda || m === 0xd9) break;
    if (m >= 0xe0 && m <= 0xef) out.push(m);
    i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
  }
  return out;
}

function closeTo(c: Rgb, want: Rgb): boolean {
  return c.every((v, k) => Math.abs(v - want[k]!) < 60);
}

// --- de mail ---------------------------------------------------------------------------

function onlyAttachment(msg: Msg): Attachment {
  expect(msg.Attachments ?? []).toHaveLength(0);
  expect(msg.InlinedAttachments ?? []).toHaveLength(1);
  return msg.InlinedAttachments![0]!;
}

function bytesOf(a: Attachment): Uint8Array {
  return new Uint8Array(Buffer.from(a.Base64Content ?? "", "base64"));
}

async function withCover(
  t: T,
  cover: Omit<Parameters<typeof seedCoverPhoto>[2], "original"> & { original?: Uint8Array },
  extra: Parameters<typeof setup>[1] = {},
) {
  const { w, inviteId } = await setup(t, extra);
  const seeded = await seedCoverPhoto(t, w, { original: cover.original ?? (await jpeg(1200, 900, { fill: GREEN })), ...cover });
  return { w, inviteId, seeded };
}

// ---------------------------------------------------------------------------

describe("A-invariant 1 — één inline-bijlage met cid:", () => {
  it("cover in een album van de groep: één image/jpeg met ContentID, één keer naar verwezen", async () => {
    const t = newT();
    const { inviteId } = await withCover(t, { klein: await jpeg(400, 300) });
    const msg = await mailFor(t, inviteId);

    const a = onlyAttachment(msg);
    expect(a.ContentType).toBe("image/jpeg");
    expect(a.ContentID ?? "").not.toBe("");
    expect(a.Filename ?? "").toMatch(/\.jpe?g$/i);
    expect(isJpeg(bytesOf(a))).toBe(true);

    const html = msg.HTMLPart ?? "";
    const cid = a.ContentID!;
    expect(html.split(`cid:${cid}`).length - 1).toBe(1);
    const imgs = imgTags(html);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toMatch(new RegExp(`src\\s*=\\s*["']cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
    expect(msg.TextPart ?? "").not.toMatch(/cid:/i);
  });

  it("de foto staat in de HTML vóór de aanhef", async () => {
    const t = newT();
    const { inviteId } = await withCover(t, { klein: await jpeg(400, 300) });
    const html = (await mailFor(t, inviteId)).HTMLPart ?? "";
    expect(html.search(/<img\b/i)).toBeGreaterThan(-1);
    expect(html.search(/<img\b/i)).toBeLessThan(html.indexOf("Hi Nina"));
  });

  for (const kind of ["accepted", "declined", "bounced"] as const) {
    it(`mail '${kind}' krijgt nooit een bijlage, ook niet met een cover`, async () => {
      const t = newT();
      const { inviteId } = await withCover(t, { klein: await jpeg(400, 300) });
      const msg = await mailFor(t, inviteId, kind);
      expectNoPhoto(msg);
    });
  }
});

describe("A-invariant 2 — niets verwijst naar de foto of de opslag", () => {
  it("geen foto-id, storage-id, token, Convex-host of beeldpad; bestandsnaam zonder groepsnaam", async () => {
    const t = newT();
    const { inviteId, seeded } = await withCover(t, { klein: await jpeg(400, 300) });
    const msg = await mailFor(t, inviteId);
    const a = onlyAttachment(msg);
    const token = (await inviteRow(t, inviteId))!.token;

    const parts = [msg.Subject ?? "", msg.HTMLPart ?? "", msg.TextPart ?? "", a.Filename ?? "", a.ContentID ?? ""];
    const ids = [seeded.photoId, seeded.original, seeded.klein!, seeded.groot!, token].map(String);
    for (const part of parts) {
      for (const id of ids) expect(part).not.toContain(id);
      expect(part).not.toMatch(/convex\.(cloud|site)/i);
      expect(part).not.toMatch(/\/beeld\//i);
    }
    expect(a.Filename ?? "").not.toMatch(/fotoclub/i);
  });
});

describe("A-invariant 3 — welke foto", () => {
  it("de bijlage is *klein*, niet het origineel", async () => {
    const t = newT();
    const { inviteId } = await withCover(t, {
      original: await jpeg(1200, 900, { fill: GREEN }),
      klein: await jpeg(400, 300, { fill: BLUE }),
    });
    const s = await seen(bytesOf(onlyAttachment(await mailFor(t, inviteId))));
    expect(s.width).toBeLessThanOrEqual(512);
    expect(closeTo(s.center, BLUE)).toBe(true);
  });

  it("niet *groot* als terugval: *klein* weg uit storage → geen foto", async () => {
    const t = newT();
    const { inviteId, seeded } = await withCover(t, {
      klein: await jpeg(400, 300),
      groot: await jpeg(1600, 1200),
    });
    await t.run(async (ctx) => ctx.storage.delete(seeded.klein as Id<"_storage">));
    const msg = await mailFor(t, inviteId);
    expectNoPhoto(msg);
    expect(msg.To?.[0]?.Email).toBe("nina@x.test");
  });

  it("foto zonder formaten → geen foto (niet het origineel)", async () => {
    const t = newT();
    const { inviteId } = await withCover(t, {});
    expectNoPhoto(await mailFor(t, inviteId));
  });

  it("groep zonder cover → geen foto, de mail gaat wel", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    const msg = await mailFor(t, inviteId);
    expectNoPhoto(msg);
    expect(msg.HTMLPart).toContain("Hi Nina");
  });

  it("cover in geen enkel album → geen foto", async () => {
    const t = newT();
    const { inviteId } = await withCover(t, { klein: await jpeg(400, 300), inAlbumOf: null });
    expectNoPhoto(await mailFor(t, inviteId));
  });

  it("cover alleen in een album van een andere groep → geen foto", async () => {
    const t = newT();
    const { w, inviteId } = await setup(t);
    const other = await secondGroup(t, w);
    await seedCoverPhoto(t, w, { original: await jpeg(800, 600), klein: await jpeg(400, 300), inAlbumOf: other });
    expectNoPhoto(await mailFor(t, inviteId));
  });

  it("de cover van een andere groep komt nooit in deze mail", async () => {
    const t = newT();
    const { w, inviteId } = await setup(t);
    const other = await secondGroup(t, w);
    await seedCoverPhoto(t, w, {
      original: await jpeg(800, 600),
      klein: await jpeg(400, 300),
      inAlbumOf: other,
      coverOf: other,
    });
    expectNoPhoto(await mailFor(t, inviteId));
  });
});

describe("A-invariant 4 — rechtop, zonder tag", () => {
  // Waar het rode vlak (ruw linksboven) staat als de stand is toegepast.
  const cases: Array<{ stand: number | undefined; right: boolean; bottom: boolean; swap: boolean }> = [
    { stand: undefined, right: false, bottom: false, swap: false },
    { stand: 1, right: false, bottom: false, swap: false },
    { stand: 3, right: true, bottom: true, swap: false },
    { stand: 6, right: true, bottom: false, swap: true },
    { stand: 8, right: false, bottom: true, swap: true },
  ];

  for (const c of cases) {
    it(`stand ${c.stand ?? "leeg"}: de pixels tonen de foto zoals in de app`, async () => {
      const t = newT();
      const { inviteId } = await withCover(t, {
        klein: await jpeg(400, 300),
        ...(c.stand !== undefined ? { exifOrientation: c.stand } : {}),
      });
      const bytes = bytesOf(onlyAttachment(await mailFor(t, inviteId)));
      expect(appMarkers(bytes)).not.toContain(0xe1);
      const s = await seen(bytes);
      expect(s.width > s.height).toBe(!c.swap);
      expect(s.x > 0.5).toBe(c.right);
      expect(s.y > 0.5).toBe(c.bottom);
    });
  }
});

describe("A-invariant 5 — alleen pixels", () => {
  it("*klein* met EXIF en GPS (tegen de regels in): de bijlage heeft geen APP1, geen IPTC, geen GPS", async () => {
    const t = newT();
    const klein = await jpeg(400, 300, { gps: true });
    expect(gpsAnywhere(klein)).toBeGreaterThan(0); // de invoer heeft echt GPS
    const { inviteId } = await withCover(t, { klein });
    const bytes = bytesOf(onlyAttachment(await mailFor(t, inviteId)));
    expect(isJpeg(bytes)).toBe(true);
    expect(gpsAnywhere(bytes)).toBe(0);
    const markers = appMarkers(bytes);
    expect(markers).not.toContain(0xe1); // EXIF / XMP
    expect(markers).not.toContain(0xed); // IPTC
    expect(new TextDecoder("latin1").decode(bytes)).not.toMatch(/Exif\0|Fotograaf X|http:\/\/ns\.adobe\.com/);
  });
});

describe("A-invariant 6 — grootte en breedte", () => {
  it("bijlage hoogstens 200 kB: te grote *klein* → geen foto of een kleinere bijlage, de mail gaat", async () => {
    const t = newT();
    const big = await noise(512, 512);
    expect(big.length).toBeGreaterThan(200_000); // de invoer is echt te groot
    const { inviteId } = await withCover(t, { klein: big });
    const msg = await mailFor(t, inviteId);
    expect(msg.To?.[0]?.Email).toBe("nina@x.test");
    for (const a of msg.InlinedAttachments ?? []) expect(bytesOf(a).length).toBeLessThanOrEqual(200_000);
    if ((msg.InlinedAttachments ?? []).length === 0) expectNoPhoto(msg);
  });

  it("nooit vergroot: een kleine *klein* blijft zijn eigen breedte, en `width` in de HTML is die breedte", async () => {
    const t = newT();
    const { inviteId } = await withCover(t, { klein: await jpeg(200, 150) });
    const msg = await mailFor(t, inviteId);
    const s = await seen(bytesOf(onlyAttachment(msg)));
    expect(s.width).toBe(200);
    const img = imgTags(msg.HTMLPart ?? "")[0]!;
    expect(img).toMatch(/\bwidth\s*=\s*["']?200["']?/i);
    expect(img).toMatch(/max-width\s*:\s*100%/i);
  });

  it("breedte hoogstens 512, `width` gelijk aan de bijlage", async () => {
    const t = newT();
    const { inviteId } = await withCover(t, { klein: await jpeg(512, 384) });
    const msg = await mailFor(t, inviteId);
    const s = await seen(bytesOf(onlyAttachment(msg)));
    expect(s.width).toBeLessThanOrEqual(512);
    const width = Number(/\bwidth\s*=\s*["']?(\d+)/i.exec(imgTags(msg.HTMLPart ?? "")[0]!)?.[1]);
    expect(width).toBe(s.width);
  });
});

describe("A-invariant 7 — de mail gaat altijd", () => {
  for (const [label, bytes] of [
    ["tekst in plaats van een beeld", new TextEncoder().encode("geen beeld")],
    ["een afgekapte JPEG", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a])],
    ["lege bytes", new Uint8Array()],
  ] as const) {
    it(`*klein* is ${label}: één mail, zonder foto, met de tekst`, async () => {
      const t = newT();
      const { inviteId } = await withCover(t, { klein: bytes });
      const msg = await mailFor(t, inviteId);
      expectNoPhoto(msg);
      expect(msg.To?.[0]?.Email).toBe("nina@x.test");
      for (const part of [msg.HTMLPart ?? "", msg.TextPart ?? ""]) {
        expect(part).toContain("Hi Nina");
        expect(part).toContain("De Fotoclub");
      }
    });
  }
});

describe("A-invariant 11 — de alt is HTML-veilig", () => {
  it("groepsnaam met quotes en tags breekt het img-attribuut niet", async () => {
    const t = newT();
    const { inviteId } = await withCover(
      t,
      { klein: await jpeg(400, 300) },
      { groupName: `Club "x" <b>y</b>` },
    );
    const img = imgTags((await mailFor(t, inviteId)).HTMLPart ?? "")[0]!;
    const alt = /\balt\s*=\s*"([^"]*)"/i.exec(img)?.[1] ?? "";
    expect(alt).toMatch(/^Groepsfoto van /);
    expect(alt).toContain("&quot;x&quot;");
    expect(alt).toContain("&lt;b&gt;");
    expect(img).not.toMatch(/<b>/);
  });
});
