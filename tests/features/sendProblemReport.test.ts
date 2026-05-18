// WP5 RED-phase: problem-report email-flow.
//
// Cascade-trigger zit in `features.create` met `type="problem"`. Twee
// pinning-niveaus:
//
// 1. WIRING — features.create({type:"problem"}) schedule't exact één
//    problem-report action; type="feature" schedule't géén.
//
// 2. ACTION — de scheduled action (B kiest naam, voorstel
//    `internal.features.sendProblemReport`) doet Mailjet send naar
//    webmaster (uit WEBMASTER_EMAILS), from = info@clubalmanac.com,
//    body bevat submitter-name + email + description (uit oude SES
//    `problemMail.js`-tone).
//
// Verified-sender gate + Mailjet-API-shape worden apart gepin'd in
// tests/email/mailjetClient.test.ts.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";
import { registerUserWithInvite, withUser } from "../_helpers/auth";

// Forward-declared action-reference voor B's nog-niet-bestaande
// `internal.features.sendProblemReport`. Bij codegen na B's impl wordt
// `internal.features.sendProblemReport` typed; tot dan houdt deze cast de
// TS-laag tevreden zonder de RED-aard van de tests te maskeren (runtime
// resolveert naar `undefined` en `t.action(undefined, ...)` throwt).
const sendProblemReportRef = (
  internal as unknown as {
    features: {
      sendProblemReport: FunctionReference<
        "action",
        "internal",
        { featureId: Id<"features"> }
      >;
    };
  }
).features.sendProblemReport;

const INFO_SENDER = "info@clubalmanac.com";
const WEBMASTER_EMAIL = "webmaster@x.com";

beforeEach(() => {
  process.env.MAILJET_VERIFIED_SENDERS = INFO_SENDER;
  process.env.MAILJET_API_KEY = "k";
  process.env.MAILJET_API_SECRET = "s";
  process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
  // Audit-follow-up 2026-05-17: getStageLabel() is nu fail-loud bij missing
  // CLUBALMANAC_STAGE — problem-report-template gebruikt 'm voor het subject.
  process.env.CLUBALMANAC_STAGE = "dev";
});

afterEach(() => {
  delete process.env.MAILJET_VERIFIED_SENDERS;
  delete process.env.MAILJET_API_KEY;
  delete process.env.MAILJET_API_SECRET;
  delete process.env.WEBMASTER_EMAILS;
  delete process.env.CLUBALMANAC_STAGE;
  vi.unstubAllGlobals();
});

type MailjetMessage = {
  From?: { Email?: string };
  To?: Array<{ Email?: string }>;
  Subject?: string;
  HTMLPart?: string;
  TextPart?: string;
};

function mockMailjet2xx(): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ Messages: [{ Status: "success" }] }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function lastMessage(fetchSpy: ReturnType<typeof vi.fn>): MailjetMessage {
  const init = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]![1] as RequestInit;
  const payload = JSON.parse(typeof init.body === "string" ? init.body : "") as {
    Messages?: MailjetMessage[];
  };
  return payload.Messages![0]!;
}

describe("features.create — schedules problem-report only for type=problem", () => {
  it("type='problem' schedule't precies 1 problem-report action", async () => {
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "alice@x.com", "Alice");

    const before = await t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).length,
    );
    await withUser(t, "user_alice").mutation(api.features.create, {
      type: "problem",
      title: "Upload faalt",
      description: "Foto-upload werkt niet op iPhone.",
    });
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled.length).toBe(before + 1);
    // Voorzichtig met impl-naam — match op string-fragment `problem` of
    // `sendProblemReport`, niet hard op exacte path.
    const added = scheduled[scheduled.length - 1]!;
    expect(String(added.name).toLowerCase()).toContain("problem");
  });

  it("type='feature' schedule't GEEN email (alleen problem-reports gaan naar webmaster)", async () => {
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "alice@x.com", "Alice");

    const before = await t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).length,
    );
    await withUser(t, "user_alice").mutation(api.features.create, {
      type: "feature",
      title: "Donker thema",
      description: "Graag dark-mode.",
    });
    const after = await t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).length,
    );
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Action surface: het exacte naam-pad kan B kiezen, maar de meest natuurlijke
// keus is `internal.features.sendProblemReport({featureId})`. Als B een andere
// shape kiest moet B deze test als RED-spec aanpassen en motiveren in B's
// commit-message.
// ---------------------------------------------------------------------------

describe("internal.features.sendProblemReport — Mailjet wiring", () => {
  it("verstuurt naar webmaster (uit WEBMASTER_EMAILS), from = info-sender", async () => {
    const t = convexTest(schema);
    const submitterId = await registerUserWithInvite(
      t,
      "user_alice",
      "alice@x.com",
      "Alice Adams",
    );
    const featureId = await withUser(t, "user_alice").mutation(
      api.features.create,
      {
        type: "problem",
        title: "Upload faalt",
        description: "Foto-upload werkt niet op iPhone.",
      },
    );
    expect(submitterId).toBeDefined();
    const fetchSpy = mockMailjet2xx();

    await t.action(sendProblemReportRef, { featureId });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const msg = lastMessage(fetchSpy);
    expect(msg.To?.[0]?.Email?.toLowerCase()).toBe(
      WEBMASTER_EMAIL.toLowerCase(),
    );
    expect(msg.From?.Email?.toLowerCase()).toBe(INFO_SENDER);
  });

  it("body bevat submitter-name, submitter-email en description (1:1 oude problemMail-tone)", async () => {
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "alice@x.com", "Alice Adams");
    const featureId = await withUser(t, "user_alice").mutation(
      api.features.create,
      {
        type: "problem",
        title: "Iets stuk",
        description: "Foto-upload werkt niet op iPhone.",
      },
    );
    const fetchSpy = mockMailjet2xx();

    await t.action(sendProblemReportRef, { featureId });

    const msg = lastMessage(fetchSpy);
    expect(msg.HTMLPart).toContain("Alice Adams");
    expect(msg.HTMLPart).toContain("alice@x.com");
    expect(msg.HTMLPart).toContain("Foto-upload werkt niet op iPhone.");
    expect(msg.HTMLPart).not.toMatch(/undefined/i);
    expect(msg.TextPart).not.toMatch(/undefined/i);
  });

  it("WEBMASTER_EMAILS met meerdere adressen → naar alle webmasters", async () => {
    // Twee webmasters geconfigureerd; problem-report fan-out (TO-list of
    // meerdere Messages) zodat geen webmaster wordt overgeslagen.
    process.env.WEBMASTER_EMAILS = "a@webmaster.test,b@webmaster.test";
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "alice@x.com", "Alice");
    const featureId = await withUser(t, "user_alice").mutation(
      api.features.create,
      { type: "problem", title: "t", description: "d" },
    );
    const fetchSpy = mockMailjet2xx();

    await t.action(sendProblemReportRef, { featureId });

    // Verzamel alle recipient-emails over alle Mailjet-calls (fan-out kan
    // 1 call met TO-list of N calls zijn; we accepteren beide).
    const allRecipients: string[] = [];
    for (const call of fetchSpy.mock.calls) {
      const init = call[1] as RequestInit;
      const payload = JSON.parse(
        typeof init.body === "string" ? init.body : "",
      ) as { Messages?: MailjetMessage[] };
      for (const m of payload.Messages ?? []) {
        for (const to of m.To ?? []) {
          if (to.Email) allRecipients.push(to.Email.toLowerCase());
        }
      }
    }
    expect(allRecipients).toContain("a@webmaster.test");
    expect(allRecipients).toContain("b@webmaster.test");
  });

  it("WEBMASTER_EMAILS leeg/ontbreekt → no-op, geen Mailjet-call, geen throw (action mag scheduler niet stuk maken)", async () => {
    delete process.env.WEBMASTER_EMAILS;
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "alice@x.com", "Alice");
    const featureId = await withUser(t, "user_alice").mutation(
      api.features.create,
      { type: "problem", title: "t", description: "d" },
    );
    const fetchSpy = mockMailjet2xx();

    await expect(
      t.action(sendProblemReportRef, { featureId }),
    ).resolves.not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("feature-record bestaat niet → no-op, geen throw", async () => {
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "alice@x.com", "Alice");
    const featureId = await withUser(t, "user_alice").mutation(
      api.features.create,
      { type: "problem", title: "t", description: "d" },
    );
    await t.run((ctx) => ctx.db.delete(featureId));
    const fetchSpy = mockMailjet2xx();

    await expect(
      t.action(sendProblemReportRef, { featureId }),
    ).resolves.not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
