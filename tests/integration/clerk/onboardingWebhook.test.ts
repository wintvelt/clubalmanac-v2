import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  sessionCreatedPayload,
  signSvixHeaders,
} from "../../_helpers/svix";
import { makeConvexClient } from "../_helpers/convexClient";
import { getConvexSiteBase } from "../_helpers/convexSite";
import { assertNotProd } from "../_helpers/safety";

// ---------------------------------------------------------------------------
// WP11 — Clerk onboarding-webhook (live integration, A → B → audit)
//
// RED-test: pin't de atomic-onboarding-flow tegen de ECHTE gedeployde
// `/clerk-webhook` httpAction, met een echt-getekende Svix-HMAC. De handler
// (convex/http.ts → internal.users.registerFromSession) draait users-insert
// + invite-accept + membership-create in één transactie. De unit-suite
// (tests/clerk/webhookAuth.test.ts, tests/users/registerFromSession.test.ts)
// pint dit al in-process via convex-test; deze laag voegt toe: doet de échte
// route het, met de échte secret, region-suffix-URL, en persisteert het
// atomair op de echte Convex-DB.
//
// === RED tot B de convex/_test.ts-helpers levert ===
// ConvexHttpClient kan alleen PUBLIC functies aanroepen. Er is geen public
// pad om (a) een fixture te seeden, (b) DB-state by-subject terug te lezen,
// of (c) op te ruimen voor een fresh subject zonder Clerk-JWT. Daarom
// verwijst deze test naar NIEUWE test-only helpers in `convex/_test.ts`
// (alle `INTEGRATION_TEST_ENABLED`-gated, WP2-precedent). A bepaalt naam +
// return-shape (zie de makeFunctionReference-blokken hieronder); B
// implementeert tot groen, zonder spec/test-edits.
//
// Helper-set die B moet leveren (6 — A breidt de 4 uit de spec uit met een
// seed-helper + een seed-cleanup-helper; zónder seed is de invite-accept +
// membership + drie-velden-timestamp-pin niet tegen de echte DB te maken):
//   1. seedOnboardingFixture(mutation)   — maakt inviter-user + group +
//        pending invite voor `email`; returnt de drie ids
//   2. getUserBySubject(query)           — users-row | null
//   3. listInvitesByEmail(query)         — invite-rows[]
//   4. listMembershipsByUserId(query)    — membership-rows[]
//   5. cleanupUserBySubject(mutation)    — delete albumLastSeen + memberships
//        + users-row voor de onboarded subject; count-return
//   6. cleanupOnboardingSeed(mutation)   — delete invite + group + inviter;
//        count-return
//
// Niet in CI. Lokaal: `npm run test:integration`. Skipt luid bij ontbrekende
// env-vars (geen stille pass).
// ---------------------------------------------------------------------------

const REQUIRED_ENV = ["CONVEX_URL", "CLERK_WEBHOOK_SECRET"] as const;
const missing = REQUIRED_ENV.filter(
  (k) => !process.env[k] || process.env[k]!.length === 0,
);
const enabled = missing.length === 0;

// --- Return-shapes die B's helpers moeten respecteren (subset van de docs) --
type UserRow = {
  _id: Id<"users">;
  subject: string;
  email: string;
  name?: string;
  createdAt: number;
};
type InviteRow = {
  _id: Id<"invites">;
  email: string;
  status: "pending" | "accepted" | "declined" | "expired";
  groupId?: Id<"groups">;
  role?: "admin" | "member";
  respondedAt?: number;
};
type MembershipRow = {
  _id: Id<"memberships">;
  userId: Id<"users">;
  groupId: Id<"groups">;
  role: "admin" | "member";
  joinedAt: number;
};
type SeedResult = {
  inviterUserId: Id<"users">;
  groupId: Id<"groups">;
  inviteId: Id<"invites">;
};
type CleanupCount = { deleted: Record<string, number>; total: number };

// --- Typed references naar de (nog te bouwen) convex/_test.ts-helpers -------
const seedOnboardingFixture = makeFunctionReference<
  "mutation",
  { email: string },
  SeedResult
>("_test:seedOnboardingFixture");
const getUserBySubject = makeFunctionReference<
  "query",
  { subject: string },
  UserRow | null
>("_test:getUserBySubject");
const listInvitesByEmail = makeFunctionReference<
  "query",
  { email: string },
  InviteRow[]
>("_test:listInvitesByEmail");
const listMembershipsByUserId = makeFunctionReference<
  "query",
  { userId: Id<"users"> },
  MembershipRow[]
>("_test:listMembershipsByUserId");
const cleanupUserBySubject = makeFunctionReference<
  "mutation",
  { subject: string },
  CleanupCount
>("_test:cleanupUserBySubject");
const cleanupOnboardingSeed = makeFunctionReference<
  "mutation",
  { inviteId: Id<"invites">; groupId: Id<"groups">; inviterUserId: Id<"users"> },
  CleanupCount
>("_test:cleanupOnboardingSeed");

// Vast wrong-secret voor de tamper-test (zelfde whsec_-vorm als Clerk levert,
// maar niet de echte secret → signature-verify faalt → 401).
const WRONG_SECRET = "whsec_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA=";

describe("WP11 — Clerk onboarding-webhook (live, RED tot convex/_test.ts-helpers)", () => {
  if (!enabled) {
    it.skip(
      `SKIP: ontbrekende env-vars (${missing.join(", ")}) — zie .env.integration.example §WP11`,
      () => {},
    );
    return;
  }

  const secret = process.env.CLERK_WEBHOOK_SECRET!;
  let client: ConvexHttpClient;
  let webhookUrl: string;

  // Fresh per run zodat de INSERT-pad geraakt wordt (niet het idempotency-
  // no-op-pad). Bestaand `clubalmanac-integration-regular@example.com` NIET
  // hergebruiken — dat zou onboarding niet meer triggeren (invariant 5).
  const subject = `user_wp11_${randomUUID()}`;
  const email = `wp11-onboard-${randomUUID()}@example.com`;
  let seed: SeedResult | null = null;

  beforeAll(async () => {
    assertNotProd(requireConvexUrl());
    client = makeConvexClient();
    webhookUrl = `${getConvexSiteBase()}/clerk-webhook`;
    // Seed een pending invite (met group) voor `email` zodat de webhook-flow
    // het invite-accept + membership-create pad daadwerkelijk raakt.
    seed = await client.mutation(seedOnboardingFixture, { email });
  });

  afterAll(async () => {
    // Best-effort safety-net naast de expliciete cleanup-test. Faalt
    // geruisloos — de DB-staat-assert leeft in de cleanup-test.
    try {
      await client.mutation(cleanupUserBySubject, { subject });
    } catch {
      // best-effort
    }
    if (seed) {
      try {
        await client.mutation(cleanupOnboardingSeed, {
          inviteId: seed.inviteId,
          groupId: seed.groupId,
          inviterUserId: seed.inviterUserId,
        });
      } catch {
        // best-effort
      }
    }
  });

  it(
    "synth session.created + echte Svix-HMAC → 200 + atomic onboarding (user + invite-accept + membership, gelijke timestamp op 3 velden)",
    async () => {
      const body = sessionCreatedPayload({
        subject,
        email,
        firstName: "WP11",
        lastName: "Onboard",
        emailVerified: true,
      });
      const headers = signSvixHeaders({ body, secret });

      const res = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body,
      });
      expect(res.status).toBe(200);

      // users-row aangemaakt met juiste email + naam
      const user = await client.query(getUserBySubject, { subject });
      expect(user).not.toBeNull();
      expect(user!.subject).toBe(subject);
      expect(user!.email).toBe(email.toLowerCase());
      expect(user!.name).toBe("WP11 Onboard");

      // seeded invite is ge-accept (status + respondedAt)
      const invites = await client.query(listInvitesByEmail, { email });
      const accepted = invites.filter((i) => i.status === "accepted");
      expect(accepted).toHaveLength(1);
      const invite = accepted[0]!;
      expect(invite.respondedAt).toBeDefined();
      expect(invite.groupId).toBe(seed!.groupId);

      // membership aangemaakt per geaccepteerde invite
      const memberships = await client.query(listMembershipsByUserId, {
        userId: user!._id,
      });
      expect(memberships).toHaveLength(1);
      const membership = memberships[0]!;
      expect(membership.groupId).toBe(seed!.groupId);
      expect(membership.role).toBe("member");

      // Atomic-pin: alle drie writes delen exact dezelfde `now`-timestamp,
      // verspreid over drie verschillende velden in drie tabellen
      // (users.createdAt / invites.respondedAt / memberships.joinedAt).
      expect(invite.respondedAt).toBe(user!.createdAt);
      expect(membership.joinedAt).toBe(user!.createdAt);

      // Re-login-pad: tweede webhook met HETZELFDE subject → 200 idempotent
      // no-op, géén tweede membership (re-login != onboarding;
      // registerFromSession returnt vroeg op bestaand subject).
      const headers2 = signSvixHeaders({ body, secret });
      const res2 = await fetch(webhookUrl, {
        method: "POST",
        headers: headers2,
        body,
      });
      expect(res2.status).toBe(200);
      const membershipsAfter = await client.query(listMembershipsByUserId, {
        userId: user!._id,
      });
      expect(membershipsAfter).toHaveLength(1);
    },
    30_000,
  );

  it(
    "gemanipuleerde signature (verkeerd secret) → 401, geen state-mutatie",
    async () => {
      const tamperSubject = `user_wp11_tamper_${randomUUID()}`;
      const tamperEmail = `wp11-tamper-${randomUUID()}@example.com`;
      const body = sessionCreatedPayload({
        subject: tamperSubject,
        email: tamperEmail,
        emailVerified: true,
      });
      // Teken met een ANDER secret dan de deployment kent → verify faalt.
      const headers = signSvixHeaders({ body, secret: WRONG_SECRET });

      const res = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body,
      });
      expect(res.status).toBe(401);

      // Geen users-row aangemaakt (verify faalt vóór registerFromSession).
      const user = await client.query(getUserBySubject, {
        subject: tamperSubject,
      });
      expect(user).toBeNull();
    },
    30_000,
  );

  it("cleanup verwijdert alle fixture-state — DB terug naar baseline", async () => {
    const userCleanup = await client.mutation(cleanupUserBySubject, {
      subject,
    });
    // count-return-discipline (integration-tests.md): gestructureerde counts.
    expect(userCleanup.deleted.users).toBe(1);
    expect(userCleanup.deleted.memberships).toBe(1);

    const seedCleanup = await client.mutation(cleanupOnboardingSeed, {
      inviteId: seed!.inviteId,
      groupId: seed!.groupId,
      inviterUserId: seed!.inviterUserId,
    });
    expect(seedCleanup.deleted.invites).toBe(1);
    expect(seedCleanup.deleted.groups).toBe(1);
    expect(seedCleanup.deleted.inviters).toBe(1);

    // DB-staat terug naar baseline: subject + invites weg.
    const user = await client.query(getUserBySubject, { subject });
    expect(user).toBeNull();
    const invites = await client.query(listInvitesByEmail, { email });
    expect(invites).toHaveLength(0);
  });
});

function requireConvexUrl(): string {
  const v = process.env.CONVEX_URL;
  if (!v || v.length === 0) {
    throw new Error(
      "CONVEX_URL ontbreekt. Zet 'm in .env.integration (zie .env.integration.example).",
    );
  }
  return v;
}
