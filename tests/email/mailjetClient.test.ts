// WP5 RED-phase: Mailjet client-contract gate.
//
// Pinnen via de action-laag (`internal.invites.sendInviteEmail`) zodat we
// niet impl-binden aan een specifieke client-module-structuur. Twee
// invarianten:
//
// 1. Verified-sender hard gate (Mailjet known-issue 2 — silent failure bij
//    200 OK op niet-verified from). Lijst leeft in env-var
//    `MAILJET_VERIFIED_SENDERS`, comma-separated, case-insensitive,
//    trim-per-item. Lege/ontbrekende env-var = fail-closed (alle sends
//    throwen).
//
// 2. Mailjet send-call shape: POST naar api.mailjet.com, body bevat To/From/
//    Subject/HTML+Text. Basic-auth via `MAILJET_API_KEY`/`MAILJET_API_SECRET`.
//    Non-2xx response van Mailjet → throw. 2xx OK respons + gate-pass = succes.
//
// Per spec-aanvulling: élke send-kind gebruikt een vaste from-address per
// policy. Tests hier richten zich op `kind:"invite"` als representatief
// voorbeeld; per-kind from-mapping wordt apart gepin'd in
// `tests/invites/sendInviteEmail.test.ts`.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerUserWithInvite, withUser } from "../_helpers/auth";

// Vaste verified-sender voor de happy-path tests. Spec-aanvulling pin't
// invite/accepted/declined/bounced → `invites@clubalmanac.com`.
const INVITES_SENDER = "invites@clubalmanac.com";

function setEnv(opts: {
  verifiedSenders?: string;
  apiKey?: string;
  apiSecret?: string;
}): void {
  if (opts.verifiedSenders === undefined) delete process.env.MAILJET_VERIFIED_SENDERS;
  else process.env.MAILJET_VERIFIED_SENDERS = opts.verifiedSenders;
  if (opts.apiKey === undefined) delete process.env.MAILJET_API_KEY;
  else process.env.MAILJET_API_KEY = opts.apiKey;
  if (opts.apiSecret === undefined) delete process.env.MAILJET_API_SECRET;
  else process.env.MAILJET_API_SECRET = opts.apiSecret;
}

afterEach(() => {
  delete process.env.MAILJET_VERIFIED_SENDERS;
  delete process.env.MAILJET_API_KEY;
  delete process.env.MAILJET_API_SECRET;
  vi.unstubAllGlobals();
});

async function seedInvite(
  t: ReturnType<typeof convexTest>,
): Promise<{ inviteId: string }> {
  await registerUserWithInvite(t, "user_alice", "alice@x.com", "Alice");
  const { inviteId } = await withUser(t, "user_alice").mutation(
    api.invites.create,
    { email: "bob@x.com" },
  );
  return { inviteId };
}

function mockMailjet2xx(): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        Messages: [
          { Status: "success", To: [{ Email: "bob@x.com", MessageID: 1 }] },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

describe("mailjet client — verified-sender hard gate (fail-closed)", () => {
  beforeEach(() => {
    setEnv({ apiKey: "k", apiSecret: "s" });
  });

  it("env-var MAILJET_VERIFIED_SENDERS ontbreekt → action throwt, geen Mailjet-call", async () => {
    delete process.env.MAILJET_VERIFIED_SENDERS;
    const t = convexTest(schema);
    const { inviteId } = await seedInvite(t);
    const fetchSpy = mockMailjet2xx();

    await expect(
      t.action(internal.invites.sendInviteEmail, {
        kind: "invite",
        inviteId: inviteId as never,
      }),
    ).rejects.toThrow(/UNVERIFIED_SENDER/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("env-var leeg (lege string) → action throwt, geen Mailjet-call", async () => {
    process.env.MAILJET_VERIFIED_SENDERS = "";
    const t = convexTest(schema);
    const { inviteId } = await seedInvite(t);
    const fetchSpy = mockMailjet2xx();

    await expect(
      t.action(internal.invites.sendInviteEmail, {
        kind: "invite",
        inviteId: inviteId as never,
      }),
    ).rejects.toThrow(/UNVERIFIED_SENDER/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("from-address niet in verified-set → throwt UNVERIFIED_SENDER, geen Mailjet-call", async () => {
    // invites@-sender wordt door de action gebruikt voor kind=invite, maar
    // staat NIET in deze verified-set → moet falen.
    process.env.MAILJET_VERIFIED_SENDERS = "info@clubalmanac.com,dpo@clubalmanac.com";
    const t = convexTest(schema);
    const { inviteId } = await seedInvite(t);
    const fetchSpy = mockMailjet2xx();

    await expect(
      t.action(internal.invites.sendInviteEmail, {
        kind: "invite",
        inviteId: inviteId as never,
      }),
    ).rejects.toThrow(/UNVERIFIED_SENDER/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("verified-set parsed met whitespace en mixed-case → match (trim + lowercase per item)", async () => {
    // Pin't dat env-var-parsing defensief is: leading/trailing whitespace +
    // mixed-case items resolveren naar dezelfde verified-set als netjes
    // geformatteerd. Spiegelt audit-7 webmaster-match-discipline.
    process.env.MAILJET_VERIFIED_SENDERS = "  Invites@ClubAlmanac.com , INFO@clubalmanac.com  ";
    const t = convexTest(schema);
    const { inviteId } = await seedInvite(t);
    const fetchSpy = mockMailjet2xx();

    await t.action(internal.invites.sendInviteEmail, {
      kind: "invite",
      inviteId: inviteId as never,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("mailjet client — send-call shape (Mailjet Send v3.1 contract)", () => {
  beforeEach(() => {
    setEnv({
      verifiedSenders: INVITES_SENDER,
      apiKey: "test-key",
      apiSecret: "test-secret",
    });
  });

  it("verified sender → exactly 1 POST naar api.mailjet.com met basic-auth", async () => {
    const t = convexTest(schema);
    const { inviteId } = await seedInvite(t);
    const fetchSpy = mockMailjet2xx();

    await t.action(internal.invites.sendInviteEmail, {
      kind: "invite",
      inviteId: inviteId as never,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/api\.mailjet\.com/);
    expect((init.method ?? "GET").toUpperCase()).toBe("POST");

    const headers = new Headers(init.headers);
    const auth = headers.get("Authorization") ?? "";
    expect(auth.startsWith("Basic ")).toBe(true);
    // base64("test-key:test-secret")
    const expectedB64 = btoa("test-key:test-secret");
    expect(auth).toBe(`Basic ${expectedB64}`);
    expect(headers.get("Content-Type")?.toLowerCase()).toContain(
      "application/json",
    );
  });

  it("payload bevat From/To/Subject/HTML+Text en is JSON-parsebaar", async () => {
    const t = convexTest(schema);
    const { inviteId } = await seedInvite(t);
    const fetchSpy = mockMailjet2xx();

    await t.action(internal.invites.sendInviteEmail, {
      kind: "invite",
      inviteId: inviteId as never,
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const bodyStr = typeof init.body === "string" ? init.body : "";
    expect(bodyStr.length).toBeGreaterThan(0);
    const payload = JSON.parse(bodyStr) as {
      Messages?: Array<{
        From?: { Email?: string };
        To?: Array<{ Email?: string }>;
        Subject?: string;
        HTMLPart?: string;
        TextPart?: string;
      }>;
    };
    expect(Array.isArray(payload.Messages)).toBe(true);
    expect(payload.Messages?.length).toBe(1);
    const m = payload.Messages![0]!;
    expect(m.From?.Email?.toLowerCase()).toBe(INVITES_SENDER);
    expect(m.To?.[0]?.Email?.toLowerCase()).toBe("bob@x.com");
    expect(typeof m.Subject).toBe("string");
    expect(m.Subject!.length).toBeGreaterThan(0);
    // Beide body-vormen aanwezig (HTML primary, plain-text fallback).
    expect(typeof m.HTMLPart).toBe("string");
    expect(typeof m.TextPart).toBe("string");
  });

  it("Mailjet non-2xx response → action throwt (geen silent succes)", async () => {
    const t = convexTest(schema);
    const { inviteId } = await seedInvite(t);
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ErrorMessage: "Bad request" }),
        { status: 400 },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      t.action(internal.invites.sendInviteEmail, {
        kind: "invite",
        inviteId: inviteId as never,
      }),
    ).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("Mailjet 5xx response → action throwt (laat scheduler retry'en)", async () => {
    const t = convexTest(schema);
    const { inviteId } = await seedInvite(t);
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response("", { status: 502 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      t.action(internal.invites.sendInviteEmail, {
        kind: "invite",
        inviteId: inviteId as never,
      }),
    ).rejects.toThrow();
  });
});
