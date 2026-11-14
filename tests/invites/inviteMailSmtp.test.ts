// @vitest-environment node
//
// WP19c besluit 5 en 6, A-invariant 13–17. Spec:
// docs/work-packages/WP19c-uitnodigingsmail-opmaak.md (§Besluit 5 en 6, A).
//
// Besluit 5: de groepsfoto staat één keer in de mail, ook in iPhone Mail. Een
// mail met foto gaat daarom via Mailjet's SMTP-ingang met een zelfgebouwde MIME:
// `multipart/alternative` met de tekst en een `multipart/related` (HTML + foto).
// Geen `multipart/mixed`. Een mail zonder foto blijft op de Send API.
// Besluit 6: Mailjet volgt de ontvanger niet. Per bericht: SMTP-headers
// `X-Mailjet-TrackOpen: 0` en `X-Mailjet-TrackClick: 0`; Send API
// `TrackOpens: "disabled"` en `TrackClicks: "disabled"`.
//
// nodemailer is nep (`_smtp.ts`), maar bouwt de MIME echt. Node, met de echte
// sharp voor de foto (zoals inviteMailPhoto.test.ts).

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { internal } from "../../convex/_generated/api";
import { isJpeg } from "../_helpers/jpeg";
import { newT, type T } from "../groups/_beheer";
import { inviteRow } from "./_wp19b";
import { smtp, walk, type Part } from "./_smtp";
import {
  APP_STORE_URL,
  APPLE_APP_ID,
  clearMailEnv,
  expectNoPhoto,
  mailEnv,
  mailFor,
  seedCoverPhoto,
  SENDER,
  setup,
  stubMailjet,
} from "./_wp19c";

vi.mock("nodemailer", async () => (await import("./_smtp")).nodemailerMock());

beforeEach(() => {
  mailEnv(APPLE_APP_ID);
  smtp.reset();
});
afterEach(() => clearMailEnv());

async function jpeg(width: number, height: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 3, 90);
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 80 }).toBuffer());
}

/** Nina's uitnodiging voor een groep met een cover die in de mail mag. */
async function withCover(t: T, extra: Parameters<typeof setup>[1] = {}) {
  const { w, inviteId } = await setup(t, extra);
  await seedCoverPhoto(t, w, { original: await jpeg(1200, 900), klein: await jpeg(400, 300), exifOrientation: 6 });
  return { w, inviteId };
}

const leaves = (root: Part) => walk(root).filter(({ part }) => !part.type.startsWith("multipart/"));
const header = (root: Part, name: string) => root.headers.get(name.toLowerCase());

// ---------------------------------------------------------------------------

describe("A-invariant 13 — een mail met foto gaat via SMTP, in-v3.mailjet.com:587 met STARTTLS", () => {
  it("één verzending, via SMTP, niet via de Send API", async () => {
    const t = newT();
    const { inviteId } = await withCover(t);
    const msg = await mailFor(t, inviteId);
    expect(msg.transport).toBe("smtp");
  });

  it("de transport: host, poort 587, STARTTLS verplicht, de API-key en -secret als login", async () => {
    const t = newT();
    const { inviteId } = await withCover(t);
    await mailFor(t, inviteId);
    expect(smtp.sent).toHaveLength(1);
    const o = smtp.sent[0]!.transport as {
      host?: string;
      port?: number;
      secure?: boolean;
      requireTLS?: boolean;
      auth?: { user?: string; pass?: string };
    };
    expect(o.host).toBe("in-v3.mailjet.com");
    expect(o.port).toBe(587);
    expect(o.secure ?? false).toBe(false);
    expect(o.requireTLS).toBe(true);
    expect(o.auth).toEqual({ user: "k", pass: "s" });
  });

  it("time-outs: verbinden, groet en socket elk gezet en hoogstens 30 s", async () => {
    const t = newT();
    const { inviteId } = await withCover(t);
    await mailFor(t, inviteId);
    const o = smtp.sent[0]!.transport as Record<string, unknown>;
    for (const k of ["connectionTimeout", "greetingTimeout", "socketTimeout"]) {
      expect(typeof o[k], k).toBe("number");
      expect(o[k] as number, k).toBeGreaterThan(0);
      expect(o[k] as number, k).toBeLessThanOrEqual(30_000);
    }
  });

  it("envelop en kop: van invites@, alleen aan de genodigde; geen Cc of Bcc", async () => {
    const t = newT();
    const { inviteId } = await withCover(t);
    const msg = await mailFor(t, inviteId);
    expect(msg.envelope?.from).toBe(SENDER);
    expect(msg.envelope?.to).toEqual(["nina@x.test"]);
    expect(header(msg.mime!, "from")).toContain(SENDER);
    expect(msg.To?.map((x) => x.Email)).toEqual(["nina@x.test"]);
    expect(header(msg.mime!, "cc")).toBeUndefined();
    expect(header(msg.mime!, "bcc")).toBeUndefined();
  });
});

describe("A-invariant 14 — de MIME: tekst naast (HTML + foto) in multipart/related; de foto één keer", () => {
  it("bovenaan multipart/alternative met precies: text/plain, multipart/related", async () => {
    const t = newT();
    const { inviteId } = await withCover(t);
    const root = (await mailFor(t, inviteId)).mime!;
    expect(root.type).toBe("multipart/alternative");
    expect(root.children.map((c) => c.type)).toEqual(["text/plain", "multipart/related"]);
    const related = root.children[1]!;
    expect(related.children.map((c) => c.type)).toEqual(["text/html", "image/jpeg"]);
  });

  it("nergens multipart/mixed, en precies één beeld in de hele mail, in de related naast de HTML", async () => {
    const t = newT();
    const { inviteId } = await withCover(t);
    const root = (await mailFor(t, inviteId)).mime!;
    const all = walk(root);
    expect(all.filter(({ part }) => part.type === "multipart/mixed")).toHaveLength(0);
    const images = all.filter(({ part }) => part.type.startsWith("image/"));
    expect(images).toHaveLength(1);
    expect(images[0]!.parent?.type).toBe("multipart/related");
    expect(images[0]!.parent?.children.some((c) => c.type === "text/html")).toBe(true);
    // Eén tekst en één HTML: geen tweede kopie van de inhoud.
    expect(leaves(root).map(({ part }) => part.type).sort()).toEqual(["image/jpeg", "text/html", "text/plain"]);
  });

  it("het beeld: inline, base64, een JPEG, met Content-ID <groepsfoto>; de HTML verwijst er één keer naar", async () => {
    const t = newT();
    const { inviteId } = await withCover(t);
    const msg = await mailFor(t, inviteId);
    const image = leaves(msg.mime!).find(({ part }) => part.type === "image/jpeg")!.part;
    expect(image.headers.get("content-id")).toBe("<groepsfoto>");
    expect((image.headers.get("content-disposition") ?? "inline").split(";")[0]!.trim().toLowerCase()).toBe("inline");
    expect((image.headers.get("content-transfer-encoding") ?? "").toLowerCase()).toBe("base64");
    expect(isJpeg(new Uint8Array(image.body))).toBe(true);
    expect((msg.HTMLPart ?? "").match(/cid:groepsfoto\b/g) ?? []).toHaveLength(1);
    expect(msg.TextPart ?? "").not.toMatch(/cid:/i);
  });

  it("tekst en HTML in UTF-8; de inhoud is dezelfde als zonder SMTP (aanhef, groep, App Store-link)", async () => {
    const t = newT();
    const { inviteId } = await withCover(t, { groupName: "Café Één" });
    const msg = await mailFor(t, inviteId);
    for (const { part } of leaves(msg.mime!)) {
      if (part.type.startsWith("text/")) expect((part.params.charset ?? "").toLowerCase()).toBe("utf-8");
    }
    for (const body of [msg.HTMLPart ?? "", msg.TextPart ?? ""]) {
      expect(body).toContain("Hi Nina");
      expect(body).toContain(APP_STORE_URL);
    }
    expect(msg.TextPart).toContain("Café Één");
    expect(msg.Subject).toContain("Café Één");
  });
});

describe("A-invariant 15 — Mailjet volgt de ontvanger niet (besluit 6)", () => {
  it("SMTP: X-Mailjet-TrackOpen: 0 en X-Mailjet-TrackClick: 0, elk één keer", async () => {
    const t = newT();
    const { inviteId } = await withCover(t);
    const root = (await mailFor(t, inviteId)).mime!;
    expect(header(root, "X-Mailjet-TrackOpen")).toBe("0");
    expect(header(root, "X-Mailjet-TrackClick")).toBe("0");
  });

  it("Send API, uitnodiging zonder foto: TrackOpens en TrackClicks 'disabled'", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    const msg = await mailFor(t, inviteId);
    expect(msg.transport).toBe("api");
    expect(msg.api?.TrackOpens).toBe("disabled");
    expect(msg.api?.TrackClicks).toBe("disabled");
  });

  for (const kind of ["accepted", "declined", "bounced"] as const) {
    it(`Send API, mail '${kind}': TrackOpens en TrackClicks 'disabled'`, async () => {
      const t = newT();
      const { inviteId } = await withCover(t);
      const msg = await mailFor(t, inviteId, kind);
      expect(msg.transport).toBe("api");
      expect(msg.api?.TrackOpens).toBe("disabled");
      expect(msg.api?.TrackClicks).toBe("disabled");
    });
  }

  it("geen id's, token of Convex-host in de ruwe mail, ook niet in koppen als X-MJ-CustomID", async () => {
    const t = newT();
    const { w, inviteId } = await withCover(t);
    const msg = await mailFor(t, inviteId);
    const raw = msg.raw!;
    const row = (await inviteRow(t, inviteId))!;
    for (const needle of [String(inviteId), row.token, String(w.groupId), String(w.users.olga)]) {
      expect(raw).not.toContain(needle);
    }
    expect(raw).not.toMatch(/convex\.(cloud|site)|\/beeld\//i);
    expect(header(msg.mime!, "X-MJ-CustomID")).toBeUndefined();
    expect(header(msg.mime!, "X-MJ-EventPayload")).toBeUndefined();
  });
});

describe("A-invariant 16 — zonder foto, en als SMTP faalt: de mail gaat via de Send API, zonder foto", () => {
  it("groep zonder cover: Send API, geen SMTP, geen bijlage", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    const msg = await mailFor(t, inviteId);
    expect(msg.transport).toBe("api");
    expect(smtp.transports).toHaveLength(0);
    expectNoPhoto(msg);
    expect(msg.api && "InlinedAttachments" in msg.api).toBe(false);
  });

  it("SMTP faalt: één mail via de Send API, zonder foto, en een fout in de log die SMTP noemt", async () => {
    const t = newT();
    const { inviteId } = await withCover(t);
    smtp.failWith = new Error("connect ETIMEDOUT in-v3.mailjet.com:587");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = await mailFor(t, inviteId);
    expect(msg.transport).toBe("api");
    expectNoPhoto(msg);
    expect(msg.api && "InlinedAttachments" in msg.api).toBe(false);
    expect(msg.api?.TrackOpens).toBe("disabled");
    expect(msg.HTMLPart).toContain("Hi Nina");
    expect(errors.mock.calls.some((args) => /smtp/i.test(args.map(String).join(" ")))).toBe(true);
  });
});

describe("A-invariant 17 — de poorten blijven dicht: sender-check en credentials vóór elke verzending", () => {
  async function run(t: T, inviteId: Id<"invites">) {
    const api = stubMailjet();
    const outcome = await t.action(internal.invites.sendInviteEmail, { kind: "invite", inviteId }).then(
      () => null,
      (e: unknown) => String(e),
    );
    return { outcome, api };
  }

  for (const missing of ["MAILJET_API_KEY", "MAILJET_API_SECRET"]) {
    it(`met foto, ${missing} ontbreekt: MAILJET_CREDS_MISSING, niets verstuurd, geen terugval`, async () => {
      const t = newT();
      const { inviteId } = await withCover(t);
      delete process.env[missing];
      const { outcome, api } = await run(t, inviteId);
      expect(outcome).toMatch(/MAILJET_CREDS_MISSING/);
      expect(api).not.toHaveBeenCalled();
      expect(smtp.sent).toHaveLength(0);
    });
  }

  it("met foto, invites@ niet geverifieerd: UNVERIFIED_SENDER, niets verstuurd, geen terugval", async () => {
    const t = newT();
    const { inviteId } = await withCover(t);
    process.env.MAILJET_VERIFIED_SENDERS = "info@clubalmanac.com";
    const { outcome, api } = await run(t, inviteId);
    expect(outcome).toMatch(/UNVERIFIED_SENDER/);
    expect(api).not.toHaveBeenCalled();
    expect(smtp.sent).toHaveLength(0);
  });
});

describe("A-invariant 18 — de bounce blijft gekoppeld", () => {
  const SECRET = "wp19c-webhook-secret";

  it("na een SMTP-mail: een bounce-event van Mailjet voor de genodigde zet de uitnodiging op verlopen", async () => {
    process.env.MAILJET_WEBHOOK_SECRET = SECRET;
    try {
      const t = newT();
      const { inviteId } = await withCover(t);
      expect((await mailFor(t, inviteId)).transport).toBe("smtp");
      // Zo komt een event van een SMTP-mail binnen: dezelfde Event API, met
      // het adres van de ontvanger en Mailjet's MessageID. Geen CustomID nodig.
      const res = await t.fetch("/email-event", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${btoa(`mailjet:${SECRET}`)}` },
        body: JSON.stringify([{ event: "bounce", email: "nina@x.test", MessageID: 1152921500000000000 }]),
      });
      expect(res.status).toBe(200);
      const row = (await inviteRow(t, inviteId))!;
      expect(row.status).toBe("expired");
      expect(typeof row.bouncedAt).toBe("number");
    } finally {
      delete process.env.MAILJET_WEBHOOK_SECRET;
    }
  });
});
