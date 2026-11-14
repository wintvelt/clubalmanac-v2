// WP19c A-invariant 8, 10 en 11: de opmaak van de uitnodigingsmail in de stijl
// van de app (docs/design.md §2–4), de tekstversie en HTML-veiligheid.
// Spec: docs/work-packages/WP19c-uitnodigingsmail-opmaak.md.
//
// Zonder cover: de foto zit in inviteMailPhoto.test.ts (Node, sharp).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatNlDate } from "../../convex/lib/emailTemplates";
import { newT } from "../groups/_beheer";
import { inviteRow } from "./_wp19b";
import { APP_STORE_URL, clearMailEnv, imgTags, mailEnv, mailFor, APPLE_APP_ID, setup } from "./_wp19c";

// Besluit 5: een mail met foto gaat via SMTP. Nooit echt naar Mailjet.
vi.mock("nodemailer", async () => (await import("./_smtp")).nodemailerMock());

beforeEach(() => mailEnv(APPLE_APP_ID));
afterEach(() => clearMailEnv());

/** Het blok `@media (prefers-color-scheme: dark) { … }`, of "". */
function darkBlock(html: string): string {
  const m = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/i.exec(html);
  if (!m) return "";
  let depth = 1;
  let i = m.index + m[0].length;
  while (i < html.length && depth > 0) {
    if (html[i] === "{") depth++;
    if (html[i] === "}") depth--;
    i++;
  }
  return html.slice(m.index, i);
}

/** Een kleur, hoofdletterongevoelig; wit mag ook `#fff` zijn. */
const hex = (h: string) => (h.toUpperCase() === "#FFFFFF" ? /#fff(fff)?\b/i : new RegExp(`${h}\\b`, "i"));

describe("A-invariant 8 — een volledig document, licht en donker", () => {
  it("doctype, lang=nl, utf-8, viewport, color-scheme", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    const html = (await mailFor(t, inviteId)).HTMLPart ?? "";
    expect(html).toMatch(/^\s*<!doctype html>/i);
    expect(html).toMatch(/<html\b[^>]*\blang\s*=\s*["']nl["']/i);
    expect(html).toMatch(/<meta\b[^>]*charset\s*=\s*["']?utf-8/i);
    expect(html).toMatch(/<meta\b[^>]*name\s*=\s*["']viewport["']/i);
    expect(html).toMatch(/<meta\b[^>]*name\s*=\s*["']color-scheme["'][^>]*content\s*=\s*["']light dark["']/i);
    expect(darkBlock(html)).not.toBe("");
  });

  it("de tokens van design.md: licht buiten het donkere blok, donker erin", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    const html = (await mailFor(t, inviteId)).HTMLPart ?? "";
    const dark = darkBlock(html);
    const light = html.replace(dark, "");
    // bg, surface, text, muted, cta, onCta
    for (const h of ["#F1F5F9", "#FFFFFF", "#0F172A", "#475569", "#C2410C"]) expect(light, h).toMatch(hex(h));
    for (const h of ["#020617", "#0F172A", "#E2E8F0", "#94A3B8", "#FB923C", "#1C0A02"]) expect(dark, h).toMatch(hex(h));
  });

  it("de systeemletter, geen webfont en geen externe bronnen", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    const html = (await mailFor(t, inviteId)).HTMLPart ?? "";
    expect(html).toMatch(/font-family\s*:[^;"]*-apple-system[^;"]*sans-serif/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/url\s*\(/i);
    expect(html).not.toMatch(/@font-face|fonts\.googleapis/i);
  });

  it("één kolom van 560–640 px", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    const html = (await mailFor(t, inviteId)).HTMLPart ?? "";
    expect(html).toMatch(/max-width\s*:\s*(5[6-9]\d|6[0-3]\d|640)px/i);
  });

  it("zonder cover: geen enkel beeld", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    expect(imgTags((await mailFor(t, inviteId)).HTMLPart ?? "")).toHaveLength(0);
  });

  it("de HTML blijft onder 100 kB, ook met een bericht van 1000 tekens", async () => {
    const t = newT();
    const { inviteId } = await setup(t, { message: "é<&>".repeat(250) });
    const html = (await mailFor(t, inviteId)).HTMLPart ?? "";
    expect(new TextEncoder().encode(html).length).toBeLessThan(100_000);
  });
});

describe("A-invariant 10 — de tekstversie is compleet", () => {
  it("aanhef, afzender, groep, bericht, inlogadres, geldig tot, App Store-URL; geen HTML en geen cid:", async () => {
    const t = newT();
    const { inviteId } = await setup(t, { message: "Kom erbij" });
    const msg = await mailFor(t, inviteId);
    const text = msg.TextPart ?? "";
    const until = formatNlDate((await inviteRow(t, inviteId))!.expiresAt);
    for (const s of ["Hi Nina", "Olga Oprichter", "De Fotoclub", "Kom erbij", "nina@x.test", until, APP_STORE_URL]) {
      expect(text, s).toContain(s);
    }
    expect(text).toMatch(/iPhone/);
    expect(text).not.toMatch(/<\/?[a-z!][^>]*>/i);
    expect(text).not.toMatch(/cid:|undefined|null/i);
  });
});

describe("A-invariant 11 — HTML-veilig, regeleinden", () => {
  it("groepsnaam, afzender, genodigde en bericht ge-escaped", async () => {
    const t = newT();
    const { inviteId } = await setup(t, {
      groupName: `Club <b>"x"</b> & 'y'`,
      inviterName: "<i>Olga</i>",
      name: "<u>Nina</u>",
      message: "<script>alert(1)</script>",
    });
    const msg = await mailFor(t, inviteId);
    const html = msg.HTMLPart ?? "";
    expect(html).not.toMatch(/<b>|<i>Olga|<u>Nina|<script>alert/i);
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&lt;i&gt;Olga");
    expect(html).toContain("&lt;u&gt;Nina");
    expect(html).toContain("&lt;script&gt;");
  });

  it("een regeleinde in het bericht wordt <br> in de HTML en blijft een regeleinde in de tekst", async () => {
    const t = newT();
    const { inviteId } = await setup(t, { message: "Regel een\nRegel twee" });
    const msg = await mailFor(t, inviteId);
    expect(msg.HTMLPart ?? "").toMatch(/Regel een\s*<br\s*\/?>\s*Regel twee/);
    expect(msg.TextPart ?? "").toContain("Regel een\nRegel twee");
  });
});
