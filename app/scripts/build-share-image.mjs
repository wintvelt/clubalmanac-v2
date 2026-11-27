// Het deelplaatje (Open Graph) voor een link naar app.clubalmanac.com of
// clubalmanac.com in WhatsApp en Signal: het app-icoon met ernaast de naam en
// de ondertitel. 1200×630, kleiner dan 300 KB. Schrijft public/og.png; Expo
// zet public/ bij `expo export` in dist/. De site linkt naar dezelfde URL.
// Draai na een wijziging opnieuw, in app/: node scripts/build-share-image.mjs
// (alleen op macOS: QuickLook rendert de SVG met de systeemletter; sharp, uit
// de root, knipt en comprimeert, net als bij het Android-icoon).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(APP, "public", "og.png");
const W = 1200;
const H = 630;

// Tokens uit src/theme/tokens.ts (licht): washStart / washEnd, text, muted.
const WASH_START = "#F7FEE7";
const WASH_END = "#E0F2FE";
const TEXT = "#0F172A";
const MUTED = "#475569";
const LIME = "#A3E635";
const SKY = "#0EA5E9";

// Het icoon zelf (build-icon.mjs), als geneste SVG met afgeronde hoeken zoals
// op het beginscherm.
const ICON = 300;
const ICON_X = 150;
const ICON_Y = (H - ICON) / 2;
const icon = readFileSync(join(APP, "assets", "icon", "icon-light.svg"), "utf8")
  .trim()
  .replace(/^<svg [^>]*>/, `<svg x="${ICON_X}" y="${ICON_Y}" width="${ICON}" height="${ICON}" viewBox="0 0 100 100">`);

const TEXT_X = ICON_X + ICON + 64;
const FONT = "-apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif";

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">` +
  "<defs>" +
  `<linearGradient id="wash" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${WASH_START}"/><stop offset="1" stop-color="${WASH_END}"/></linearGradient>` +
  `<linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${LIME}"/><stop offset="0.76" stop-color="${SKY}"/><stop offset="1" stop-color="${SKY}"/></linearGradient>` +
  `<clipPath id="squircle"><rect x="${ICON_X}" y="${ICON_Y}" width="${ICON}" height="${ICON}" rx="${ICON * 0.225}"/></clipPath>` +
  '<filter id="lift" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>' +
  "</defs>" +
  `<rect width="${W}" height="${H}" fill="url(#wash)"/>` +
  `<rect x="${ICON_X}" y="${ICON_Y + 14}" width="${ICON}" height="${ICON}" rx="${ICON * 0.225}" fill="${TEXT}" opacity="0.18" filter="url(#lift)"/>` +
  `<g clip-path="url(#squircle)">${icon}</g>` +
  `<text x="${TEXT_X}" y="${H / 2 - 4}" font-family="${FONT}" font-size="92" font-weight="700" fill="${TEXT}" letter-spacing="-1.5">Clubalmanac</text>` +
  `<rect x="${TEXT_X + 2}" y="${H / 2 + 22}" width="120" height="8" rx="4" fill="url(#bar)"/>` +
  `<text x="${TEXT_X}" y="${H / 2 + 92}" font-family="${FONT}" font-size="42" font-weight="400" fill="${MUTED}">Het fotoalbum van je club</text>` +
  "</svg>\n";

// QuickLook rendert alleen een vierkante SVG op ware grootte (een brede wordt
// vergroot). Daarom is de SVG 1200×1200 met het plaatje in de bovenste 630;
// sharp knipt dat eruit. PNG met palet en dithering: volle kleur is net te groot.
mkdirSync(join(APP, "public"), { recursive: true });
const tmp = mkdtempSync(join(APP, "public", ".og-"));
try {
  const svgPath = join(tmp, "og.svg");
  writeFileSync(svgPath, svg);
  execFileSync("qlmanage", ["-t", "-s", String(W), "-o", tmp, svgPath], { stdio: "ignore" });
  const { default: sharp } = await import("sharp");
  const rendered = sharp(`${svgPath}.png`);
  const { width, height } = await rendered.metadata();
  if (width !== W || height < H) throw new Error(`QuickLook gaf ${width}×${height}, verwacht ${W} breed en ≥ ${H} hoog`);
  await rendered
    .extract({ left: 0, top: 0, width: W, height: H })
    .removeAlpha()
    .png({ palette: true, colours: 256, quality: 100, dither: 1, effort: 10 })
    .toFile(OUT);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const kb = Math.round(statSync(OUT).size / 1024);
if (kb >= 300) throw new Error(`og.png is ${kb} KB, moet < 300 KB`);
console.log(`public/og.png geschreven (${W}×${H}, ${kb} KB)`);
