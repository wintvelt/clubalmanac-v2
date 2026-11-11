// WP27: wat er met de profielfoto's op prod gebeurt als (a) alleen een foto
// waartoe het lid toegang heeft een beeld geeft, en (b) de profielfoto naar
// een foto wijst in plaats van naar een beeld. Leest alleen het ruwe
// DynamoDB-extract van WP12 (`{ meta, items }`), schrijft niets, toont geen
// namen of adressen. Draait overal met Node 18+:
//   node scripts/wp27/profiel-tel.mjs <pad-naar>/dynamo-extract.json
//
// v1-records die het gebruikt:
//   UBbase / SK=<userId>             photoUrl (S3-sleutel), photoId
//   PO<photoId> / SK=<ownerId>       url (S3-sleutel van de foto)
//   GP<groupId>#<albumId> / SK=<photoId>   de foto staat in dat album
//   UM<userId> / SK=<groupId>        lidmaatschap (status "invite" telt niet)
// Toegang zoals v2 (canAccessPhoto): eigenaar, of lid van een groep waarin de
// foto in een album staat.
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("gebruik: node profiel-tel.mjs <pad-naar>/dynamo-extract.json");
  process.exit(1);
}
const { meta, items } = JSON.parse(readFileSync(path, "utf8"));
console.log(`extract: ${meta?.extractedAt ?? "?"}, ${items.length} items`);

const users = new Map(); // userId -> UBbase
const photos = new Map(); // photoId -> { owner, url }
const photosByUrl = new Map(); // url -> [photoId]
const groupsOfPhoto = new Map(); // photoId -> Set(groupId)
const groupsOf = new Map(); // userId -> Set(groupId)
const add = (map, k, v) => (map.get(k) ?? map.set(k, new Set()).get(k)).add(v);

for (const it of items) {
  const pk = typeof it.PK === "string" ? it.PK : "";
  const sk = typeof it.SK === "string" ? it.SK : "";
  if (pk === "UBbase") users.set(sk, it);
  else if (pk.startsWith("PO")) {
    const id = pk.slice(2);
    photos.set(id, { owner: sk, url: typeof it.url === "string" ? it.url : "" });
    if (typeof it.url === "string") (photosByUrl.get(it.url) ?? photosByUrl.set(it.url, []).get(it.url)).push(id);
  } else if (pk.startsWith("GP") && pk.includes("#")) add(groupsOfPhoto, sk, pk.slice(2).split("#")[0]);
  else if (pk.startsWith("UM") && it.status !== "invite") add(groupsOf, pk.slice(2), sk);
}

const access = (userId, photoId) => {
  const p = photos.get(photoId);
  if (!p) return false;
  if (p.owner === userId) return true;
  return [...(groupsOfPhoto.get(photoId) ?? [])].some((g) => groupsOf.get(userId)?.has(g));
};

const t = {
  geen: 0, standaard: 0, standaardBeelden: new Set(),
  eigen: 0, ander: 0, los: 0,
  idKlopt: 0, idOntbreekt: 0, idWijktAf: 0, meerFotosZelfdeBeeld: 0,
  anderMetToegang: 0, anderZonderToegang: 0,
  anderToegangViaDezeFoto: 0, anderToegangAlleenViaDuplicaat: 0,
};
const ander = [];
for (const [userId, base] of users) {
  const url = typeof base.photoUrl === "string" ? base.photoUrl : "";
  if (!url) { t.geen += 1; continue; }
  if (url.startsWith("public/")) { t.standaard += 1; t.standaardBeelden.add(url); continue; }
  const sameUrl = photosByUrl.get(url) ?? [];
  const pid = typeof base.photoId === "string" ? base.photoId : "";
  if (sameUrl.length === 0 && !photos.has(pid)) { t.los += 1; continue; }
  if (sameUrl.length > 1) t.meerFotosZelfdeBeeld += 1;
  if (!pid || !photos.has(pid)) t.idOntbreekt += 1;
  else if (photos.get(pid).url === url) t.idKlopt += 1;
  else t.idWijktAf += 1;
  const owners = new Set(sameUrl.map((id) => photos.get(id).owner));
  if (owners.has(userId)) { t.eigen += 1; continue; }
  t.ander += 1;
  const viaThis = photos.has(pid) && photos.get(pid).url === url && access(userId, pid);
  const viaAny = sameUrl.some((id) => access(userId, id));
  if (viaAny) t.anderMetToegang += 1; else t.anderZonderToegang += 1;
  if (viaThis) t.anderToegangViaDezeFoto += 1;
  else if (viaAny) t.anderToegangAlleenViaDuplicaat += 1;
  ander.push({
    fotosMetDitBeeld: sameUrl.length,
    inAlbumVanGedeeldeGroep: viaAny,
    v1PhotoIdKlopt: photos.has(pid) && photos.get(pid).url === url,
  });
}

console.log(`users (UBbase): ${users.size}`);
console.log(`  geen profielfoto:                         ${t.geen}`);
console.log(`  standaardbeeld (public/, knorren):        ${t.standaard} (${t.standaardBeelden.size} verschillende beelden, geen foto)`);
console.log(`  eigen foto:                               ${t.eigen}`);
console.log(`  foto van een ander:                       ${t.ander}`);
console.log(`    met toegang (v2-regel):                 ${t.anderMetToegang}`);
console.log(`    zonder toegang -> letter vanaf T0:      ${t.anderZonderToegang}`);
console.log(`  los beeld (geen foto meer):               ${t.los}`);
console.log(`profielfoto's met een foto erachter: ${t.eigen + t.ander}`);
console.log(`  v1 photoId wijst naar die foto:           ${t.idKlopt}`);
console.log(`  v1 photoId ontbreekt of foto weg:         ${t.idOntbreekt}`);
console.log(`  v1 photoId wijst naar een andere foto:    ${t.idWijktAf}`);
console.log(`  meer dan één foto met hetzelfde beeld:    ${t.meerFotosZelfdeBeeld}`);
if (ander.length) console.table(ander);
