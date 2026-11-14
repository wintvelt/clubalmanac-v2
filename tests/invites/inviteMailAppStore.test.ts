// WP19c besluit 3, invariant 8, A-invariant 9: één vaste link naar de app in
// de App Store. Spec: docs/work-packages/WP19c-uitnodigingsmail-opmaak.md.
//
// De Apple ID komt uit de env-var `CLUBALMANAC_APP_STORE_ID` (A-keuze 4). Deze
// tests gebruiken een placeholder; de echte ID staat nergens in de code.
// Ontbreekt de ID, of is hij geen 6–12 cijfers, dan gaat de mail zonder link
// en logt de action een fout met de naam van de env-var (niet stil).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newT } from "../groups/_beheer";
import { inviteRow } from "./_wp19b";
import {
  APP_STORE_ENV,
  APP_STORE_URL,
  clearMailEnv,
  hrefsIn,
  mailEnv,
  mailFor,
  PLACEHOLDER_APP_ID,
  setup,
  urlsIn,
} from "./_wp19c";

afterEach(() => clearMailEnv());

function errorSpy() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

function loggedAbout(spy: ReturnType<typeof errorSpy>, needle: string): boolean {
  return spy.mock.calls.some((args) => args.map(String).join(" ").includes(needle));
}

describe("A-invariant 9 — met een geldige ID", () => {
  beforeEach(() => mailEnv(PLACEHOLDER_APP_ID));

  it("de App Store-URL is de enige link en de enige URL, in HTML en tekst", async () => {
    const t = newT();
    const { inviteId } = await setup(t, { message: "Kom erbij" });
    const msg = await mailFor(t, inviteId);
    const html = msg.HTMLPart ?? "";
    const text = msg.TextPart ?? "";

    expect(hrefsIn(html)).toEqual([APP_STORE_URL]);
    expect(html.match(/<a\b/gi) ?? []).toHaveLength(1);
    expect(urlsIn(html).every((u) => u === APP_STORE_URL)).toBe(true);
    expect(urlsIn(html).length).toBeGreaterThan(0);
    expect(urlsIn(text)).toEqual([APP_STORE_URL]);
  });

  it("de tekst zegt dat het voor een iPhone is, en noemt de App Store", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    const msg = await mailFor(t, inviteId);
    for (const part of [msg.HTMLPart ?? "", msg.TextPart ?? ""]) {
      expect(part).toMatch(/iPhone/);
      expect(part).toMatch(/App Store/);
    }
  });

  it("geen token en geen persoonlijke link (WP19b besluit 1 blijft)", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    const msg = await mailFor(t, inviteId);
    const token = (await inviteRow(t, inviteId))!.token;
    for (const part of [msg.Subject ?? "", msg.HTMLPart ?? "", msg.TextPart ?? ""]) {
      expect(part).not.toContain(token);
      expect(part).not.toContain(String(inviteId));
      expect(part).not.toMatch(/clubalmanac:\/\//i);
    }
  });

  it("geen fout in de log met een geldige ID", async () => {
    const spy = errorSpy();
    const t = newT();
    const { inviteId } = await setup(t);
    await mailFor(t, inviteId);
    expect(loggedAbout(spy, APP_STORE_ENV)).toBe(false);
  });

  for (const kind of ["accepted", "declined", "bounced"] as const) {
    it(`mail '${kind}' krijgt de link niet`, async () => {
      const t = newT();
      const { inviteId } = await setup(t);
      const msg = await mailFor(t, inviteId, kind);
      for (const part of [msg.HTMLPart ?? "", msg.TextPart ?? ""]) expect(part).not.toMatch(/apps\.apple\.com/i);
    });
  }
});

describe("A-invariant 9 — zonder geldige ID: geen link, wel een log", () => {
  const bad: Array<[string, string | undefined]> = [
    ["ontbreekt", undefined],
    ["leeg", ""],
    ["letters", "abcdefghij"],
    ["te kort", "12345"],
    ["te lang", "1234567890123"],
    ["met een pad", "1234567/../x"],
    ["met HTML", `1234567890"><script>x</script>`],
  ];

  for (const [label, value] of bad) {
    it(`ID ${label}: de mail gaat, zonder link of URL, en de log noemt ${APP_STORE_ENV}`, async () => {
      mailEnv(value);
      const spy = errorSpy();
      const t = newT();
      const { inviteId } = await setup(t);
      const msg = await mailFor(t, inviteId);

      expect(msg.To?.[0]?.Email).toBe("nina@x.test");
      for (const part of [msg.HTMLPart ?? "", msg.TextPart ?? ""]) {
        expect(part).not.toMatch(/<a\b/i);
        expect(part).not.toMatch(/href=/i);
        expect(urlsIn(part)).toEqual([]);
        expect(part).not.toMatch(/apps\.apple\.com/i);
        expect(part).toContain("Hi Nina");
        if (value) expect(part).not.toContain(value);
      }
      expect(loggedAbout(spy, APP_STORE_ENV)).toBe(true);
    });
  }
});
