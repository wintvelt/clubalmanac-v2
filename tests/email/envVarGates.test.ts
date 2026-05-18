// WP5 audit-follow-up 2026-05-17 — S-3: fail-loud env-var gates.
//
// Audit S-3: `getStageLabel()` en `buildInviteUrl(token)` vallen nu silent
// terug op `"dev"` resp. `"https://clubalmanac.com"` als de env-var unset is
// (zie `convex/lib/emailTemplates.ts:235` en `:243`). Voor prod-deploy is
// dat een ops-bug die maandenlang onopgemerkt kan blijven (mails verzonden
// met verkeerde stage-label of clubalmanac.com-domain).
//
// RED-spec: beide helpers moeten throwen met een gepin'de prefix als de
// env-var unset of leeg is. B vervangt de `?? "..."`-fallback door
// fail-loud throw in de volgende cyclus.
//
// Plus happy-path-tests die pinnen dat met env-var gezet de helpers
// werken zoals voorheen (regression-guard tegen B's fix).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildInviteUrl,
  getStageLabel,
} from "../../convex/lib/emailTemplates";

// Bewaar de oorspronkelijke waarden zodat tests die env-vars zetten geen
// state lekken naar andere test-files (mailjetClient/sendInviteEmail
// zetten zélf hun env-vars maar herstellen niet altijd CLUBALMANAC_*).
let originalStage: string | undefined;
let originalAppUrl: string | undefined;

beforeEach(() => {
  originalStage = process.env.CLUBALMANAC_STAGE;
  originalAppUrl = process.env.CLUBALMANAC_APP_URL;
  delete process.env.CLUBALMANAC_STAGE;
  delete process.env.CLUBALMANAC_APP_URL;
});

afterEach(() => {
  if (originalStage === undefined) delete process.env.CLUBALMANAC_STAGE;
  else process.env.CLUBALMANAC_STAGE = originalStage;
  if (originalAppUrl === undefined) delete process.env.CLUBALMANAC_APP_URL;
  else process.env.CLUBALMANAC_APP_URL = originalAppUrl;
});

// ---------------------------------------------------------------------------
// S-3a: getStageLabel — fail-loud bij ontbrekende CLUBALMANAC_STAGE
// ---------------------------------------------------------------------------

describe("getStageLabel — fail-loud bij missing env-var (S-3)", () => {
  it("CLUBALMANAC_STAGE unset → throwt STAGE_MISSING:-prefix", async () => {
    // Geen env-var → silent fallback naar "dev" was ops-bug.
    // Verwacht: throw met `STAGE_MISSING:` prefix zodat callers de cause
    // duidelijk zien in logs.
    delete process.env.CLUBALMANAC_STAGE;
    expect(() => getStageLabel()).toThrow(/^STAGE_MISSING:/);
  });

  it("CLUBALMANAC_STAGE = '' (leeg) → throwt STAGE_MISSING:-prefix", async () => {
    // Lege string is geen geldige stage-label. Same fail-loud-pad als
    // ontbrekend (anders verschuilt een verkeerd-geconfigureerde deploy
    // zich achter een lege string).
    process.env.CLUBALMANAC_STAGE = "";
    expect(() => getStageLabel()).toThrow(/^STAGE_MISSING:/);
  });

  it("CLUBALMANAC_STAGE = 'dev' → retourneert 'dev' (happy-path, regression-guard)", async () => {
    process.env.CLUBALMANAC_STAGE = "dev";
    expect(getStageLabel()).toBe("dev");
  });

  it("CLUBALMANAC_STAGE = 'prod' → retourneert 'prod' (happy-path)", async () => {
    process.env.CLUBALMANAC_STAGE = "prod";
    expect(getStageLabel()).toBe("prod");
  });
});

// ---------------------------------------------------------------------------
// S-3b: buildInviteUrl — fail-loud bij ontbrekende CLUBALMANAC_APP_URL
// ---------------------------------------------------------------------------

describe("buildInviteUrl — fail-loud bij missing env-var (S-3)", () => {
  it("CLUBALMANAC_APP_URL unset → throwt APP_URL_MISSING:-prefix", async () => {
    // Silent fallback naar "https://clubalmanac.com" zou invite-links
    // genereren naar een prod-domein vanaf een dev-deployment. Fail-loud.
    delete process.env.CLUBALMANAC_APP_URL;
    expect(() => buildInviteUrl("token-abc")).toThrow(/^APP_URL_MISSING:/);
  });

  it("CLUBALMANAC_APP_URL = '' (leeg) → throwt APP_URL_MISSING:-prefix", async () => {
    process.env.CLUBALMANAC_APP_URL = "";
    expect(() => buildInviteUrl("token-abc")).toThrow(/^APP_URL_MISSING:/);
  });

  it("CLUBALMANAC_APP_URL = 'https://app.example.com' → bevat base + token (happy-path)", async () => {
    // Pin't dat de happy-path concat-behavior van vóór de fix-change blijft
    // werken: base + /invite/ + url-encoded token.
    process.env.CLUBALMANAC_APP_URL = "https://app.example.com";
    const url = buildInviteUrl("token-abc");
    expect(url).toContain("https://app.example.com");
    expect(url).toContain("token-abc");
  });

  it("trailing slash op CLUBALMANAC_APP_URL wordt gestript (geen dubbele slash)", async () => {
    // Bestaand gedrag in `:235` (`.replace(/\/+$/, "")`) blijft consistent
    // na fix — regression-guard.
    process.env.CLUBALMANAC_APP_URL = "https://app.example.com/";
    const url = buildInviteUrl("tok");
    expect(url.startsWith("https://app.example.com/invite/")).toBe(true);
    expect(url).not.toContain("//invite/");
  });

  it("token wordt url-encoded in de pad-positie", async () => {
    process.env.CLUBALMANAC_APP_URL = "https://app.example.com";
    const url = buildInviteUrl("tok en met spatie");
    expect(url).toContain(encodeURIComponent("tok en met spatie"));
  });
});
