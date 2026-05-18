// WP6 RED-phase: /clerk-webhook Svix Standard-Webhooks auth.
//
// Clerk pushes webhooks via Svix-infrastructure met drie verplichte headers
// (svix-id, svix-timestamp, svix-signature). De Svix-secret (`whsec_<base64>`
// uit Clerk dashboard webhook-config) wordt op de Convex-deployment opgeslagen
// als `CLERK_WEBHOOK_SECRET`. B's impl gebruikt `@clerk/backend.verifyWebhook`
// met expliciete `{ signingSecret }`-pass-through (zie WP6-spec §Svix-lib-keuze).
//
// Fail-modes (pin's hier):
//   - CLERK_WEBHOOK_SECRET ontbreekt → 503 (fail-closed, à la Mailjet-pattern)
//   - Eén van svix-id/timestamp/signature ontbreekt → 401
//   - Signature voor andere body / met andere secret → 401
//   - Geldige headers → 200 + state-mutatie via registerFromSession
//
// Voor happy-path tekenen we signatures met `standardwebhooks` (transitive dep
// via `@clerk/backend`), zie `tests/_helpers/svix.ts`.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "../../convex/schema";
import {
  signSvixHeaders,
  sessionCreatedPayload,
  TEST_WEBHOOK_SECRET,
} from "../_helpers/svix";

beforeEach(() => {
  process.env.CLERK_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
});

afterEach(() => {
  delete process.env.CLERK_WEBHOOK_SECRET;
});

describe("/clerk-webhook — env-var fail-closed", () => {
  it("CLERK_WEBHOOK_SECRET ontbreekt → 503, geen state-mutatie", async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    const t = convexTest(schema);
    const body = sessionCreatedPayload({
      subject: "user_alice",
      email: "alice@x.com",
    });
    const headers = signSvixHeaders({ body });

    const res = await t.fetch("/clerk-webhook", {
      method: "POST",
      headers,
      body,
    });

    expect(res.status).toBe(503);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });
});

describe("/clerk-webhook — Svix-headers validation", () => {
  it("geen svix-headers → 401, geen state-mutatie", async () => {
    const t = convexTest(schema);
    const body = sessionCreatedPayload({
      subject: "user_alice",
      email: "alice@x.com",
    });

    const res = await t.fetch("/clerk-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    expect(res.status).toBe(401);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });

  it("svix-id ontbreekt → 401", async () => {
    const t = convexTest(schema);
    const body = sessionCreatedPayload({
      subject: "user_alice",
      email: "alice@x.com",
    });
    const headers = signSvixHeaders({ body });
    delete (headers as Record<string, string>)["svix-id"];

    const res = await t.fetch("/clerk-webhook", {
      method: "POST",
      headers,
      body,
    });

    expect(res.status).toBe(401);
  });

  it("svix-timestamp ontbreekt → 401", async () => {
    const t = convexTest(schema);
    const body = sessionCreatedPayload({
      subject: "user_alice",
      email: "alice@x.com",
    });
    const headers = signSvixHeaders({ body });
    delete (headers as Record<string, string>)["svix-timestamp"];

    const res = await t.fetch("/clerk-webhook", {
      method: "POST",
      headers,
      body,
    });

    expect(res.status).toBe(401);
  });

  it("svix-signature ontbreekt → 401", async () => {
    const t = convexTest(schema);
    const body = sessionCreatedPayload({
      subject: "user_alice",
      email: "alice@x.com",
    });
    const headers = signSvixHeaders({ body });
    delete (headers as Record<string, string>)["svix-signature"];

    const res = await t.fetch("/clerk-webhook", {
      method: "POST",
      headers,
      body,
    });

    expect(res.status).toBe(401);
  });

  it("signature met verkeerd secret → 401, geen state-mutatie", async () => {
    const t = convexTest(schema);
    const body = sessionCreatedPayload({
      subject: "user_alice",
      email: "alice@x.com",
    });
    const headers = signSvixHeaders({
      body,
      secret: "whsec_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA=",
    });

    const res = await t.fetch("/clerk-webhook", {
      method: "POST",
      headers,
      body,
    });

    expect(res.status).toBe(401);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });

  it("signature van andere body (replay/tamper) → 401, geen state-mutatie", async () => {
    // Pin't dat het hele body-bytes-veld in de signature mee gaat. Aanvaller
    // die een geldige signature van vorige delivery kopieert maar de body
    // muteert (andere email, andere subject) wordt afgevangen.
    const t = convexTest(schema);
    const goodBody = sessionCreatedPayload({
      subject: "user_alice",
      email: "alice@x.com",
    });
    const headers = signSvixHeaders({ body: goodBody });
    const tamperedBody = sessionCreatedPayload({
      subject: "user_attacker",
      email: "attacker@x.com",
    });

    const res = await t.fetch("/clerk-webhook", {
      method: "POST",
      headers,
      body: tamperedBody,
    });

    expect(res.status).toBe(401);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });

  it("geldige Svix-headers + session.created → 200, users-row aangemaakt", async () => {
    const t = convexTest(schema);
    const body = sessionCreatedPayload({
      subject: "user_alice",
      email: "alice@x.com",
      firstName: "Alice",
      lastName: "Anderson",
    });
    const headers = signSvixHeaders({ body });

    const res = await t.fetch("/clerk-webhook", {
      method: "POST",
      headers,
      body,
    });

    expect(res.status).toBe(200);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    expect(users[0]?.subject).toBe("user_alice");
    expect(users[0]?.email).toBe("alice@x.com");
  });
});
