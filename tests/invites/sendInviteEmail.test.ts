// WP5 RED-phase: invites.sendInviteEmail per-kind wiring.
//
// Pin't dat de action voor elke kind:
//   - recipient correct ophaalt (invitee voor "invite", inviter voor
//     accepted/declined/bounced) via FK-walk
//   - from-address `invites@clubalmanac.com` (spec-aanvulling)
//   - subject + body NL-tekst rendert die 1:1 spiegelt aan oude AWS-templates
//   - PII-guard: invite-token alleen in `invite`-kind, NIET in
//     accepted/declined/bounced (die gaan naar inviter, niet ontvanger)
//   - no-"undefined"-leak in subject of body (placeholder-fill)
//   - skip-gracefully wanneer inviter/owner inmiddels verwijderd is
//
// Verified-sender gate + Mailjet API-shape worden apart gepin'd in
// tests/email/mailjetClient.test.ts; deze suite mockt Mailjet 2xx en
// inspecteert de uitgaande payload.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerUserWithInvite, withUser } from "../_helpers/auth";

const INVITES_SENDER = "invites@clubalmanac.com";

beforeEach(() => {
  process.env.MAILJET_VERIFIED_SENDERS = INVITES_SENDER;
  process.env.MAILJET_API_KEY = "k";
  process.env.MAILJET_API_SECRET = "s";
  // Audit-follow-up 2026-05-17: buildInviteUrl is nu fail-loud bij missing
  // CLUBALMANAC_APP_URL — kind="invite"-pad in de action gebruikt 'm.
  process.env.CLUBALMANAC_APP_URL = "https://app.example.com";
});

afterEach(() => {
  delete process.env.MAILJET_VERIFIED_SENDERS;
  delete process.env.MAILJET_API_KEY;
  delete process.env.MAILJET_API_SECRET;
  delete process.env.CLUBALMANAC_APP_URL;
  vi.unstubAllGlobals();
});

type MailjetMessage = {
  From?: { Email?: string; Name?: string };
  To?: Array<{ Email?: string; Name?: string }>;
  Subject?: string;
  HTMLPart?: string;
  TextPart?: string;
};

function mockMailjet2xx(): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ Messages: [{ Status: "success" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function lastMessage(fetchSpy: ReturnType<typeof vi.fn>): MailjetMessage {
  expect(fetchSpy).toHaveBeenCalled();
  const calls = fetchSpy.mock.calls;
  const init = calls[calls.length - 1]![1] as RequestInit;
  const bodyStr = typeof init.body === "string" ? init.body : "";
  const payload = JSON.parse(bodyStr) as { Messages?: MailjetMessage[] };
  expect(Array.isArray(payload.Messages)).toBe(true);
  return payload.Messages![0]!;
}

async function seedInviteFlow(
  t: ReturnType<typeof convexTest>,
): Promise<{
  inviteId: Id<"invites">;
  token: string;
  inviterId: Id<"users">;
  groupId: Id<"groups"> | undefined;
}> {
  const inviterId = await registerUserWithInvite(
    t,
    "user_alice",
    "alice@x.com",
    "Alice Adams",
  );
  const groupId = await withUser(t, "user_alice").mutation(
    api.groups.create,
    { name: "De Fotoclub" },
  );
  const { inviteId, token } = await withUser(t, "user_alice").mutation(
    api.invites.create,
    { email: "Bob@x.com", groupId, role: "member" },
  );
  return { inviteId, token, inviterId, groupId };
}

// ---------------------------------------------------------------------------
// kind = "invite": naar de geïnviteerde
// ---------------------------------------------------------------------------

describe("sendInviteEmail kind=invite — recipient = invitee, from = invites@", () => {
  it("verstuurt naar invite.email (normalizeEmail-vorm), from = invites-sender", async () => {
    const t = convexTest(schema);
    const { inviteId } = await seedInviteFlow(t);
    const fetchSpy = mockMailjet2xx();

    await t.action(internal.invites.sendInviteEmail, {
      kind: "invite",
      inviteId,
    });

    const msg = lastMessage(fetchSpy);
    expect(msg.To?.[0]?.Email?.toLowerCase()).toBe("bob@x.com");
    expect(msg.From?.Email?.toLowerCase()).toBe(INVITES_SENDER);
  });

  it("subject + body bevatten inviter-name én group-name; geen 'undefined'-leak", async () => {
    const t = convexTest(schema);
    const { inviteId } = await seedInviteFlow(t);
    const fetchSpy = mockMailjet2xx();

    await t.action(internal.invites.sendInviteEmail, {
      kind: "invite",
      inviteId,
    });

    const msg = lastMessage(fetchSpy);
    expect(msg.Subject).toContain("Alice Adams");
    expect(msg.Subject).toContain("De Fotoclub");
    expect(msg.Subject).not.toMatch(/undefined/i);
    expect(msg.HTMLPart).toContain("Alice Adams");
    expect(msg.HTMLPart).toContain("De Fotoclub");
    expect(msg.TextPart).toContain("Alice Adams");
    expect(msg.TextPart).toContain("De Fotoclub");
    expect(msg.HTMLPart).not.toMatch(/undefined/i);
    expect(msg.TextPart).not.toMatch(/undefined/i);
  });

  it("body bevat de invite-token (zodat ontvanger op de invite-landingpagina kan)", async () => {
    // Token IS de payload van deze specifieke mail; we pinnen presence in
    // body zodat een refactor 'm niet per ongeluk weglaat.
    const t = convexTest(schema);
    const { inviteId, token } = await seedInviteFlow(t);
    const fetchSpy = mockMailjet2xx();

    await t.action(internal.invites.sendInviteEmail, {
      kind: "invite",
      inviteId,
    });

    const msg = lastMessage(fetchSpy);
    const inBody =
      (msg.HTMLPart ?? "").includes(token) ||
      (msg.TextPart ?? "").includes(token);
    expect(inBody).toBe(true);
  });

  it("invite zonder groupId (account-wide invite) → subject/body refereert 'clubalmanac' i.p.v. group-name, geen 'undefined'", async () => {
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "alice@x.com", "Alice");
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "carla@x.com" },
    );
    const fetchSpy = mockMailjet2xx();

    await t.action(internal.invites.sendInviteEmail, {
      kind: "invite",
      inviteId,
    });

    const msg = lastMessage(fetchSpy);
    expect(msg.Subject).not.toMatch(/undefined/i);
    expect(msg.HTMLPart).not.toMatch(/undefined/i);
    expect(msg.TextPart).not.toMatch(/undefined/i);
    // 'clubalmanac' moet ergens vallen — fallback voor group-name in copy.
    expect(`${msg.Subject ?? ""}${msg.HTMLPart ?? ""}`.toLowerCase()).toContain(
      "clubalmanac",
    );
  });
});

// ---------------------------------------------------------------------------
// kind = "accepted": naar inviter
// ---------------------------------------------------------------------------

describe("sendInviteEmail kind=accepted — recipient = inviter, PII-guard", () => {
  it("verstuurt naar inviter (alice@x.com), niet naar accepter (bob@x.com)", async () => {
    const t = convexTest(schema);
    const { inviteId, token } = await seedInviteFlow(t);
    // Bob accepteert — invite-state wordt accepted; sendInviteEmail wordt
    // door accept gequeue'd, maar we roepen 'm hier expliciet aan om de
    // recipient-resolutie te pinnen.
    await registerUserWithInvite(t, "user_bob", "bob@x.com", "Bob B");
    await withUser(t, "user_bob").mutation(api.invites.accept, { token });

    const fetchSpy = mockMailjet2xx();
    await t.action(internal.invites.sendInviteEmail, {
      kind: "accepted",
      inviteId,
    });

    const msg = lastMessage(fetchSpy);
    expect(msg.To?.[0]?.Email?.toLowerCase()).toBe("alice@x.com");
    expect(msg.To?.[0]?.Email?.toLowerCase()).not.toBe("bob@x.com");
    expect(msg.From?.Email?.toLowerCase()).toBe(INVITES_SENDER);
  });

  it("subject + body bevatten group-name, geen 'undefined', GEEN invite-token (PII-guard)", async () => {
    const t = convexTest(schema);
    const { inviteId, token } = await seedInviteFlow(t);
    await registerUserWithInvite(t, "user_bob", "bob@x.com", "Bob B");
    await withUser(t, "user_bob").mutation(api.invites.accept, { token });

    const fetchSpy = mockMailjet2xx();
    await t.action(internal.invites.sendInviteEmail, {
      kind: "accepted",
      inviteId,
    });

    const msg = lastMessage(fetchSpy);
    expect(msg.Subject).toContain("De Fotoclub");
    expect(msg.Subject).not.toMatch(/undefined/i);
    expect(msg.HTMLPart).not.toMatch(/undefined/i);
    // Accept-mail naar inviter mag invite-token NIET bevatten — token is
    // bedoeld voor ontvanger om naar landingpagina te gaan, inviter heeft
    // 'm niet nodig en lekken via mail-forward = info-leak.
    expect(msg.HTMLPart).not.toContain(token);
    expect(msg.TextPart).not.toContain(token);
  });
});

// ---------------------------------------------------------------------------
// kind = "declined": naar inviter
// ---------------------------------------------------------------------------

describe("sendInviteEmail kind=declined — recipient = inviter, PII-guard", () => {
  it("verstuurt naar inviter, subject bevat group-name + 'afgewezen'-strekking", async () => {
    const t = convexTest(schema);
    const { inviteId, token } = await seedInviteFlow(t);
    await registerUserWithInvite(t, "user_bob", "bob@x.com", "Bob B");
    await withUser(t, "user_bob").mutation(api.invites.decline, { token });

    const fetchSpy = mockMailjet2xx();
    await t.action(internal.invites.sendInviteEmail, {
      kind: "declined",
      inviteId,
    });

    const msg = lastMessage(fetchSpy);
    expect(msg.To?.[0]?.Email?.toLowerCase()).toBe("alice@x.com");
    // Tone-of-voice 1:1 met oude AWS: "afgewezen" of "Helaas" verwacht.
    const combined = `${msg.Subject ?? ""} ${msg.HTMLPart ?? ""} ${msg.TextPart ?? ""}`;
    expect(combined).toMatch(/afgewezen|Helaas/i);
    expect(msg.Subject).toContain("De Fotoclub");
  });

  it("PII-guard: invite-token NIET in mail naar inviter", async () => {
    const t = convexTest(schema);
    const { inviteId, token } = await seedInviteFlow(t);
    await registerUserWithInvite(t, "user_bob", "bob@x.com", "Bob B");
    await withUser(t, "user_bob").mutation(api.invites.decline, { token });

    const fetchSpy = mockMailjet2xx();
    await t.action(internal.invites.sendInviteEmail, {
      kind: "declined",
      inviteId,
    });

    const msg = lastMessage(fetchSpy);
    expect(msg.HTMLPart).not.toContain(token);
    expect(msg.TextPart).not.toContain(token);
  });
});

// ---------------------------------------------------------------------------
// kind = "bounced": naar inviter
// ---------------------------------------------------------------------------

describe("sendInviteEmail kind=bounced — recipient = inviter, new template", () => {
  it("verstuurt naar inviter, body bevat bounced-email + group-name", async () => {
    const t = convexTest(schema);
    const { inviteId } = await seedInviteFlow(t);

    const fetchSpy = mockMailjet2xx();
    await t.action(internal.invites.sendInviteEmail, {
      kind: "bounced",
      inviteId,
    });

    const msg = lastMessage(fetchSpy);
    expect(msg.To?.[0]?.Email?.toLowerCase()).toBe("alice@x.com");
    const combined = `${msg.Subject ?? ""} ${msg.HTMLPart ?? ""} ${msg.TextPart ?? ""}`;
    // Body refereert het gebouncde adres zodat inviter typo's kan corrigeren.
    expect(combined.toLowerCase()).toContain("bob@x.com");
    expect(msg.HTMLPart).toContain("De Fotoclub");
  });

  it("subject + body geen 'undefined'-leak, geen invite-token", async () => {
    const t = convexTest(schema);
    const { inviteId, token } = await seedInviteFlow(t);
    const fetchSpy = mockMailjet2xx();

    await t.action(internal.invites.sendInviteEmail, {
      kind: "bounced",
      inviteId,
    });

    const msg = lastMessage(fetchSpy);
    expect(msg.Subject).not.toMatch(/undefined/i);
    expect(msg.HTMLPart).not.toMatch(/undefined/i);
    expect(msg.TextPart).not.toMatch(/undefined/i);
    expect(msg.HTMLPart).not.toContain(token);
    expect(msg.TextPart).not.toContain(token);
  });
});

// ---------------------------------------------------------------------------
// Robustness: graceful skip
// ---------------------------------------------------------------------------

describe("sendInviteEmail — graceful skip wanneer FK-walk-target weg is", () => {
  it("invite is inmiddels verwijderd → no-op, geen Mailjet-call, geen throw", async () => {
    // Race-scenario: scheduled-action draait nadat sender de invite heeft
    // verwijderd. Action mag dat niet hard-failen (scheduler retry-loop).
    const t = convexTest(schema);
    const { inviteId } = await seedInviteFlow(t);
    await t.run((ctx) => ctx.db.delete(inviteId));

    const fetchSpy = mockMailjet2xx();
    await expect(
      t.action(internal.invites.sendInviteEmail, {
        kind: "accepted",
        inviteId,
      }),
    ).resolves.not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("inviter is inmiddels verwijderd (user.deleteSelf) → no-op voor notify-kinds", async () => {
    const t = convexTest(schema);
    const { inviteId, inviterId } = await seedInviteFlow(t);
    await t.run((ctx) => ctx.db.delete(inviterId));

    const fetchSpy = mockMailjet2xx();
    await expect(
      t.action(internal.invites.sendInviteEmail, {
        kind: "bounced",
        inviteId,
      }),
    ).resolves.not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
