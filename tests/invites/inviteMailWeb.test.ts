// WP35 besluit 7, A-invariant W4: de uitnodigingsmail krijgt naast de App
// Store-knop een regel voor wie geen iPhone heeft, met een link naar de
// webapp. Spec: docs/work-packages/WP35-webapp-bekijken.md §Vraag 7.
//
// Het adres komt uit `CLUBALMANAC_WEB_URL` en geldt alleen als `https://`-
// origin zonder pad of query. Ontbreekt het of is het ongeldig, dan gaat de
// mail zonder die regel en logt de action een fout met de naam (zoals de App
// Store-ID, WP19c A-invariant 9). Eén vast adres: geen token, geen invite-id
// (WP19b besluit 1). Alleen in de uitnodiging zelf.

import { afterEach, describe, expect, it, vi } from "vitest";
import { newT } from "../groups/_beheer";
import { inviteRow } from "./_wp19b";
import {
  APP_STORE_URL,
  APPLE_APP_ID,
  clearMailEnv,
  hrefsIn,
  mailEnv,
  mailFor,
  setup,
  urlsIn,
  WEB_URL_ENV,
} from "./_wp19c";

// Besluit 5 (WP19c): een mail met foto gaat via SMTP. Nooit echt naar Mailjet.
vi.mock("nodemailer", async () => (await import("./_smtp")).nodemailerMock());

const WEB_URL = "https://app.clubalmanac.com";

afterEach(() => clearMailEnv());

function env(appStoreId: string | undefined, webUrl: string | undefined) {
  mailEnv(appStoreId);
  if (webUrl === undefined) delete process.env[WEB_URL_ENV];
  else process.env[WEB_URL_ENV] = webUrl;
}

function errorSpy() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

function loggedAbout(spy: ReturnType<typeof errorSpy>, needle: string): boolean {
  return spy.mock.calls.some((args) => args.map(String).join(" ").includes(needle));
}

const webLinks = (urls: string[]) => urls.filter((u) => /app\.clubalmanac\.com/i.test(u));

describe("W4 — met een geldig webadres", () => {
  it("HTML en tekst: de App Store-link en het webadres, en verder geen URL", async () => {
    env(APPLE_APP_ID, WEB_URL);
    const t = newT();
    const { inviteId } = await setup(t, { message: "Kom erbij" });
    const msg = await mailFor(t, inviteId);
    const html = msg.HTMLPart ?? "";
    const text = msg.TextPart ?? "";

    expect([...hrefsIn(html)].sort()).toEqual([APP_STORE_URL, WEB_URL].sort());
    expect(html.match(/<a\b/gi) ?? []).toHaveLength(2);
    expect(urlsIn(html).every((u) => u === APP_STORE_URL || u === WEB_URL)).toBe(true);
    expect([...new Set(urlsIn(text))].sort()).toEqual([APP_STORE_URL, WEB_URL].sort());
  });

  it("de regel is voor wie geen iPhone heeft, en noemt de browser", async () => {
    env(APPLE_APP_ID, WEB_URL);
    const t = newT();
    const { inviteId } = await setup(t);
    const msg = await mailFor(t, inviteId);
    for (const part of [msg.HTMLPart ?? "", msg.TextPart ?? ""]) {
      expect(part).toMatch(/geen iPhone/i);
      expect(part).toMatch(/browser/i);
    }
  });

  it("de web-regel staat na de App Store-link", async () => {
    env(APPLE_APP_ID, WEB_URL);
    const t = newT();
    const { inviteId } = await setup(t);
    const msg = await mailFor(t, inviteId);
    for (const part of [msg.HTMLPart ?? "", msg.TextPart ?? ""]) {
      const store = part.indexOf(APP_STORE_URL);
      const web = part.indexOf(WEB_URL);
      expect(store).toBeGreaterThanOrEqual(0);
      expect(web).toBeGreaterThan(store);
    }
  });

  it("zonder App Store-ID: alleen het webadres", async () => {
    errorSpy();
    env(undefined, WEB_URL);
    const t = newT();
    const { inviteId } = await setup(t);
    const msg = await mailFor(t, inviteId);
    expect(hrefsIn(msg.HTMLPart ?? "")).toEqual([WEB_URL]);
    expect([...new Set(urlsIn(msg.TextPart ?? ""))]).toEqual([WEB_URL]);
  });

  it("geen token, geen invite-id: het is één vast adres", async () => {
    env(APPLE_APP_ID, WEB_URL);
    const t = newT();
    const { inviteId } = await setup(t);
    const msg = await mailFor(t, inviteId);
    const token = (await inviteRow(t, inviteId))!.token;
    for (const part of [msg.Subject ?? "", msg.HTMLPart ?? "", msg.TextPart ?? ""]) {
      expect(part).not.toContain(token);
      expect(part).not.toContain(String(inviteId));
    }
    for (const u of [...hrefsIn(msg.HTMLPart ?? ""), ...urlsIn(msg.TextPart ?? "")]) {
      if (/app\.clubalmanac\.com/i.test(u)) expect(u).toBe(WEB_URL);
    }
  });

  it("geen fout in de log met een geldig adres", async () => {
    env(APPLE_APP_ID, WEB_URL);
    const spy = errorSpy();
    const t = newT();
    const { inviteId } = await setup(t);
    await mailFor(t, inviteId);
    expect(loggedAbout(spy, WEB_URL_ENV)).toBe(false);
  });

  for (const kind of ["accepted", "declined", "bounced"] as const) {
    it(`mail '${kind}' krijgt de web-link niet`, async () => {
      env(APPLE_APP_ID, WEB_URL);
      const t = newT();
      const { inviteId } = await setup(t);
      const msg = await mailFor(t, inviteId, kind);
      for (const part of [msg.HTMLPart ?? "", msg.TextPart ?? ""]) {
        expect(part).not.toMatch(/app\.clubalmanac\.com/i);
      }
    });
  }
});

describe("W4 — zonder geldig webadres: geen web-link, wel een log", () => {
  const bad: Array<[string, string | undefined]> = [
    ["ontbreekt", undefined],
    ["leeg", ""],
    ["http", "http://app.clubalmanac.com"],
    ["zonder schema", "app.clubalmanac.com"],
    ["met een pad", "https://app.clubalmanac.com/uitnodiging"],
    ["met een query", "https://app.clubalmanac.com?x=1"],
    ["javascript", "javascript:alert(1)"],
    ["met HTML", `https://app.clubalmanac.com"><script>x</script>`],
  ];

  for (const [label, value] of bad) {
    it(`adres ${label}: de mail gaat met de App Store-link, zonder web-link, en de log noemt ${WEB_URL_ENV}`, async () => {
      env(APPLE_APP_ID, value);
      const spy = errorSpy();
      const t = newT();
      const { inviteId } = await setup(t);
      const msg = await mailFor(t, inviteId);

      expect(msg.To?.[0]?.Email).toBe("nina@x.test");
      expect(hrefsIn(msg.HTMLPart ?? "")).toEqual([APP_STORE_URL]);
      for (const part of [msg.HTMLPart ?? "", msg.TextPart ?? ""]) {
        expect(webLinks(urlsIn(part))).toEqual([]);
        expect(part).not.toMatch(/javascript:/i);
        expect(part).not.toMatch(/<script/i);
        expect(part).toContain("Hi Nina");
      }
      expect(loggedAbout(spy, WEB_URL_ENV)).toBe(true);
    });
  }
});
