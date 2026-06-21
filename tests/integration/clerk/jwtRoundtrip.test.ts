import { beforeAll, describe, expect, it } from "vitest";
import {
  mintTokenForEmail,
  revokeSessionQuietly,
} from "../_helpers/clerkAuth";
import { getConvexSiteBase, requireEnv } from "../_helpers/convexSite";

// ---------------------------------------------------------------------------
// Clerk JWT roundtrip — live integration tests (WP4)
//
// Productie-blind-spot: de unit-suite simuleert de email-claim via
// `t.withIdentity({ email })` en weet daardoor niets over of de Clerk
// JWT-template "convex" daadwerkelijk de `email`-claim doorlevert in
// productie. Plan-doc r.251 markeerde dit gat al — deze suite pint het.
//
// Architectuur:
//   - `_helpers/clerkAuth.ts` mint een echte session-JWT via
//     `@clerk/backend` voor een test-user (regular of webmaster).
//   - Tests sturen die JWT als `Authorization: Bearer <jwt>` naar een
//     test-only `whoami` httpAction op de Convex dev-deployment.
//   - `whoami` reflecteert subset van `ctx.auth.getUserIdentity()` plus
//     een `webmaster: boolean` (via try/catch op `requireWebmaster`).
//   - Env-var-gate `INTEGRATION_TEST_ENABLED === "true"` op dev-deploy,
//     consistent met WP2 patroon. Zie convex/_test.ts en
//     docs/conventions/integration-tests.md.
//
// Niet in CI. Lokaal: `npm run test:integration`.
//
// PRE-REQ:
//   1. Twee test-users handmatig in Clerk dev dashboard:
//      - CLERK_TEST_USER_REGULAR_EMAIL    (zonder webmaster-rol)
//      - CLERK_TEST_USER_WEBMASTER_EMAIL  (op WEBMASTER_EMAILS lijst)
//   2. Op Convex dev-deployment: `INTEGRATION_TEST_ENABLED=true` én
//      `WEBMASTER_EMAILS` bevat de webmaster-test-user.
// ---------------------------------------------------------------------------

const WHOAMI_PATH = "/_test/whoami";

describe("Clerk JWT roundtrip — live integration", () => {
  let regularEmail: string;
  let webmasterEmail: string;
  let whoamiUrl: string;

  beforeAll(() => {
    regularEmail = requireEnv("CLERK_TEST_USER_REGULAR_EMAIL").toLowerCase();
    webmasterEmail = requireEnv(
      "CLERK_TEST_USER_WEBMASTER_EMAIL",
    ).toLowerCase();
    whoamiUrl = `${getConvexSiteBase()}${WHOAMI_PATH}`;
  });

  it("regular user JWT → whoami reflecteert email + subject, webmaster=false", async () => {
    const { jwt, userId, sessionId } = await mintTokenForEmail(regularEmail);
    try {
      const res = await fetch(whoamiUrl, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        email?: string;
        subject?: string;
        webmaster?: boolean;
      };
      expect(typeof body.email).toBe("string");
      expect(body.email?.toLowerCase()).toBe(regularEmail);
      expect(body.subject).toBe(userId);
      expect(body.webmaster).toBe(false);
    } finally {
      await revokeSessionQuietly(sessionId);
    }
  });

  it("webmaster user JWT → whoami reflecteert email, webmaster=true", async () => {
    const { jwt, userId, sessionId } = await mintTokenForEmail(webmasterEmail);
    try {
      const res = await fetch(whoamiUrl, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        email?: string;
        subject?: string;
        webmaster?: boolean;
      };
      expect(body.email?.toLowerCase()).toBe(webmasterEmail);
      expect(body.subject).toBe(userId);
      // Pin't dat requireWebmaster werkt op een ECHTE JWT, niet alleen
      // op vitest's withIdentity-mock. Vereist dat WEBMASTER_EMAILS op de
      // dev-deployment de webmaster-test-user bevat én dat er een users-
      // record bestaat voor deze identity (audit-7 §3 dubbele gate).
      expect(body.webmaster).toBe(true);
    } finally {
      await revokeSessionQuietly(sessionId);
    }
  });

  it("zonder Authorization header → 401 (geen identity)", async () => {
    const res = await fetch(whoamiUrl);
    expect(res.status).toBe(401);
  });

  it("invalid Bearer token → 401 (handler vangt JWT-validatie-throw af)", async () => {
    // Empirisch (WP4 niveau-2): Convex `getUserIdentity()` throwt op
    // ongeldige JWT (signature/issuer mismatch) ipv null te retourneren.
    // De httpAction wraps die call in try/catch zodat zowel "geen header"
    // als "invalid token" hetzelfde 401-pad volgen — consistente auth-fail
    // semantiek + geen 500-leak van server-side auth-error-detail.
    const res = await fetch(whoamiUrl, {
      headers: { Authorization: "Bearer not-a-real-jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("/upload met invalid Bearer → 401 (zelfde JWT-throw-handling als /_test/whoami)", async () => {
    // WP4 follow-up: /upload had hetzelfde 500-pad als /_test/whoami had
    // vóór de housekeeping-fix. Audit WP4 vlagde dit als productie-relevante
    // hardening (info-leak risk). Deze test pin't dat /upload nu 401 geeft
    // op invalid Bearer, consistent met /_test/whoami.
    //
    // Geen body/headers nodig: handler weigert vóór de body wordt ingelezen.
    const uploadUrl = `${getConvexSiteBase()}/upload`;
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: "Bearer not-a-real-jwt" },
    });
    expect(res.status).toBe(401);
  });
});
