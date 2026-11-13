// WP17d besluit 4: hebben de losse profielbeelden op prod data na het eerste
// beeld, een MPF-blok, of een structuur die een strikte schoonmaker niet
// begrijpt? ALLEEN LEZEN.
//
// De 7 losse profielbeelden (een profielfoto zonder foto-rij) zijn de
// standaard-knorren van v1: `public/img/knorren/knor<n>.jpg`, bij het aanmaken
// van een account willekeurig toegewezen (blob-images-api-user, createUser).
// Het script telt alle knorren in de bucket, en zegt welke als profielfoto in
// gebruik zijn (uit het DynamoDB-extract). Het toont alleen bestandsnamen van
// knorren en tellingen; geen user-ids, namen of plekken.
//
// Draaien vanuit de repo-root, met AWS-credentials (read-only) in de omgeving:
//   node scripts/wp17d/profiel-tel.mjs scripts/.data/dynamo-extract.json
// Doet alleen ListObjectsV2 en GetObject op S3. Optioneel: MIGRATE_S3_BUCKET
// (standaard blob-images), MIGRATE_AWS_REGION (standaard eu-central-1).
//
// Lokaal toetsen, zonder S3: KNOR_DIR=<map met .jpg-bestanden> node … <extract>
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "package.json"));
const extractPath = process.argv[2];
if (!extractPath) {
  console.error("gebruik: node scripts/wp17d/profiel-tel.mjs <pad-naar>/dynamo-extract.json");
  process.exit(1);
}
const PREFIX = "public/img/knorren/";

// --- Welke knorren zijn in gebruik (uit het extract) ----------------------------------
const { items } = JSON.parse(readFileSync(extractPath, "utf8"));
const photoUrls = new Set(items.filter((i) => (i.PK ?? "").startsWith("PO")).map((i) => i.url));
// Een user staat er twee keer in (US… en UB…, SK = de user): tel per SK.
const usersOf = new Map(); // knor-naam -> Set(SK)
for (const i of items) {
  if (!i.photoUrl || !/^U[SB]/.test(i.PK ?? "") || photoUrls.has(i.photoUrl)) continue;
  const name = i.photoUrl.startsWith(PREFIX) ? i.photoUrl.slice(PREFIX.length) : `(ander los beeld)`;
  if (!usersOf.has(name)) usersOf.set(name, new Set());
  usersOf.get(name).add(i.SK);
}
const inUse = new Map([...usersOf].map(([name, users]) => [name, users.size]));

// --- Bestanden ophalen (S3 of lokaal) -------------------------------------------------
async function files() {
  if (process.env.KNOR_DIR) {
    const dir = process.env.KNOR_DIR;
    return readdirSync(dir)
      .filter((n) => /\.(jpe?g|png)$/i.test(n))
      .map((name) => ({ name, bytes: () => new Uint8Array(readFileSync(join(dir, name))) }));
  }
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");
  const Bucket = process.env.MIGRATE_S3_BUCKET ?? "blob-images";
  const s3 = new S3Client({ region: process.env.MIGRATE_AWS_REGION ?? "eu-central-1" });
  const keys = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: PREFIX, ContinuationToken: token }));
    for (const o of r.Contents ?? []) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  console.error(`[profiel-tel] ${keys.length} knorren in ${Bucket} (read-only)`);
  return keys.map((Key) => ({
    name: Key.slice(PREFIX.length),
    bytes: async () => new Uint8Array(await (await s3.send(new GetObjectCommand({ Bucket, Key }))).Body.transformToByteArray()),
  }));
}

// --- Analyse (dezelfde regels als tests/_helpers/jpeg.ts) ------------------------------
const isJpeg = (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

function tiffHasGps(b, at) {
  const t = (k) => b[at + k] ?? 0;
  const little = t(0) === 0x49 && t(1) === 0x49 && t(2) === 0x2a && t(3) === 0;
  const big = t(0) === 0x4d && t(1) === 0x4d && t(2) === 0 && t(3) === 0x2a;
  if (!little && !big) return false;
  const u16 = (o) => (little ? t(o) | (t(o + 1) << 8) : (t(o) << 8) | t(o + 1));
  const u32 = (o) =>
    little ? (t(o) | (t(o + 1) << 8) | (t(o + 2) << 16) | (t(o + 3) << 24)) >>> 0 : ((t(o) << 24) | (t(o + 1) << 16) | (t(o + 2) << 8) | t(o + 3)) >>> 0;
  const ifd0 = u32(4);
  if (at + ifd0 + 2 > b.length) return false;
  const n = u16(ifd0);
  for (let k = 0; k < n && at + ifd0 + 2 + k * 12 + 2 <= b.length; k++) if (u16(ifd0 + 2 + k * 12) === 0x8825) return true;
  return false;
}

function gpsAt(b, from, to) {
  let hits = 0;
  for (let i = from; i + 8 <= to; i++) if (tiffHasGps(b, i)) hits++;
  const ascii = Buffer.from(b.subarray(from, to)).toString("latin1");
  return hits + (ascii.match(/GPSLatitude|GPSLongitude/g) ?? []).length;
}

/** Volgt de segmenten van het eerste beeld. */
function walk(b) {
  const out = { markers: [], app: [], mpf: false, xmp: false, exif: false, end: null, fout: null };
  let i = 2;
  for (;;) {
    let fill = 0;
    while (i < b.length && b[i] === 0xff && b[i + 1] === 0xff) { i++; fill++; }
    if (fill) out.markers.push(`opvul×${fill}`);
    if (i + 1 >= b.length) return { ...out, fout: "einde zonder EOI" };
    if (b[i] !== 0xff) return { ...out, fout: `geen marker op ${i}` };
    const m = b[i + 1];
    if (m === 0xd9) return { ...out, end: i + 2 };
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (i + 3 >= b.length) return { ...out, fout: "lengte buiten het bestand" };
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return { ...out, fout: "lengte buiten het bestand" };
    const body = Buffer.from(b.subarray(i + 4, Math.min(i + 2 + len, i + 40))).toString("latin1");
    if (m >= 0xe0 && m <= 0xef) {
      const id = body.split("\0")[0].slice(0, 28);
      out.app.push(`APP${m - 0xe0}:${id}`);
      if (m === 0xe2 && body.startsWith("MPF\0")) out.mpf = true;
      if (m === 0xe1 && body.startsWith("Exif\0\0")) out.exif = true;
      if (m === 0xe1 && body.startsWith("http://ns.adobe.com/xap")) out.xmp = true;
    } else if (![0xc0, 0xc1, 0xc2, 0xc4, 0xda, 0xdb, 0xdd, 0xfe].includes(m)) {
      out.markers.push(`0x${m.toString(16)}`);
    }
    i += 2 + len;
    if (m === 0xda) {
      for (;;) {
        if (i + 1 >= b.length) return { ...out, fout: "beelddata zonder einde" };
        if (b[i] === 0xff) {
          const n = b[i + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { i += 2; continue; }
          break;
        }
        i++;
      }
    }
  }
}

function analyse(b) {
  if (!isJpeg(b)) {
    const head = Buffer.from(b.subarray(0, 12)).toString("latin1").replace(/[^\x20-\x7e]/g, ".");
    return { type: `geen JPEG (${head})`, bytes: b.length, gpsTotaal: gpsAt(b, 0, b.length) };
  }
  const w = walk(b);
  const end = w.end ?? b.length;
  const na = w.end === null ? null : b.length - w.end;
  const naNul = na ? b.subarray(w.end).every((v) => v === 0) : null;
  return {
    type: "JPEG",
    bytes: b.length,
    structuurOk: w.fout === null,
    fout: w.fout ?? undefined,
    app: w.app.join(" "),
    vreemdeMarkers: w.markers.length ? w.markers.join(" ") : undefined,
    exif: w.exif,
    xmp: w.xmp,
    mpf: w.mpf,
    gpsInBeeld1: gpsAt(b, 0, end) > 0,
    bytesNaBeeld1: na,
    alleenNullenNa: naNul ?? undefined,
    tweedeSoiNa: na ? Buffer.from(b.subarray(w.end)).indexOf(Buffer.from([0xff, 0xd8, 0xff])) >= 0 : undefined,
    gpsNaBeeld1: na ? gpsAt(b, w.end, b.length) > 0 : false,
  };
}

// --- Tellen ----------------------------------------------------------------------------
const rows = [];
for (const f of await files()) {
  rows.push({ knor: f.name, inGebruik: inUse.get(f.name) ?? 0, ...analyse(await f.bytes()) });
}
rows.sort((a, b) => b.inGebruik - a.inGebruik || a.knor.localeCompare(b.knor));
console.table(rows.map(({ app, ...r }) => r));
for (const r of rows) console.log(`${r.knor}: ${r.app ?? r.type}`);

const used = rows.filter((r) => r.inGebruik > 0);
const ander = inUse.get("(ander los beeld)") ?? 0;
console.log(
  JSON.stringify(
    {
      losseProfielbeelden: [...inUse.values()].reduce((n, v) => n + v, 0),
      verschillendeKnorrenInGebruik: used.length,
      anderLosBeeld: ander,
      knorrenInBucket: rows.length,
      inGebruik: {
        geenJpeg: used.filter((r) => r.type !== "JPEG").length,
        structuurNietOk: used.filter((r) => r.type === "JPEG" && !r.structuurOk).length,
        dataNaBeeld1: used.filter((r) => r.bytesNaBeeld1).length,
        mpf: used.filter((r) => r.mpf).length,
        exif: used.filter((r) => r.exif).length,
        gpsInBeeld1: used.filter((r) => r.gpsInBeeld1).length,
        gpsNaBeeld1: used.filter((r) => r.gpsNaBeeld1).length,
      },
    },
    null,
    1,
  ),
);
