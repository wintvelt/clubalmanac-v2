// WP5: Mailjet client + verified-sender hard gate.
//
// Hard gate (Mailjet known-issue 2): Mailjet retourneert 200 OK óók als de
// from-address niet verified is — silent failure. We pinnen de allowed
// senders in env-var `MAILJET_VERIFIED_SENDERS` (comma-separated, trimmed,
// lowercased per-item) en checken vóór élke send. Lege/ontbrekende env-var
// = fail-closed (alle sends throwen).
//
// Mailjet Send API v3.1 contract: POST naar
// `https://api.mailjet.com/v3.1/send` met basic-auth
// (`MAILJET_API_KEY:MAILJET_API_SECRET`) en JSON body
// `{ Messages: [{ From, To, Subject, HTMLPart, TextPart, InlinedAttachments? }] }`.
//
// Sender-policy per mail-kind (spec §"Mailjet sender-policy"):
//   invite | accepted | declined | bounced → invites@clubalmanac.com
//   flagDecisionDeny | problemReport       → info@clubalmanac.com

export const INVITES_SENDER = "invites@clubalmanac.com";
export const INFO_SENDER = "info@clubalmanac.com";

const MAILJET_SEND_URL = "https://api.mailjet.com/v3.1/send";

export function getVerifiedSenders(): Set<string> {
  const raw = process.env.MAILJET_VERIFIED_SENDERS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

export function isSenderVerified(fromAddress: string): boolean {
  const set = getVerifiedSenders();
  return set.has(fromAddress.trim().toLowerCase());
}

export type MailjetRecipient = { email: string; name?: string };

/**
 * WP19c: een inline-bijlage, in de HTML aan te spreken als `cid:<contentId>`.
 * Mailjet v3.1: `InlinedAttachments: [{ ContentType, Filename, ContentID,
 * Base64Content }]`.
 */
export type MailjetInlineAttachment = {
  contentType: string;
  filename: string;
  contentId: string;
  base64Content: string;
};

export type MailjetMessage = {
  from: MailjetRecipient;
  to: MailjetRecipient[];
  subject: string;
  htmlPart: string;
  textPart: string;
  inlinedAttachments?: MailjetInlineAttachment[];
};

// Hard gate vóór de Mailjet-fetch. Gooit een typed Error met prefix
// `UNVERIFIED_SENDER:` zodat callers het pad kunnen onderscheiden.
// Mailjet wordt in dit pad nooit aangeroepen — anders trekt Mailjet de
// send aan zonder daadwerkelijk te versturen (silent failure).
function assertVerifiedSender(fromAddress: string): void {
  if (!isSenderVerified(fromAddress)) {
    throw new Error(`UNVERIFIED_SENDER: ${fromAddress}`);
  }
}

// Mailjet API-creds als basic-auth header value. Audit-follow-up 2026-05-17
// (N-1): fail-fast bij ontbrekende creds in plaats van een 401-roundtrip
// naar Mailjet. Spiegelt de bestaande verified-sender-gate-discipline
// (fail-closed vóór externe call).
function assertMailjetCreds(): void {
  const key = process.env.MAILJET_API_KEY;
  const secret = process.env.MAILJET_API_SECRET;
  if (key === undefined || key === "" || secret === undefined || secret === "") {
    throw new Error(
      "MAILJET_CREDS_MISSING: MAILJET_API_KEY or MAILJET_API_SECRET env-var unset",
    );
  }
}

function basicAuthHeader(): string {
  // assertMailjetCreds() is door de caller al gegooid als creds missen.
  const key = process.env.MAILJET_API_KEY ?? "";
  const secret = process.env.MAILJET_API_SECRET ?? "";
  return `Basic ${btoa(`${key}:${secret}`)}`;
}

// Verstuur één Mailjet-bericht. Gate-check eerst, daarna fetch. Non-2xx
// response → throw (Convex scheduler kan retry'en). 2xx-respons wordt
// niet body-geparsed — Mailjet's contract op response-shape is onstabiel,
// en de verified-sender-gate is onze enige betrouwbare silent-failure-
// verdediging.
export async function sendMailjetMessage(msg: MailjetMessage): Promise<void> {
  assertVerifiedSender(msg.from.email);
  assertMailjetCreds();

  const payload = {
    Messages: [
      {
        From: { Email: msg.from.email, ...(msg.from.name ? { Name: msg.from.name } : {}) },
        To: msg.to.map((t) => ({
          Email: t.email,
          ...(t.name ? { Name: t.name } : {}),
        })),
        Subject: msg.subject,
        HTMLPart: msg.htmlPart,
        TextPart: msg.textPart,
        // Zonder bijlagen geen sleutel (WP19c); nooit gewone `Attachments`.
        ...(msg.inlinedAttachments && msg.inlinedAttachments.length > 0
          ? {
              InlinedAttachments: msg.inlinedAttachments.map((a) => ({
                ContentType: a.contentType,
                Filename: a.filename,
                ContentID: a.contentId,
                Base64Content: a.base64Content,
              })),
            }
          : {}),
      },
    ],
  };

  const response = await fetch(MAILJET_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      // best-effort body-read for log context
    }
    throw new Error(
      `MAILJET_SEND_FAILED: status=${response.status} body=${detail.slice(0, 500)}`,
    );
  }
}
