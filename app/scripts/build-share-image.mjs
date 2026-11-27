// Het deelplaatje (Open Graph) voor een link naar app.clubalmanac.com of
// clubalmanac.com in WhatsApp en Signal: het app-icoon, vierkant, 1200×1200,
// kleiner dan 300 KB. Schrijft public/og.png; Expo
// zet public/ bij `expo export` in dist/. De site linkt naar dezelfde URL.
// Draai na een wijziging opnieuw, in app/, met de geblurde cover van Blob
// bibliotheek uit builds/ (niet in git):
//   OG_BACKGROUND=../builds/og-achtergrond.png node scripts/build-share-image.mjs
// (alleen op macOS: QuickLook rendert de SVG met de systeemletter; sharp, uit
// de root, knipt en comprimeert, net als bij het Android-icoon).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OG_OUT ?? join(APP, "public", "og.png");
const W = 1200;
const H = 1200;

// Tokens uit src/theme/tokens.ts (licht): washStart / washEnd, text.
const WASH_START = "#F7FEE7";
const WASH_END = "#E0F2FE";
const TEXT = "#0F172A";

// Vierkant: WhatsApp en Signal tonen het plaatje vaak als klein vierkantje
// naast de titel en beschrijving. Daarom geen kleine tekst; de naam staat al
// in de titel. "Clubalmanac" staat groot onder het icoon; OG_VARIANT=icoon
// laat de naam weg.
const WITH_NAME = process.env.OG_VARIANT !== "icoon";
const ICON = WITH_NAME ? 640 : 780;
const ICON_X = (W - ICON) / 2;
const ICON_Y = WITH_NAME ? 170 : (H - ICON) / 2 - 10;
const icon = readFileSync(join(APP, "assets", "icon", "icon-light.svg"), "utf8")
  .trim()
  .replace(/^<svg [^>]*>/, `<svg x="${ICON_X}" y="${ICON_Y}" width="${ICON}" height="${ICON}" viewBox="0 0 100 100">`);
// Achtergrond: een sterk geblurde foto (1200×1200 PNG) via OG_BACKGROUND, of
// anders het wash-verloop. De geblurde foto staat niet in de repo (builds/).
const BG = process.env.OG_BACKGROUND
  ? `data:image/png;base64,${readFileSync(process.env.OG_BACKGROUND).toString("base64")}`
  : null;
const NAME_FILL = BG ? "#FFFFFF" : TEXT;
const FONT = "-apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif";

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  "<defs>" +
  `<linearGradient id="wash" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${WASH_START}"/><stop offset="1" stop-color="${WASH_END}"/></linearGradient>` +
  `<clipPath id="squircle"><rect x="${ICON_X}" y="${ICON_Y}" width="${ICON}" height="${ICON}" rx="${ICON * 0.225}"/></clipPath>` +
  '<filter id="lift" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="24"/></filter>' +
  '<filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feDropShadow dx="0" dy="4" stdDeviation="10" flood-color="#000" flood-opacity="0.45"/></filter>' +
  "</defs>" +
  (BG
    ? `<image href="${BG}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${W}" height="${H}" fill="url(#wash)"/>`) +
  `<rect x="${ICON_X}" y="${ICON_Y + 24}" width="${ICON}" height="${ICON}" rx="${ICON * 0.225}" fill="${TEXT}" opacity="0.16" filter="url(#lift)"/>` +
  `<g clip-path="url(#squircle)">${icon}</g>` +
  (WITH_NAME
    ? `<text x="${W / 2}" y="${ICON_Y + ICON + 190}" text-anchor="middle" font-family="${FONT}" font-size="150" font-weight="700" fill="${NAME_FILL}" letter-spacing="-3"${BG ? ' filter="url(#glow)"' : ""}>Clubalmanac</text>`
    : "") +
  "</svg>\n";

mkdirSync(join(APP, "public"), { recursive: true });
const tmp = mkdtempSync(join(APP, "public", ".og-"));
try {
  const svgPath = join(tmp, "og.svg");
  writeFileSync(svgPath, svg);
  execFileSync("qlmanage", ["-t", "-s", String(W), "-o", tmp, svgPath], { stdio: "ignore" });
  const { default: sharp } = await import("sharp");
  const rendered = sharp(`${svgPath}.png`);
  const { width, height } = await rendered.metadata();
  if (width !== W || height !== H) throw new Error(`QuickLook gaf ${width}×${height}, verwacht ${W}×${H}`);
  await rendered
    .removeAlpha()
    .png({ palette: true, colours: 256, quality: 100, dither: 1, effort: 10 })
    .toFile(OUT);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const kb = Math.round(statSync(OUT).size / 1024);
if (kb >= 300) throw new Error(`og.png is ${kb} KB, moet < 300 KB`);
console.log(`${OUT} geschreven (${W}×${H}, ${kb} KB)`);
