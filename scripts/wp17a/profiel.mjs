// WP17a vraag 10: welke v1-profielfoto's de foto van een ander zijn.
// Leest alleen het ruwe DynamoDB-extract van WP12 (`{ meta, items }`), schrijft
// niets, en heeft niets uit de repo nodig. Draait overal met Node 18+:
//   node scripts/wp17a/profiel.mjs <pad-naar>/dynamo-extract.json
//
// v1-records die het gebruikt:
//   UBbase / SK=<userId>        photoUrl (S3-sleutel van de profielfoto), photoId
//   PO<photoId> / SK=<ownerId>  url (S3-sleutel van de foto)
//   UM<userId> / SK=<groupId>   lidmaatschap (status "invite" telt niet)
// De WP12-transform neemt `photoUrl` over als profielfoto.
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("gebruik: node profiel.mjs <pad-naar>/dynamo-extract.json");
  process.exit(1);
}
const { meta, items } = JSON.parse(readFileSync(path, "utf8"));
console.log(`extract: ${meta?.extractedAt ?? "?"}, ${items.length} items`);

const users = new Map(); // userId -> UBbase
const ownersByUrl = new Map(); // S3-sleutel -> Set(ownerId)
const ownerByPhotoId = new Map(); // photoId -> ownerId
const groupsOf = new Map(); // userId -> Set(groupId)

for (const it of items) {
  const pk = typeof it.PK === "string" ? it.PK : "";
  const sk = typeof it.SK === "string" ? it.SK : "";
  if (pk === "UBbase") users.set(sk, it);
  else if (pk.startsWith("PO")) {
    ownerByPhotoId.set(pk.slice(2), sk);
    if (typeof it.url === "string") {
      const set = ownersByUrl.get(it.url) ?? new Set();
      set.add(sk);
      ownersByUrl.set(it.url, set);
    }
  } else if (pk.startsWith("UM") && it.status !== "invite") {
    const uid = pk.slice(2);
    const set = groupsOf.get(uid) ?? new Set();
    set.add(sk);
    groupsOf.set(uid, set);
  }
}

const shareGroup = (a, b) => [...(groupsOf.get(a) ?? [])].some((g) => groupsOf.get(b)?.has(g));

const tally = { geen: 0, standaard: 0, eigen: 0, ander: 0, los: 0 };
const ander = [];
for (const [userId, base] of users) {
  const url = typeof base.photoUrl === "string" ? base.photoUrl : "";
  if (!url) {
    tally.geen += 1;
    continue;
  }
  if (url.startsWith("public/")) {
    tally.standaard += 1;
    continue;
  }
  const owners = new Set(ownersByUrl.get(url) ?? []);
  const viaId = typeof base.photoId === "string" ? ownerByPhotoId.get(base.photoId) : undefined;
  if (viaId) owners.add(viaId);
  if (owners.size === 0) tally.los += 1;
  else if (owners.has(userId)) tally.eigen += 1;
  else {
    tally.ander += 1;
    const owner = [...owners][0];
    ander.push({ userId, eigenaar: owner, deeltNogEenGroep: shareGroup(userId, owner) });
  }
}

console.log(`users (UBbase): ${users.size}`);
console.log(`  geen profielfoto:                  ${tally.geen}`);
console.log(`  standaardbeeld (public/, knorren): ${tally.standaard}`);
console.log(`  eigen foto:                        ${tally.eigen}`);
console.log(`  foto van een ander (vraag 10):     ${tally.ander}`);
console.log(`  geen foto meer (los beeld):        ${tally.los}`);
if (ander.length) console.table(ander);
