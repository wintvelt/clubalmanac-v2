import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// WP11 — Mailjet send-roundtrip (live integration, A + audit, geen B)
//
// Pin't het EXTERNE Mailjet-contract direct via `fetch` naar de Send API
// (v3.1) — NIET via `convex/lib/mailjet.ts`. Onze interne sender-gate
// (`isSenderVerified` op `MAILJET_VERIFIED_SENDERS`) is pure logica, al
// uitputtend unit-getest in tests/email/mailjetClient.test.ts; die hoort
// hier niet thuis. Wat we hier pinnen is *Mailjet's eigen gedrag*, en
// specifiek de silent-failure-bias die WP5's setup-time-gate motiveerde:
//   external-services.md §Known issues #2 — "Mailjet retourneert 200 OK óók
//   wanneer de from-address niet geverifieerd is. Mail wordt dan niet
//   verstuurd zonder dat de caller dat ziet."
//
// Dit is per integration-tests.md óók DISCOVERY: de eerste echte run laat
// Mailjet's actuele contract zien. Wijzigt Mailjet z'n gedrag (bv. 400 i.p.v.
// silent 200, of plotseling een sender-error in de body) → deze test faalt,
// exact het signaal dat we vóór cutover willen.
//
// Niet in CI. Lokaal: `npm run test:integration`. Vereiste env-vars staan in
// .env.integration.example (sectie WP11 — Mailjet). Ontbreekt er één → de
// suite skipt luid met reason (geen stille pass).
//
// Bewust NIET (zie WP11-spec §scope-uitsluitingen):
//   - geen mailbox-arrival-check (mens-stap in cutover-week, runbook)
//   - geen /REST/message/{ID}-status-poll (Mailjet eventual-consistency,
//     te flaky voor automated test)
// ---------------------------------------------------------------------------

const MAILJET_SEND_URL = "https://api.mailjet.com/v3.1/send";

const REQUIRED_ENV = [
  "MAILJET_API_KEY",
  "MAILJET_API_SECRET",
  "MAILJET_TEST_VERIFIED_FROM",
  "MAILJET_TEST_UNVERIFIED_FROM",
] as const;

const missing = REQUIRED_ENV.filter(
  (k) => !process.env[k] || process.env[k]!.length === 0,
);
const enabled = missing.length === 0;

// Mailjet Send API v3.1 response-shape (subset). Status is per-message;
// een succesvolle delivery levert `Status: "success"` met een MessageID per
// recipient. Bij een onverified/geblokkeerde sender verwachten we GEEN
// success-MessageID — dat is de silent-failure-pin.
type MailjetSendResponse = {
  Messages?: Array<{
    Status?: string;
    To?: Array<{ Email?: string; MessageID?: string | number }>;
    Errors?: Array<{ ErrorMessage?: string; ErrorCode?: string }>;
  }>;
};

/**
 * Geeft de delivery-MessageID terug als Mailjet het bericht daadwerkelijk
 * heeft geaccepteerd voor bezorging (`Status: "success"` + niet-lege
 * MessageID). Anders `null` — dat dekt zowel het expliciete error-pad
 * (`Status: "error"`) als het silent-failure-pad (geen MessageID).
 */
function deliveredMessageId(body: MailjetSendResponse): string | null {
  const m = body.Messages?.[0];
  if (!m) return null;
  if (m.Status !== "success") return null;
  const raw = m.To?.[0]?.MessageID;
  if (raw === undefined || raw === null) return null;
  const id = String(raw);
  if (id.length === 0 || id === "0") return null;
  return id;
}

function basicAuthHeader(): string {
  const key = process.env.MAILJET_API_KEY ?? "";
  const secret = process.env.MAILJET_API_SECRET ?? "";
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

async function mailjetSend(fromEmail: string, toEmail: string) {
  const payload = {
    Messages: [
      {
        From: { Email: fromEmail, Name: "Clubalmanac WP11 gate" },
        To: [{ Email: toEmail }],
        Subject: "Clubalmanac WP11 integration gate",
        HTMLPart: "<p>WP11 Mailjet send-roundtrip gate. Negeren.</p>",
        TextPart: "WP11 Mailjet send-roundtrip gate. Negeren.",
      },
    ],
  };
  const res = await fetch(MAILJET_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  // Body kan leeg/niet-JSON zijn bij rare edge-cases; defensief parsen.
  let body: MailjetSendResponse = {};
  try {
    body = (await res.json()) as MailjetSendResponse;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

describe("WP11 — Mailjet send-roundtrip (live)", () => {
  if (!enabled) {
    it.skip(
      `SKIP: ontbrekende env-vars (${missing.join(", ")}) — zie .env.integration.example §WP11`,
      () => {},
    );
    return;
  }

  const verifiedFrom = process.env.MAILJET_TEST_VERIFIED_FROM!;
  const unverifiedFrom = process.env.MAILJET_TEST_UNVERIFIED_FROM!;
  const toEmail =
    process.env.MAILJET_TEST_TO ?? "clubalmanac-integration-regular@example.com";

  it(
    "onverified From → Send API antwoordt 200 maar levert GEEN delivery-MessageID (silent-failure-pin)",
    async () => {
      // De kern van known-issue #2: Mailjet wijst de POST niet af op
      // HTTP-niveau (geen 4xx) maar het bericht wordt niet bezorgd. We pinnen
      // beide observaties: status 200 + geen success-MessageID. Faalt deze
      // assert, dan is Mailjet's contract veranderd — inspecteer vóór cutover.
      const { status, body } = await mailjetSend(unverifiedFrom, toEmail);

      // Discovery: log de volledige response zodat een afwijkend contract
      // zichtbaar is in de test-output (integration-tests.md §discovery).
      console.info(
        "[WP11] Mailjet onverified-From response:",
        status,
        JSON.stringify(body),
      );

      expect(status).toBe(200);
      expect(deliveredMessageId(body)).toBeNull();
    },
    30_000,
  );

  it(
    "verified From → Send API antwoordt 200 + niet-lege delivery-MessageID (happy-path)",
    async () => {
      const { status, body } = await mailjetSend(verifiedFrom, toEmail);

      console.info(
        "[WP11] Mailjet verified-From response:",
        status,
        JSON.stringify(body),
      );

      expect(status).toBe(200);
      const messageId = deliveredMessageId(body);
      expect(messageId).not.toBeNull();
      expect(typeof messageId).toBe("string");
      expect(messageId!.length).toBeGreaterThan(0);
    },
    30_000,
  );
});
