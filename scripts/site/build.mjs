// De statische site op clubalmanac.com na het uitzetten van de oude webapp
// (besluit Wouter 2026-11-15): een pagina "uit dienst" en de privacyverklaring
// op /privacy/nl, want App Store Connect linkt daarheen.
//
// De privacytekst komt uit de app (app/src/content/infoTexts.ts), zodat site en
// app hetzelfde zeggen. Draaien vanuit de repo-root:
//
//   node scripts/site/build.mjs
//
// Schrijft site/index.html en site/privacy/nl. Upload: zie site/README.md.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../app/package.json", import.meta.url));
const { transformSync } = require("esbuild");

const src = readFileSync(new URL("../../app/src/content/infoTexts.ts", import.meta.url), "utf8");
const { code } = transformSync(src, { loader: "ts", format: "esm" });
const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

const privacy = findPrivacy(mod);

function findPrivacy(m) {
  // infoTexts exporteert de blokken per slug; zoek de privacyblokken op inhoud,
  // zodat dit script niet breekt als de exportnaam verandert.
  for (const value of Object.values(m)) {
    const candidates = Array.isArray(value) ? [value] : typeof value === "object" && value ? Object.values(value) : [];
    for (const c of candidates) {
      const blocks = Array.isArray(c) ? c : c && Array.isArray(c.blocks) ? c.blocks : null;
      if (blocks?.some((b) => b.kind === "heading" && b.text === "De officiële versie")) return blocks;
    }
  }
  throw new Error("privacyblokken niet gevonden in infoTexts.ts");
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function blocksToHtml(blocks) {
  return blocks
    .map((b) => {
      if (b.kind === "heading") return `<h2>${esc(b.text)}</h2>`;
      if (b.kind === "bullets") return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
      const lead = b.lead ? `<em>${esc(b.lead)}</em> ` : "";
      return `<p>${lead}${esc(b.text)}</p>`;
    })
    .join("\n");
}

const page = (title, body) => `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --fg:#0f172a; --muted:#475569; --bg:#f1f5f9; --link:#0369a1; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e2e8f0; --muted:#94a3b8; --bg:#0f172a; --link:#38bdf8; } }
  body { margin:0; background:var(--bg); color:var(--fg); font:17px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width:640px; margin:0 auto; padding:48px 20px 64px; }
  h1 { font-size:30px; margin:0 0 16px; }
  h2 { font-size:21px; margin:32px 0 8px; }
  p, li { color:var(--fg); }
  .muted { color:var(--muted); }
  a { color:var(--link); }
  .bar { height:6px; border-radius:3px; background:linear-gradient(90deg,#a3e635,#0ea5e9); margin:0 0 32px; }
</style>
</head>
<body><main>
<div class="bar"></div>
${body}
</main></body>
</html>
`;

const index = page(
  "clubalmanac",
  `<h1>clubalmanac</h1>
<p>De website is nog even aan het bijkomen van een heftig lustrum. Zodra de kater is weggezakt, gaan de deuren hopelijk snel weer gewoon open.</p>
<p>Tot die tijd hangt de hele jaarclub aan de bar van de iPhone-app Clubalmanac. Daar vind je al je foto's en groepen.</p>
<p class="muted">Klachten, vragen of een rondje? Mail <a href="mailto:wouter@clubalmanac.com">wouter@clubalmanac.com</a>.</p>
<p class="muted"><a href="/privacy/nl">Privacyverklaring</a></p>`,
);

const privacyPage = page(
  "Privacyverklaring – clubalmanac",
  `<h1>Privacyverklaring</h1>
${blocksToHtml(privacy)}
<p class="muted"><a href="/">clubalmanac</a></p>`,
);

const out = new URL("../../site/", import.meta.url);
mkdirSync(new URL("privacy/", out), { recursive: true });
writeFileSync(new URL("index.html", out), index);
// Sleutel zonder extensie: App Store Connect linkt naar /privacy/nl.
writeFileSync(new URL("privacy/nl", out), privacyPage);
console.log("site/index.html en site/privacy/nl geschreven");
