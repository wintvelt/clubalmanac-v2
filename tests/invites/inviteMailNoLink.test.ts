import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatNlDate } from "../../convex/lib/emailTemplates";
import { newT, type T } from "../groups/_beheer";
import { inviteRow, seedInvite, world } from "./_wp19b";

// WP19b besluit 1, invariant 2, A-invariant 4 en 13: de uitnodigingsmail
// bevat geen link en geen token. Wel: wie uitnodigt, de groep, het adres
// waarmee je inlogt, tot wanneer, dat je de app installeert en met dat adres
// inlogt, de aanhef met de naam en het bericht. Hij gaat ook weg zonder
// `CLUBALMANAC_APP_URL`. Naam en bericht staan HTML-veilig in het HTML-deel.

const SENDER = "invites@clubalmanac.com";

type Msg = { To?: Array<{ Email?: string }>; Subject?: string; HTMLPart?: string; TextPart?: string };

beforeEach(() => {
  process.env.MAILJET_VERIFIED_SENDERS = SENDER;
  process.env.MAILJET_API_KEY = "k";
  process.env.MAILJET_API_SECRET = "s";
  delete process.env.CLUBALMANAC_APP_URL;
});
afterEach(() => {
  delete process.env.MAILJET_VERIFIED_SENDERS;
  delete process.env.MAILJET_API_KEY;
  delete process.env.MAILJET_API_SECRET;
  vi.unstubAllGlobals();
});

function stubMailjet() {
  const spy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ Messages: [{ Status: "success" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function sent(spy: ReturnType<typeof vi.fn>): Msg {
  expect(spy).toHaveBeenCalledTimes(1);
  const init = spy.mock.calls[0]![1] as RequestInit;
  return (JSON.parse(String(init.body)) as { Messages: Msg[] }).Messages[0]!;
}

async function mailFor(t: T, inviteId: Id<"invites">): Promise<Msg> {
  const spy = stubMailjet();
  await t.action(internal.invites.sendInviteEmail, { kind: "invite", inviteId });
  return sent(spy);
}

async function setup(t: T, extra: { name?: string; message?: string } = {}) {
  const w = await world(t);
  await t.run(async (ctx) => ctx.db.patch(w.users.olga!, { name: "Olga Oprichter" }));
  await t.run(async (ctx) => ctx.db.patch(w.groupId, { name: "De Fotoclub" }));
  const inviteId = await seedInvite(t, {
    email: "nina@x.test",
    invitedBy: w.users.olga!,
    groupId: w.groupId,
    name: "Nina",
    ...extra,
  });
  return { w, inviteId };
}

describe("A-invariant 4 — geen link, geen token", () => {
  it("geen link in de tekst of HTML, en het token staat er niet in", async () => {
    const t = newT();
    const { inviteId } = await setup(t, { message: "Kom erbij" });
    const msg = await mailFor(t, inviteId);
    const token = (await inviteRow(t, inviteId))!.token;
    for (const part of [msg.Subject ?? "", msg.HTMLPart ?? "", msg.TextPart ?? ""]) {
      expect(part).not.toContain(token);
      expect(part).not.toMatch(/https?:\/\//i);
      expect(part).not.toMatch(/clubalmanac:\/\//i);
      expect(part).not.toMatch(/<a\b/i);
      expect(part).not.toMatch(/href=/i);
      expect(part).not.toMatch(/uitnodigingspagina|plak deze code/i);
    }
  });

  it("gaat weg zonder CLUBALMANAC_APP_URL", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    const msg = await mailFor(t, inviteId);
    expect(msg.To?.[0]?.Email).toBe("nina@x.test");
  });
});

describe("A-invariant 4 en 13 — wat er wel in staat", () => {
  it("afzender, groep, het inlog-adres, geldig tot, de instructie, de aanhef en het bericht", async () => {
    const t = newT();
    const { inviteId } = await setup(t, { message: "Kom erbij" });
    const msg = await mailFor(t, inviteId);
    const until = formatNlDate((await inviteRow(t, inviteId))!.expiresAt);
    for (const part of [msg.HTMLPart ?? "", msg.TextPart ?? ""]) {
      expect(part).toContain("Olga Oprichter");
      expect(part).toContain("De Fotoclub");
      expect(part).toContain("nina@x.test");
      expect(part).toContain(until);
      expect(part).toMatch(/installeer/i);
      expect(part).toMatch(/log\w* in|inloggen/i);
      expect(part).toMatch(/Hi Nina/);
      expect(part).toContain("Kom erbij");
      expect(part).not.toMatch(/undefined|null/);
    }
  });

  it("zonder bericht: geen lege aanhalingstekens, geen 'undefined'", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    const msg = await mailFor(t, inviteId);
    for (const part of [msg.HTMLPart ?? "", msg.TextPart ?? ""]) {
      expect(part).not.toMatch(/undefined|null/);
      expect(part).not.toContain('""');
    }
  });

  it("naam en bericht HTML-veilig in het HTML-deel", async () => {
    const t = newT();
    const { inviteId } = await setup(t, { name: "Ni<b>na", message: "<script>x</script>" });
    const msg = await mailFor(t, inviteId);
    expect(msg.HTMLPart).not.toContain("<script>");
    expect(msg.HTMLPart).toContain("&lt;script&gt;");
    expect(msg.HTMLPart).not.toContain("Ni<b>na");
    expect(msg.HTMLPart).toContain("Ni&lt;b&gt;na");
  });

  it("een gemigreerde uitnodiging zonder naam: aanhef zonder naam, geen 'undefined'", async () => {
    const t = newT();
    const w = await world(t);
    const inviteId = await seedInvite(t, { email: "nina@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    const msg = await mailFor(t, inviteId);
    for (const part of [msg.HTMLPart ?? "", msg.TextPart ?? ""]) {
      expect(part).toMatch(/Hi\b/);
      expect(part).not.toMatch(/undefined|null/);
    }
  });
});
