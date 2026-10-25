// Bron van het app-icoon (docs/design.md §8): de polaroid met de eend.
// Schrijft de lagen voor Icon Composer en de twee volledige weergaven naar
// assets/icon/, en rendert daaruit de PNG's (alleen op macOS). Werkwijze met
// Icon Composer: docs/conventions/external-services.md §EAS-build.
// Draai na een wijziging opnieuw, in app/: node scripts/build-icon.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "icon");

// Tokens gradStart / gradEnd en het donker van `bg` (src/theme/tokens.ts).
const LIME = "#A3E635";
const SKY = "#0EA5E9";
const NIGHT = "#020617";
const DUCK_LIGHT = "#383A6A";
const RIM = "rgba(12,74,110,0.45)";
const SHADOW = "#0F172A";

// viewBox 100. Alles staat 7° gedraaid rond het midden.
const TILT = 'transform="rotate(-7 50 50)"';
const roundRect = (x, y, w, h, r) =>
  `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
  `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
  `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
// Kaartje 19,14 · 62×74 · r6 met het venster 25,20 · 50×48 · r3 uitgespaard.
const CARD = `<path fill-rule="evenodd" d="${roundRect(19, 14, 62, 74, 6)}${roundRect(25, 20, 50, 48, 3)}"/>`;
const CARD_RIM = `<rect x="19.5" y="14.5" width="61" height="73" rx="5.5" fill="none" stroke="${RIM}" stroke-width="1"/>`;
// Eend: lijf, kop, snavel naar rechts. Kleiner dan het venster, ≥ 8 van de rand.
const DUCK =
  '<g transform="translate(27.4 17.1) scale(0.48)">' +
  '<path d="M13 57 26 62C30 57 39 55 47 56H60C71 56 81 62 81 71 81 79 73 84 63 84H37C25 84 19 77 19 70 19 66 17 61 13 57Z"/>' +
  '<circle cx="54" cy="42" r="14"/>' +
  '<path d="M65 37 81 44 65 50z"/>' +
  "</g>";

// Linksonder naar rechtsboven, sky-500 vol vanaf 76% (38% lime).
const GRADIENT = `<linearGradient id="grad" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${LIME}"/><stop offset="0.76" stop-color="${SKY}"/><stop offset="1" stop-color="${SKY}"/></linearGradient>`;
const BLUR = '<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter>';

const svg = (defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 100 100">` +
  (defs ? `<defs>${defs}</defs>` : "") +
  body +
  "</svg>\n";

const files = {
  // Lagen voor Icon Composer: alleen de vorm. Glas, schaduw en de weergaven
  // donker en getint stelt Icon Composer in.
  "layer-0-background.svg": svg(GRADIENT, '<rect width="100" height="100" fill="url(#grad)"/>'),
  "layer-1-card.svg": svg("", `<g ${TILT} fill="#FFFFFF">${CARD}</g>`),
  "layer-1-card-rim.svg": svg("", `<g ${TILT}>${CARD_RIM}</g>`),
  "layer-2-duck.svg": svg("", `<g ${TILT} fill="${DUCK_LIGHT}">${DUCK}</g>`),

  // Volledige weergaven: bron van de terugval-PNG's.
  "icon-light.svg": svg(
    GRADIENT + BLUR,
    '<rect width="100" height="100" fill="url(#grad)"/>' +
      `<g ${TILT}>` +
      `<g fill="${SHADOW}" opacity="0.3" filter="url(#soft)" transform="translate(0 2)">${CARD}</g>` +
      `<g fill="#FFFFFF" opacity="0.94">${CARD}</g>` +
      CARD_RIM +
      `<g fill="${SHADOW}" opacity="0.3" filter="url(#soft)" transform="translate(0 1.5)">${DUCK}</g>` +
      `<g fill="${DUCK_LIGHT}">${DUCK}</g>` +
      "</g>",
  ),
  "icon-dark.svg": svg(
    GRADIENT,
    `<rect width="100" height="100" fill="${NIGHT}"/>` +
      `<g ${TILT} fill="url(#grad)">${CARD}${DUCK}</g>`,
  ),
};

mkdirSync(OUT, { recursive: true });
for (const [name, content] of Object.entries(files)) writeFileSync(join(OUT, name), content);
console.log(`${Object.keys(files).length} SVG's in ${OUT}`);

// PNG's van 1024 zonder alfakanaal (App Store-eis). QuickLook (macOS)
// rendert de SVG; Pillow haalt het alfakanaal eraf.
for (const name of ["icon-light", "icon-dark"]) {
  const svgPath = join(OUT, `${name}.svg`);
  execFileSync("qlmanage", ["-t", "-s", "1024", "-o", OUT, svgPath], { stdio: "ignore" });
  const rendered = `${svgPath}.png`;
  execFileSync("python3", [
    "-c",
    "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2])",
    rendered,
    join(OUT, `${name}.png`),
  ]);
  rmSync(rendered);
}
console.log("icon-light.png en icon-dark.png geschreven");
