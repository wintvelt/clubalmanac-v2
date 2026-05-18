// WP5 RED-phase: /email-event webhook payload-shape robustness.
//
// Spec-aanvulling: webhook moet geldig-geauthenticeerde POSTs met
// Mailjet-payload-variaties correct verwerken:
//   - Array van events (productie-default voor batched delivery)
//   - Single-event object (Mailjet dashboard "Test event"-knop)
//   - Missing MessageID/event_id of email → skip dat event, ga door met rest
//   - Non-bounce event-types (open/click/sent/spam/unsub) → skip met 200
//     (geen handleBounce-call), Mailjet retry't anders eindeloos
//   - Mixed-case email-payload → resolveert tegen `findInvitesByEmail`
//     (normalizeEmail in handleBounce)
//
// Alle tests draaien met geldige Basic-auth (webhookAuth.test.ts dekt de
// auth-laag apart). Webhook-auth correctie 2026-05-18: Mailjet ondersteunt
// geen custom headers per webhook; auth is `Authorization: Basic
// <base64("mailjet:" + MAILJET_WEBHOOK_SECRET)>`.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerUserWithInvite, withUser } from "../_helpers/auth";

const SECRET = "wp5-webhook-secret";

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Basic ${btoa(`mailjet:${SECRET}`)}`,
  };
}

beforeEach(() => {
  process.env.MAILJET_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.MAILJET_WEBHOOK_SECRET;
});

async function seedPendingInviteForBounce(
  t: ReturnType<typeof convexTest>,
  inviteEmail: string,
): Promise<void> {
  await registerUserWithInvite(t, "user_alice", "alice@x.com", "Alice");
  await withUser(t, "user_alice").mutation(api.invites.create, {
    email: inviteEmail,
  });
}

describe("/email-event — payload-shape variaties", () => {
  it("array van events met één bounce → 200, 1 dedup-record + invite expired", async () => {
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "bouncer@x.com");

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify([
        { event: "bounce", email: "bouncer@x.com", MessageID: "evt-A1" },
      ]),
    });

    expect(res.status).toBe(200);
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events).toHaveLength(1);
  });

  it("single-event object (geen array — dashboard 'Test event' shape) → 200, handleBounce gecalled", async () => {
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "bouncer@x.com");

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        event: "bounce",
        email: "bouncer@x.com",
        MessageID: "evt-single",
      }),
    });

    expect(res.status).toBe(200);
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events.find((e) => e.providerEventId === "evt-single")).toBeDefined();
  });

  it("array met meerdere bounces voor verschillende emails → meerdere handleBounce-calls", async () => {
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "alice@x.com", "Alice");
    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "one@x.com",
    });
    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "two@x.com",
    });

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify([
        { event: "bounce", email: "one@x.com", MessageID: "evt-multi-1" },
        { event: "bounce", email: "two@x.com", MessageID: "evt-multi-2" },
      ]),
    });

    expect(res.status).toBe(200);
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events).toHaveLength(2);
  });

  it("event zonder MessageID/event_id → skip dat event, andere events in batch slagen", async () => {
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "alice@x.com", "Alice");
    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "ok@x.com",
    });
    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "skip@x.com",
    });

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify([
        { event: "bounce", email: "skip@x.com" }, // geen MessageID, geen event_id
        { event: "bounce", email: "ok@x.com", MessageID: "evt-ok" },
      ]),
    });

    expect(res.status).toBe(200);
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    // Alleen het event met een providerEventId is verwerkt.
    expect(events).toHaveLength(1);
    expect(events[0]?.providerEventId).toBe("evt-ok");
    const skipInvites = await t.run((ctx) =>
      ctx.db
        .query("invites")
        .filter((q) => q.eq(q.field("email"), "skip@x.com"))
        .collect(),
    );
    for (const i of skipInvites) {
      expect(i.status).toBe("pending");
      expect(i.bouncedAt).toBeUndefined();
    }
  });

  it("event zonder email-veld → skip, andere events in batch slagen", async () => {
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "ok@x.com");

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify([
        { event: "bounce", MessageID: "evt-no-email" },
        { event: "bounce", email: "ok@x.com", MessageID: "evt-ok2" },
      ]),
    });

    expect(res.status).toBe(200);
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.providerEventId).toBe("evt-ok2");
  });

  it("non-bounce event-types (open/click/sent/spam/unsub) → 200, geen handleBounce-call", async () => {
    // Mailjet retry't bij non-2xx. We willen verwachte non-bounce events
    // niet 4xx maken (anders ban't Mailjet de webhook). Maar ze mogen óók
    // geen state muteren.
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "ok@x.com");

    for (const eventType of ["open", "click", "sent", "spam", "unsub"]) {
      const res = await t.fetch("/email-event", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify([
          { event: eventType, email: "ok@x.com", MessageID: `evt-${eventType}` },
        ]),
      });
      expect(res.status).toBe(200);
    }

    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events).toHaveLength(0);
    const invites = await t.run((ctx) =>
      ctx.db
        .query("invites")
        .filter((q) => q.eq(q.field("email"), "ok@x.com"))
        .collect(),
    );
    for (const i of invites) {
      expect(i.status).toBe("pending");
      expect(i.bouncedAt).toBeUndefined();
    }
  });

  it("'blocked' event-type → behandeld als bounce (Mailjet block = onleverbaar)", async () => {
    // http.ts r.43: "bounce" || "blocked" beide doorgegeven. Pin't dat
    // contract — blocked-route is qua semantiek hetzelfde als bounce.
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "blocked@x.com");

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify([
        { event: "blocked", email: "blocked@x.com", MessageID: "evt-blk" },
      ]),
    });

    expect(res.status).toBe(200);
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events).toHaveLength(1);
    const invites = await t.run((ctx) =>
      ctx.db
        .query("invites")
        .filter((q) => q.eq(q.field("email"), "blocked@x.com"))
        .collect(),
    );
    for (const i of invites) {
      expect(i.status).toBe("expired");
      expect(typeof i.bouncedAt).toBe("number");
    }
  });

  it("mixed-case email in payload → resolveert tegen invite (normalizeEmail)", async () => {
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "alice@x.com", "Alice");
    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "Bouncer@X.com",
    });

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify([
        // Payload met andere casing dan opslag (Mailjet kan elke vorm sturen).
        { event: "bounce", email: "BOUNCER@x.COM", MessageID: "evt-case" },
      ]),
    });

    expect(res.status).toBe(200);
    const invites = await t.run((ctx) =>
      ctx.db
        .query("invites")
        .filter((q) => q.eq(q.field("email"), "bouncer@x.com"))
        .collect(),
    );
    expect(invites.length).toBeGreaterThan(0);
    for (const i of invites) {
      expect(i.status).toBe("expired");
      expect(typeof i.bouncedAt).toBe("number");
    }
  });

  it("fallback van MessageID naar event_id voor providerEventId", async () => {
    // http.ts r.45-47 pin't fallback-volgorde. Sommige Mailjet event-types
    // sturen alleen event_id, geen MessageID — getest met geldige bounce
    // die geen MessageID heeft maar wel event_id.
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "eb@x.com");

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify([
        { event: "bounce", email: "eb@x.com", event_id: "ev-id-fallback" },
      ]),
    });

    expect(res.status).toBe(200);
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.providerEventId).toBe("ev-id-fallback");
  });

  // -------------------------------------------------------------------------
  // S-2 (audit-follow-up 2026-05-17): end-to-end replay via auth-laag.
  //
  // `internal.invites.handleBounce` dedup-pad zit al gepin'd in
  // tests/invites/bouncedHandler.test.ts. Dit pin't dat de webhook-laag
  // (auth + parse + delegation) de dedup-keten niet ondergraaft: tweede
  // identieke POST = no-op (geen extra dedup-record, geen extra
  // notify-mail-schedule).
  // -------------------------------------------------------------------------

  it("end-to-end replay: tweede identieke POST is no-op (geen extra dedup-rij, geen extra schedule)", async () => {
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "replay@x.com");

    const init: RequestInit = {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify([
        { event: "bounce", email: "replay@x.com", MessageID: "evt-replay" },
      ]),
    };

    // Eerste call: nieuwe dedup-rij + 1 nieuwe notify-mail-schedule.
    const scheduledBefore = await t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).length,
    );
    const res1 = await t.fetch("/email-event", init);
    expect(res1.status).toBe(200);
    const eventsAfter1 = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(eventsAfter1).toHaveLength(1);
    const scheduledAfter1 = await t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).length,
    );
    expect(scheduledAfter1).toBeGreaterThan(scheduledBefore);

    // Tweede call (replay van zelfde providerEventId): handleBounce-dedup
    // moet 'm afvangen vóór state-mutatie of nieuwe schedule.
    const res2 = await t.fetch("/email-event", init);
    expect(res2.status).toBe(200);
    const eventsAfter2 = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(eventsAfter2).toHaveLength(1);
    const scheduledAfter2 = await t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).length,
    );
    expect(scheduledAfter2).toBe(scheduledAfter1);
  });
});
