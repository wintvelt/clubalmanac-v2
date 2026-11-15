// WP21: de argumenten voor `internal.films.replaceAll`, uit de filmlijst die
// buiten de repo staat (invariant 9: geen bestandsnaam in de repo).
//
//   node scripts/wp21/seedArgs.ts --group <groupId> [--lijst <pad naar films.json>]
//
// Leest `items` (de 2 trailers en 7 films van de oude app, in die volgorde;
// besluit 5: `notInOldApp` blijft weg), zet ze allemaal in de opgegeven groep
// (besluit 1: "Blob bibliotheek" van die omgeving) en schrijft het resultaat
// naast de lijst, in de gitignored map. Draait niets tegen Convex: het print
// het commando dat de lijst vult. Op prod met `--prod` (T0-stap).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Source = {
  items: Array<{ kind: string; title: string; year: number; videoKey: string; coverKey?: string | null }>;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const groupId = arg("--group");
const listPath = arg("--lijst") ?? "scripts/.data/wp21/films.json";
if (!groupId) {
  console.error("Gebruik: node scripts/wp21/seedArgs.ts --group <groupId van Blob bibliotheek> [--lijst films.json]");
  process.exit(1);
}

const source = JSON.parse(readFileSync(listPath, "utf8")) as Source;
const items = source.items.map((i) => {
  if (i.kind !== "trailer" && i.kind !== "film") throw new Error(`onbekende soort: ${i.kind}`);
  return {
    groupId,
    kind: i.kind,
    title: i.title,
    year: i.year,
    videoKey: i.videoKey,
    ...(i.coverKey ? { coverKey: i.coverKey } : {}),
  };
});

const out = join(dirname(listPath), `replaceAll-${groupId}.json`);
writeFileSync(out, `${JSON.stringify({ items })}\n`);
console.log(`${items.length} items (${items.filter((i) => i.kind === "trailer").length} trailers) → ${out}`);
console.log(`Vullen (dev):  npx convex run films:replaceAll "$(cat ${out})"`);
console.log(`Vullen (prod): npx convex run --prod films:replaceAll "$(cat ${out})"`);
