// WP5 RED-phase: /email-event webhook Bearer-auth.
//
// Spec-aanvulling: webhook is niet-spoofbaar via shared-secret in
// `Authorization: Bearer <MAILJET_WEBHOOK_SECRET>` header. Mailjet biedt
// geen out-of-the-box HMAC-signing op Event API; shared-secret is de
// gangbare oplossing voor deze provider.
//
// Fail-modes:
//   - MAILJET_WEBHOOK_SECRET ontbreekt op deployment → alle requests → 503
//     (fail-closed; geen accidenteel open endpoint in prod).
//   - Header missing → 401, geen handleBounce-call, geen state-mutatie.
//   - Header mismatch → 401, idem.
//   - Header geldig + bounce-payload → 200, handleBounce gecalled.
//
// convex-test fetch-pad: t.fetch(path, init) routeert via convex/http.ts;
// custom headers worden 1:1 doorgegeven (zie tests/http/upload.test.ts voor
// X-Upload-Id precedent).

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerUserWithInvite, withUser } from "../_helpers/auth";

const SECRET = "test-webhook-secret-abc123";

afterEach(() => {
  delete process.env.MAILJET_WEBHOOK_SECRET;
});

function bouncePayload(opts: {
  email?: string;
  providerEventId?: string;
}): string {
  return JSON.stringify([
    {
      event: "bounce",
      email: opts.email ?? "bouncer@x.com",
      MessageID: opts.providerEventId ?? "evt-1",
    },
  ]);
}

async function seedPendingInviteForBounce(
  t: ReturnType<typeof convexTest>,
  inviteEmail: string,
): Promise<void> {
  await registerUserWithInvite(t, "user_alice", "alice@x.com", "Alice");
  await withUser(t, "user_alice").mutation(api.invites.create, {
    email: inviteEmail,
  });
}

describe("/email-event — env-var fail-closed", () => {
  it("MAILJET_WEBHOOK_SECRET ontbreekt op deployment → 503, geen state-mutatie", async () => {
    delete process.env.MAILJET_WEBHOOK_SECRET;
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "bouncer@x.com");

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer whatever-secret`,
      },
      body: bouncePayload({ email: "bouncer@x.com" }),
    });

    expect(res.status).toBe(503);
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events).toHaveLength(0);
    const invites = await t.run((ctx) =>
      ctx.db
        .query("invites")
        .filter((q) => q.eq(q.field("email"), "bouncer@x.com"))
        .collect(),
    );
    for (const i of invites) {
      expect(i.status).toBe("pending");
      expect(i.bouncedAt).toBeUndefined();
    }
  });
});

describe("/email-event — Authorization header validation", () => {
  it("zonder Authorization header → 401, geen mutation-call, geen state-mutatie", async () => {
    process.env.MAILJET_WEBHOOK_SECRET = SECRET;
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "bouncer@x.com");

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bouncePayload({ email: "bouncer@x.com" }),
    });

    expect(res.status).toBe(401);
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events).toHaveLength(0);
  });

  it("Authorization met verkeerd secret → 401, geen state-mutatie", async () => {
    process.env.MAILJET_WEBHOOK_SECRET = SECRET;
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "bouncer@x.com");

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer wrong-secret`,
      },
      body: bouncePayload({ email: "bouncer@x.com" }),
    });

    expect(res.status).toBe(401);
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events).toHaveLength(0);
  });

  it("Authorization zonder Bearer-prefix (alleen het secret) → 401", async () => {
    // Spec pin't `Bearer <secret>` schema exact — kale secret = malformed.
    process.env.MAILJET_WEBHOOK_SECRET = SECRET;
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "bouncer@x.com");

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: SECRET,
      },
      body: bouncePayload({ email: "bouncer@x.com" }),
    });

    expect(res.status).toBe(401);
  });

  it("Authorization 'Bearer ' + correct secret → 200, delegeert naar handleBounce", async () => {
    process.env.MAILJET_WEBHOOK_SECRET = SECRET;
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "bouncer@x.com");

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SECRET}`,
      },
      body: bouncePayload({
        email: "bouncer@x.com",
        providerEventId: "evt-authed",
      }),
    });

    expect(res.status).toBe(200);
    // handleBounce daadwerkelijk aangeroepen → dedup-record + invite-patch
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.providerEventId).toBe("evt-authed");
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
});

// ---------------------------------------------------------------------------
// S-1 (audit-follow-up 2026-05-17): strict-equality varianten op
// `convex/http.ts:51` (`auth !== "Bearer " + secret`). Regression-guards
// die alarm slaan als iemand later een loosened compare (startsWith,
// trim, lowercase) introduceert. Allen verwacht GROEN tegen huidige code.
// ---------------------------------------------------------------------------

describe("/email-event — strict-equality regression-guards (S-1)", () => {
  it("lowercase prefix 'bearer <secret>' → 401, geen handleBounce-call", async () => {
    process.env.MAILJET_WEBHOOK_SECRET = SECRET;
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "bouncer@x.com");

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `bearer ${SECRET}`,
      },
      body: bouncePayload({ email: "bouncer@x.com" }),
    });

    expect(res.status).toBe(401);
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events).toHaveLength(0);
  });

  it("dubbele spatie 'Bearer  <secret>' → 401, geen handleBounce-call", async () => {
    process.env.MAILJET_WEBHOOK_SECRET = SECRET;
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "bouncer@x.com");

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer  ${SECRET}`,
      },
      body: bouncePayload({ email: "bouncer@x.com" }),
    });

    expect(res.status).toBe(401);
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events).toHaveLength(0);
  });

  it("geen spatie 'Bearer<secret>' → 401, geen handleBounce-call", async () => {
    process.env.MAILJET_WEBHOOK_SECRET = SECRET;
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "bouncer@x.com");

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer${SECRET}`,
      },
      body: bouncePayload({ email: "bouncer@x.com" }),
    });

    expect(res.status).toBe(401);
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events).toHaveLength(0);
  });

  // [SPEC-DEVIATIE 2026-05-18] Audit-spec S-1 case #4 was "leading whitespace
  // ' Bearer <secret>' → 401". Probleem: de HTTP-Headers-laag in edge-runtime
  // strip't leading OWS uit header-values per RFC 7230 §3.2.4 vóórdat de
  // httpAction-handler de waarde ziet. De server ziet dan `Bearer <SECRET>`
  // (schoon) en strict-eq matcht — 200. Dat is normalisatie-gedrag boven
  // `convex/http.ts:51`, niet een gat in B's impl. Pin't dus niet meaningful.
  //
  // Vervangen door trailing-junk variant: dezelfde regression-guard-intent
  // (alarm bij refactor naar `auth.startsWith("Bearer " + secret)`) maar met
  // een input die wél meaningful door de strict-eq-check rolt.
  it("trailing junk na secret 'Bearer <secret>x' → 401 (pin't strict-eq vs startsWith)", async () => {
    process.env.MAILJET_WEBHOOK_SECRET = SECRET;
    const t = convexTest(schema);
    await seedPendingInviteForBounce(t, "bouncer@x.com");

    const res = await t.fetch("/email-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SECRET}x`,
      },
      body: bouncePayload({ email: "bouncer@x.com" }),
    });

    expect(res.status).toBe(401);
    const events = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(events).toHaveLength(0);
  });
});
