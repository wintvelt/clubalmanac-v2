// WP17a, A: tellingen op dev voor WP25 (formaten) en vraag 9. Leest de jsonl-exports van
// de dev-tabellen (gitignored, standaard scripts/.data/wp17a/), schrijft niets.
//   node scripts/wp17a/tel.mjs [map-met-exports]
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2] ?? "scripts/.data/wp17a";
const load = (name) =>
  readFileSync(join(DIR, `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

const storage = load("_storage");
const photos = load("photos");
const users = load("users");
const memberships = load("memberships");
const albumPhotos = load("albumPhotos");
const albums = load("albums");

const MB = (b) => (b / 1024 / 1024).toFixed(2) + " MB";
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

// --- Vraag 2: grootte -------------------------------------------------------
const sizeOf = new Map(storage.map((s) => [s._id, s.size]));
const photoSizes = photos.map((p) => sizeOf.get(p.storageId) ?? 0).sort((a, b) => a - b);
const total = photoSizes.reduce((a, b) => a + b, 0);
console.log("== Vraag 2: grootte per foto-beeld ==");
console.log(`foto's: ${photos.length}, storage-objecten: ${storage.length}`);
console.log(`totaal ${MB(total)}, gemiddeld ${MB(total / photoSizes.length)}`);
console.log(`mediaan ${MB(pct(photoSizes, 50))}, p90 ${MB(pct(photoSizes, 90))}, max ${MB(photoSizes.at(-1))}`);
const types = {};
for (const s of storage) types[s.contentType ?? "(geen)"] = (types[s.contentType ?? "(geen)"] ?? 0) + 1;
console.log("contentType:", types);

const photoById = new Map(photos.map((p) => [p._id, p]));
const perAlbum = new Map();
for (const ap of albumPhotos) {
  const p = photoById.get(ap.photoId);
  const e = perAlbum.get(ap.albumId) ?? { n: 0, bytes: 0 };
  e.n += 1;
  e.bytes += p ? (sizeOf.get(p.storageId) ?? 0) : 0;
  perAlbum.set(ap.albumId, e);
}
const albumName = new Map(albums.map((a) => [a._id, a.name]));
console.log("grootste albums (foto's, MB, seconden op 20 Mbit/s):");
for (const [id, e] of [...perAlbum].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 8)) {
  console.log(`  ${albumName.get(id) ?? id}: ${e.n}, ${MB(e.bytes)}, ${((e.bytes * 8) / 20e6).toFixed(0)} s`);
}

// --- Vraag 9: exifOrientation ------------------------------------------------
const orient = {};
for (const p of photos) {
  const k = p.exifOrientation ?? "(leeg)";
  orient[k] = (orient[k] ?? 0) + 1;
}
console.log("\n== Vraag 9: exifOrientation in de DB ==");
console.log(orient);

// --- Gemelde foto's (vraag 4) -------------------------------------------------
console.log("\n== Vraag 4: gemelde foto's ==");
console.log(`flaggedAt gezet: ${photos.filter((p) => p.flaggedAt !== undefined).length}`);
