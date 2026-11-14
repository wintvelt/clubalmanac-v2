// WP5 audit-follow-up 2026-05-17 — S-3: fail-loud env-var gates.
//
// Audit S-3: `getStageLabel()` en (tot WP19b) `buildInviteUrl(token)` vielen silent
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
import { getStageLabel } from "../../convex/lib/emailTemplates";

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

// S-3b (buildInviteUrl) is vervallen met WP19b: de uitnodigingsmail heeft geen
// link meer (A-invariant 4); `CLUBALMANAC_APP_URL` bestaat niet meer.
