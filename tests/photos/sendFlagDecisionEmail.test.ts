// WP5 RED-phase: photos.sendFlagDecisionEmail per-kind wiring.
//
// Achtergrond: cascade-matrix FL2 pin't dat `decideFlag(deny)` de action
// `internal.photos.sendFlagDecisionEmail` queue't (al groen in
// decideFlag.test.ts). Hier pinnen we de action zelf: dat 'ie de Mailjet-
// send doet met juiste recipient, from, subject + body.
//
// Spec-aanvulling: kind=flagDecisionDeny → from `info@clubalmanac.com`.
// approve-pad: in v2 stuurt approve géén mail (afwijking van oude AWS,
// bewust per cascade-matrix). Pinning: action met approve=true doet GEEN
// Mailjet-call.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerUserWithInvite, withUser } from "../_helpers/auth";

const INFO_SENDER = "info@clubalmanac.com";
const WEBMASTER_EMAIL = "webmaster@x.com";

beforeEach(() => {
  process.env.MAILJET_VERIFIED_SENDERS = INFO_SENDER;
  process.env.MAILJET_API_KEY = "k";
  process.env.MAILJET_API_SECRET = "s";
  process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
});

afterEach(() => {
  delete process.env.MAILJET_VERIFIED_SENDERS;
  delete process.env.MAILJET_API_KEY;
  delete process.env.MAILJET_API_SECRET;
  delete process.env.WEBMASTER_EMAILS;
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
  const calls = fetchSpy.mock.calls;
  const init = calls[calls.length - 1]![1] as RequestInit;
  const payload = JSON.parse(typeof init.body === "string" ? init.body : "") as {
    Messages?: MailjetMessage[];
  };
  return payload.Messages![0]!;
}

async function flaggedAppealedPhoto(
  t: ReturnType<typeof convexTest>,
): Promise<{ photoId: Id<"photos">; ownerEmail: string; ownerName: string }> {
  const ownerName = "Alice Owner";
  const ownerEmail = "owner@x.com";
  await registerUserWithInvite(t, "user_owner", ownerEmail, ownerName);
  await registerUserWithInvite(t, "user_flagger", "flagger@x.com", "Flag F");
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
  const photoId = await withUser(t, "user_owner").mutation(
    api.photos.create,
    { storageId },
  );
  await withUser(t, "user_flagger").mutation(api.photos.flag, { photoId });
  await withUser(t, "user_owner").mutation(api.photos.appeal, { photoId });
  return { photoId, ownerEmail, ownerName };
}

describe("sendFlagDecisionEmail — approve = no-op (cascade-matrix FL2)", () => {
  it("approve=true → geen Mailjet-call", async () => {
    const t = convexTest(schema);
    const { photoId } = await flaggedAppealedPhoto(t);
    const fetchSpy = mockMailjet2xx();

    await t.action(internal.photos.sendFlagDecisionEmail, {
      photoId,
      approve: true,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("sendFlagDecisionEmail — deny = mail naar photo-owner", () => {
  it("recipient = owner-email, from = info-sender", async () => {
    const t = convexTest(schema);
    const { photoId, ownerEmail } = await flaggedAppealedPhoto(t);
    const fetchSpy = mockMailjet2xx();

    await t.action(internal.photos.sendFlagDecisionEmail, {
      photoId,
      approve: false,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const msg = lastMessage(fetchSpy);
    expect(msg.To?.[0]?.Email?.toLowerCase()).toBe(ownerEmail.toLowerCase());
    expect(msg.From?.Email?.toLowerCase()).toBe(INFO_SENDER);
  });

  it("subject + body 1:1 NL tone-of-voice (afgewezen-strekking), bevat owner-name", async () => {
    const t = convexTest(schema);
    const { photoId, ownerName } = await flaggedAppealedPhoto(t);
    const fetchSpy = mockMailjet2xx();

    await t.action(internal.photos.sendFlagDecisionEmail, {
      photoId,
      approve: false,
    });

    const msg = lastMessage(fetchSpy);
    expect(msg.Subject).toMatch(/afgewezen/i);
    expect(msg.HTMLPart).toContain(ownerName);
    expect(msg.HTMLPart).not.toMatch(/undefined/i);
    expect(msg.TextPart).not.toMatch(/undefined/i);
    // Tone-of-voice 1:1 met oude SES denyBody (`flagPhotoDecide.js` r.47):
    // "HELAAS" + "binnenkort definitief verwijderd"-strekking.
    const combined = `${msg.HTMLPart ?? ""} ${msg.TextPart ?? ""}`;
    expect(combined.toLowerCase()).toContain("helaas");
    expect(combined).toMatch(/verwijderd/i);
  });
});

describe("sendFlagDecisionEmail — graceful skip", () => {
  it("photo bestaat niet meer (cascade gedraaid) → no-op, geen Mailjet-call, geen throw", async () => {
    const t = convexTest(schema);
    const { photoId } = await flaggedAppealedPhoto(t);
    await t.run((ctx) => ctx.db.delete(photoId));
    const fetchSpy = mockMailjet2xx();

    await expect(
      t.action(internal.photos.sendFlagDecisionEmail, {
        photoId,
        approve: false,
      }),
    ).resolves.not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("owner inmiddels verwijderd → no-op, geen throw", async () => {
    const t = convexTest(schema);
    const { photoId } = await flaggedAppealedPhoto(t);
    // Direct DB-delete van de owner-user om de race te simuleren (zonder
    // de hele users.deleteSelf cascade die de photo ook zou wissen).
    const photo = await t.run((ctx) => ctx.db.get(photoId));
    if (photo) await t.run((ctx) => ctx.db.delete(photo.ownerId));
    const fetchSpy = mockMailjet2xx();

    await expect(
      t.action(internal.photos.sendFlagDecisionEmail, {
        photoId,
        approve: false,
      }),
    ).resolves.not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("sendFlagDecisionEmail — verified-sender gate", () => {
  it("info-sender niet in MAILJET_VERIFIED_SENDERS → throwt UNVERIFIED_SENDER, geen call", async () => {
    process.env.MAILJET_VERIFIED_SENDERS = "invites@clubalmanac.com"; // niet info@
    const t = convexTest(schema);
    const { photoId } = await flaggedAppealedPhoto(t);
    const fetchSpy = mockMailjet2xx();

    await expect(
      t.action(internal.photos.sendFlagDecisionEmail, {
        photoId,
        approve: false,
      }),
    ).rejects.toThrow(/UNVERIFIED_SENDER/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
