// WP17c: hoe groot wordt Mijn foto's op prod, en wat ziet "in welke albums".
// Leest alleen het ruwe DynamoDB-extract van WP12 (`{ meta, items }`), schrijft
// niets, toont geen namen, adressen of ids. Draait overal met Node 18+:
//   node scripts/wp17c/mijn-fotos-tel.mjs <pad-naar>/dynamo-extract.json
//
// v1-records die het gebruikt:
//   PO<photoId> / SK=<ownerId>               de foto (createdAt, exifDate, flaggedDate)
//   GP<groupId>#<albumId> / SK=<photoId>     de foto staat in dat album
//   GA<groupId> / SK=<albumId>               het album
//   UM<userId> / SK=<groupId>                lidmaatschap (status "invite" telt niet)
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("gebruik: node mijn-fotos-tel.mjs <pad-naar>/dynamo-extract.json");
  process.exit(1);
}
const { meta, items } = JSON.parse(readFileSync(path, "utf8"));
console.log(`extract: ${meta?.extractedAt ?? "?"}, ${items.length} items`);

const add = (map, k, v) => (map.get(k) ?? map.set(k, new Set()).get(k)).add(v);
const photos = new Map(); // photoId -> { owner, exifDate, flagged }
const albumsOfPhoto = new Map(); // photoId -> Set("groupId#albumId")
const albums = new Set(); // "groupId#albumId"
const albumsPerGroup = new Map(); // groupId -> Set(albumId)
const groupsOf = new Map(); // userId -> Set(groupId)

for (const it of items) {
  const pk = typeof it.PK === "string" ? it.PK : "";
  const sk = typeof it.SK === "string" ? it.SK : "";
  if (pk.startsWith("PO")) {
    photos.set(pk.slice(2), { owner: sk, exifDate: it.exifDate, flagged: !!it.flaggedDate });
  } else if (pk.startsWith("GP") && pk.includes("#")) {
    add(albumsOfPhoto, sk, pk.slice(2));
  } else if (pk.startsWith("GA")) {
    albums.add(`${pk.slice(2)}#${sk}`);
    add(albumsPerGroup, pk.slice(2), sk);
  } else if (pk.startsWith("UM") && it.status !== "invite") {
    add(groupsOf, pk.slice(2), sk);
  }
}

// 1. Foto's per eigenaar.
const perOwner = new Map();
for (const [, p] of photos) perOwner.set(p.owner, (perOwner.get(p.owner) ?? 0) + 1);
const counts = [...perOwner.values()].sort((a, b) => b - a);
console.log(`\nfoto's: ${photos.size}, eigenaren: ${perOwner.size}`);
console.log(`per eigenaar (aflopend): ${counts.join(", ")}`);

// 2. Foto's in geen album (ook: alleen in een album dat niet meer bestaat).
let unpubbed = 0;
let onlyDeadAlbum = 0;
const unpubbedPerOwner = new Map();
for (const [id, p] of photos) {
  const aps = albumsOfPhoto.get(id);
  if (!aps || aps.size === 0) {
    unpubbed++;
    unpubbedPerOwner.set(p.owner, (unpubbedPerOwner.get(p.owner) ?? 0) + 1);
  } else if (![...aps].some((k) => albums.has(k))) onlyDeadAlbum++;
}
const maxOwner = [...perOwner.entries()].sort((a, b) => b[1] - a[1])[0];
console.log(`\nin geen album: ${unpubbed} (bij de grootste eigenaar: ${unpubbedPerOwner.get(maxOwner?.[0]) ?? 0} van ${maxOwner?.[1] ?? 0})`);
console.log(`alleen in een album dat niet meer bestaat: ${onlyDeadAlbum}`);
console.log(`in geen album per eigenaar (aflopend): ${[...unpubbedPerOwner.values()].sort((a, b) => b - a).join(", ")}`);

// 3. In hoeveel albums staat één foto.
const hist = {};
for (const [id] of photos) {
  const n = albumsOfPhoto.get(id)?.size ?? 0;
  hist[n] = (hist[n] ?? 0) + 1;
}
console.log(`\nalbums per foto (aantal albums: aantal foto's): ${JSON.stringify(hist)}`);

// 4. Publicaties van een eigen foto in een groep waar de eigenaar geen lid (meer) van is.
let foreignPubs = 0;
let foreignPhotos = 0;
for (const [id, p] of photos) {
  const mine = groupsOf.get(p.owner) ?? new Set();
  const bad = [...(albumsOfPhoto.get(id) ?? [])].filter((k) => !mine.has(k.split("#")[0]));
  foreignPubs += bad.length;
  if (bad.length) foreignPhotos++;
}
console.log(`\neigen foto in album van een groep zonder lidmaatschap: ${foreignPubs} publicaties, ${foreignPhotos} foto's`);

// 5. Publicaties van andermans foto (v1: alleen de eigenaar voegde toe).
//    GP draagt geen toevoeger; we tellen wat de album-keuze en het detail raakt.
const albumsPerUser = [...groupsOf.entries()].map(([, gs]) =>
  [...gs].reduce((n, g) => n + (albumsPerGroup.get(g)?.size ?? 0), 0),
);
console.log(`\nalbums in de album-keuze per lid (aflopend): ${albumsPerUser.sort((a, b) => b - a).join(", ")}`);

// 6. Datum: foto's zonder exifDate (dan telt de upload).
let noExif = 0;
let flagged = 0;
for (const [, p] of photos) {
  if (!p.exifDate) noExif++;
  if (p.flagged) flagged++;
}
console.log(`\nzonder exifDate: ${noExif}; gemeld: ${flagged}`);
