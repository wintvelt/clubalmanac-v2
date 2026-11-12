// WP17d: hoeveel prod-foto's hebben een plek, per album, en hoeveel liggen
// mogelijk bij een woonadres. Leest alleen het ruwe DynamoDB-extract van WP12
// (`{ meta, items }`), schrijft niets, stuurt niets weg en toont geen namen,
// adressen, coördinaten of ids (de repo is publiek). Draait met Node 18+:
//   node scripts/wp17d/kaart-tel.mjs <pad-naar>/dynamo-extract.json
//
// v1-records die het gebruikt:
//   PO<photoId> / SK=<ownerId>             de foto (exifLat, exifLon, exifAddress, exifDate, createdAt)
//   GP<groupId>#<albumId> / SK=<photoId>   de foto staat in dat album
//   GA<groupId> / SK=<albumId>             het album
//
// "Mogelijk woonadres" is een schatting, geen vaststelling:
//   H = de plaatsnaam begint met een huisnummer ("8 Dorpsstraat - Plaats - Land");
//   T = dezelfde eigenaar maakte op die plek (vak van ca. 100 m) foto's op 3 of
//       meer verschillende dagen: een plek waar hij vaak is.
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("gebruik: node kaart-tel.mjs <pad-naar>/dynamo-extract.json");
  process.exit(1);
}
const { meta, items } = JSON.parse(readFileSync(path, "utf8"));
console.log(`extract: ${meta?.extractedAt ?? "?"}, ${items.length} items`);

const photos = new Map(); // photoId -> { owner, lat, lon, label, day }
const albumsOfPhoto = new Map(); // photoId -> Set(albumKey)
const albums = new Set(); // "groupId#albumId"

const num = (x) => (x === undefined || x === null || x === "" ? undefined : Number(x));
for (const it of items) {
  const pk = typeof it.PK === "string" ? it.PK : "";
  const sk = typeof it.SK === "string" ? it.SK : "";
  if (pk.startsWith("PO") && sk) {
    const lat = num(it.exifLat);
    const lon = num(it.exifLon);
    const dateSrc = typeof it.exifDate === "string" ? it.exifDate : it.createdAt;
    photos.set(pk.slice(2), {
      owner: sk,
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
      label: typeof it.exifAddress === "string" ? it.exifAddress : undefined,
      day: typeof dateSrc === "string" ? dateSrc.slice(0, 10).replace(/:/g, "-") : undefined,
    });
  } else if (pk.startsWith("GP") && pk.includes("#")) {
    const set = albumsOfPhoto.get(sk) ?? new Set();
    set.add(pk.slice(2));
    albumsOfPhoto.set(sk, set);
  } else if (pk.startsWith("GA")) {
    albums.add(`${pk.slice(2)}#${sk}`);
  }
}

const located = [...photos.entries()].filter(([, p]) => p.lat !== undefined && p.lon !== undefined);
const withLabel = [...photos.values()].filter((p) => p.label);
console.log(`\nfoto's: ${photos.size}`);
console.log(`met een plek (coördinaten): ${located.length}`);
console.log(`  waarvan met een plaatsnaam: ${located.filter(([, p]) => p.label).length}`);
console.log(`plaatsnaam zonder coördinaten: ${withLabel.filter((p) => p.lat === undefined).length}`);
console.log(`plek (0,0): ${located.filter(([, p]) => p.lat === 0 && p.lon === 0).length}`);
const owners = new Set(located.map(([, p]) => p.owner));
console.log(`eigenaren met minstens één foto met plek: ${owners.size}`);

// 1. Per album.
const perAlbum = new Map(); // albumKey -> { total, located }
for (const [id, p] of photos) {
  for (const key of albumsOfPhoto.get(id) ?? []) {
    if (!albums.has(key)) continue;
    const a = perAlbum.get(key) ?? { total: 0, located: 0 };
    a.total++;
    if (p.lat !== undefined) a.located++;
    perAlbum.set(key, a);
  }
}
const rows = [...perAlbum.values()].sort((x, y) => y.located - x.located || y.total - x.total);
const emptyAlbums = [...albums].filter((k) => !perAlbum.has(k)).length;
console.log(`\nalbums: ${albums.size} (zonder foto's: ${emptyAlbums})`);
console.log(`albums met minstens één plek: ${rows.filter((r) => r.located > 0).length}`);
console.log(`albums waar elke foto een plek heeft: ${rows.filter((r) => r.total > 0 && r.located === r.total).length}`);
console.log(`albums met foto's maar zonder plek: ${rows.filter((r) => r.total > 0 && r.located === 0).length}`);
console.log(`per album "met plek/totaal" (aflopend): ${rows.map((r) => `${r.located}/${r.total}`).join(", ")}`);
console.log(`grootste aantal plekken in één album: ${rows[0]?.located ?? 0}`);

// 2. Mogelijk woonadres.
const houseNumber = (label) => /^\d+[A-Za-z]?\s/.test(label ?? "");
const cell = (p) => `${Math.round(p.lat / 0.001)}:${Math.round(p.lon / 0.0015)}`; // ca. 110 x 100 m
const daysPerOwnerCell = new Map(); // owner|cell -> Set(day)
for (const [, p] of located) {
  const k = `${p.owner}|${cell(p)}`;
  const s = daysPerOwnerCell.get(k) ?? new Set();
  if (p.day) s.add(p.day);
  daysPerOwnerCell.set(k, s);
}
const frequent = (p) => (daysPerOwnerCell.get(`${p.owner}|${cell(p)}`)?.size ?? 0) >= 3;
const H = located.filter(([, p]) => houseNumber(p.label));
const T = located.filter(([, p]) => frequent(p));
const HT = located.filter(([, p]) => houseNumber(p.label) && frequent(p));
const either = located.filter(([, p]) => houseNumber(p.label) || frequent(p));
console.log(`\nplaatsnaam met huisnummer (H): ${H.length} foto's, ${new Set(H.map(([, p]) => p.owner)).size} eigenaren`);
console.log(`vaak terugkerende plek van de eigenaar, >= 3 dagen in een vak van ca. 100 m (T): ${T.length} foto's, ${new Set(T.map(([, p]) => p.owner)).size} eigenaren, ${new Set(T.map(([, p]) => `${p.owner}|${cell(p)}`)).size} plekken`);
console.log(`H en T: ${HT.length}; H of T: ${either.length}`);
const albumsWithEither = new Set();
for (const [id] of either) for (const k of albumsOfPhoto.get(id) ?? []) if (albums.has(k)) albumsWithEither.add(k);
console.log(`albums met minstens één foto uit H of T: ${albumsWithEither.size}`);

// 3. Wat afronden doet: hoeveel verschillende plekken blijven er over.
const distinct = (step) => new Set(located.map(([, p]) => `${Math.round(p.lat / step)}:${Math.round(p.lon / step)}`)).size;
console.log(`\nverschillende plekken: exact ${new Set(located.map(([, p]) => `${p.lat}:${p.lon}`)).size}, op ca. 1 km ${distinct(0.01)}, op ca. 10 km ${distinct(0.1)}`);
