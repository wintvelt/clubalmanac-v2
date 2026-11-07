// WP25 fix-cyclus 1 (besluit 7): HEIC's en grote JPEG's op de prod-bucket tellen.
// ALLEEN LEZEN: ListObjectsV2 en GetObject (met Range) op S3. Schrijft niets
// naar AWS, en lokaal alleen de tellingen naar scripts/.data/wp25/prod-tel.json.
//
// Draaien vanuit de repo-root, op de laptop met de AWS-profielen:
//   AWS_PROFILE=clubalmanac node scripts/wp25/prod-tel.mjs
// Optioneel: MIGRATE_S3_BUCKET (standaard blob-images), MIGRATE_AWS_REGION
// (standaard eu-central-1).
//
// Geen PII in de uitvoer: geen S3-sleutels of bestandsnamen, alleen soorten,
// maten en per object een korte hash van de sleutel (om een object later terug
// te vinden met dezelfde bucket-lijst).
//
// HEIC_MAX_PIXELS moet gelijk zijn aan de grens in convex/lib/photoFormats.ts
// (WP25 A-invariant 20). tests/photoFormats/prodTel.test.ts pint dat.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const HEIC_MAX_PIXELS = 13_000_000;
const KOP = 256 * 1024; // de kop: daar staan bij JPEG de SOF en bij HEIC de meta-box
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

const ascii = (b, from, to) => String.fromCharCode(...b.subarray(from, to));

/** "jpeg" | "png" | "heic" | "avif" | "webp" | "gif" | "onbekend" */
export function sniff(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 4 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return "png";
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12);
    if (HEIC_BRANDS.has(brand)) return "heic";
    if (brand === "avif" || brand === "avis") return "avif";
    return "onbekend";
  }
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (b.length >= 3 && ascii(b, 0, 3) === "GIF") return "gif";
  return "onbekend";
}

const u32 = (b, o) => b.readUInt32BE(o);
const u16 = (b, o) => b.readUInt16BE(o);

/** Kinderen van een ISO-BMFF-box tussen [start, end). */
function* boxes(b, start, end) {
  let o = start;
  while (o + 8 <= end) {
    let size = u32(b, o);
    const type = ascii(b, o + 4, o + 8);
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) return;
      size = Number(b.readBigUInt64BE(o + 8));
      header = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < header || o + size > end) return;
    yield { type, start: o + header, end: o + size };
    o += size;
  }
}

/**
 * De maat van het primaire beeld van een HEIF (de `ispe` van het item uit
 * `pitm`), of null als de meta-box niet (volledig) in `b` staat. Bij een HEIC
 * met tegels is dat de maat van het `grid`-item: het hele beeld.
 */
export function heifSize(b) {
  const meta = [...boxes(b, 0, b.length)].find((x) => x.type === "meta");
  if (!meta) return null;
  const inner = [...boxes(b, meta.start + 4, meta.end)]; // meta is een full box
  const pitm = inner.find((x) => x.type === "pitm");
  const iprp = inner.find((x) => x.type === "iprp");
  if (!pitm || !iprp) return null;
  const pitmVersion = b[pitm.start];
  const primary = pitmVersion === 0 ? u16(b, pitm.start + 4) : u32(b, pitm.start + 4);
  const props = [...boxes(b, iprp.start, iprp.end)];
  const ipco = props.find((x) => x.type === "ipco");
  const ipma = props.find((x) => x.type === "ipma");
  if (!ipco || !ipma) return null;
  const list = [...boxes(b, ipco.start, ipco.end)];

  const version = b[ipma.start];
  const flags = b.readUIntBE(ipma.start + 1, 3);
  let o = ipma.start + 4;
  const count = u32(b, o);
  o += 4;
  for (let i = 0; i < count; i++) {
    const itemId = version < 1 ? u16(b, o) : u32(b, o);
    o += version < 1 ? 2 : 4;
    const n = b[o];
    o += 1;
    for (let j = 0; j < n; j++) {
      const index = flags & 1 ? u16(b, o) & 0x7fff : b[o] & 0x7f;
      o += flags & 1 ? 2 : 1;
      if (itemId !== primary || index === 0) continue;
      const prop = list[index - 1];
      if (prop?.type === "ispe") return { width: u32(b, prop.start + 4), height: u32(b, prop.start + 8) };
    }
  }
  return null;
}

/** De maat uit de SOF-marker van een JPEG, of null als die niet in `b` staat. */
export function jpegSize(b) {
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1];
    if (marker === 0xff) {
      o += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += 2;
      continue;
    }
    const length = u16(b, o + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (o + 9 > b.length) return null;
      return { height: u16(b, o + 5), width: u16(b, o + 7) };
    }
    if (marker === 0xda) return null; // begin van de beelddata zonder SOF ervoor
    o += 2 + length;
  }
  return null;
}

const hash = (key) => createHash("sha256").update(key).digest("hex").slice(0, 12);
const mp = (s) => Math.round(((s.width * s.height) / 1e6) * 10) / 10;

async function main() {
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const BUCKET = process.env.MIGRATE_S3_BUCKET ?? "blob-images";
  const REGION = process.env.MIGRATE_AWS_REGION ?? "eu-central-1";
  const s3 = new S3Client({ region: REGION });
  const get = async (Key, Range) => {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key, ...(Range ? { Range } : {}) }));
    return Buffer.from(await r.Body.transformToByteArray());
  };

  const objects = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token }));
    for (const o of r.Contents ?? []) objects.push({ key: o.Key, size: o.Size ?? 0 });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  console.error(`[prod-tel] ${objects.length} objecten in ${BUCKET} (alleen lezen)`);

  const inc = (o, k) => (o[k] = (o[k] ?? 0) + 1);
  const out = {
    bucket: BUCKET,
    heicMaxPixels: HEIC_MAX_PIXELS,
    objecten: objects.length,
    soort: {},
    heic: { aantal: 0, boven: 0, maatOnbekend: 0, perMP: {}, lijst: [] },
    grootsteJpeg: [],
  };
  const jpegs = [];
  let i = 0;
  for (const { key, size } of objects) {
    i += 1;
    if (i % 200 === 0) console.error(`[prod-tel] ${i}/${objects.length}`);
    if (size === 0) {
      inc(out.soort, "leeg");
      continue;
    }
    let b = await get(key, `bytes=0-${KOP - 1}`);
    const soort = sniff(b);
    inc(out.soort, soort);
    if (soort !== "heic" && soort !== "jpeg") continue;
    const read = soort === "heic" ? heifSize : jpegSize;
    let s = read(b);
    if (!s && size > KOP) {
      b = await get(key);
      s = read(b);
    }
    if (soort === "heic") {
      out.heic.aantal += 1;
      if (!s) {
        out.heic.maatOnbekend += 1;
        continue;
      }
      const pixels = s.width * s.height;
      if (pixels > HEIC_MAX_PIXELS) out.heic.boven += 1;
      inc(out.heic.perMP, String(Math.ceil(pixels / 1e6)));
      out.heic.lijst.push({ id: hash(key), width: s.width, height: s.height, mp: mp(s), bytes: size, boven: pixels > HEIC_MAX_PIXELS });
    } else if (s) {
      jpegs.push({ id: hash(key), width: s.width, height: s.height, mp: mp(s), bytes: size });
    }
  }
  out.heic.lijst.sort((a, b) => b.mp - a.mp);
  out.grootsteJpeg = jpegs.sort((a, b) => b.mp - a.mp || b.bytes - a.bytes).slice(0, 10);

  console.log(JSON.stringify({ ...out, heic: { ...out.heic, lijst: out.heic.lijst.slice(0, 20) } }, null, 1));
  const dir = join(process.cwd(), "scripts/.data/wp25");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "prod-tel.json"), JSON.stringify(out, null, 1));
  console.error(
    `[prod-tel] klaar: ${out.heic.aantal} HEIC, waarvan ${out.heic.boven} boven ${HEIC_MAX_PIXELS / 1e6} MP ` +
      `en ${out.heic.maatOnbekend} zonder leesbare maat → scripts/.data/wp25/prod-tel.json`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`[prod-tel] mislukt: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
