// Test-helper: genereert geldige Svix Standard-Webhooks headers voor het
// `/clerk-webhook` endpoint. Onder de motorkap gebruikt B's impl
// `@clerk/backend.verifyWebhook`, dat op zijn beurt `standardwebhooks.Webhook`
// gebruikt — we hergebruiken dezelfde lib hier om signatures te tekenen,
// zodat tests niet alleen op fail-mode-paden (missing/invalid headers) leunen
// maar ook 200-paden kunnen pinnen.
//
// Secret-format = `whsec_<base64>` zoals Clerk dashboard 'm aanlevert.
// Voor tests gebruiken we een vaste known-base64 (32 nul-bytes), zodat
// elke test reproduceerbaar is.

import { Webhook } from "standardwebhooks";

// 32 nul-bytes als base64 → `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`.
// Inclusief `whsec_` prefix omdat Clerk dashboard die altijd toevoegt; lib
// strip 'm zelf.
export const TEST_WEBHOOK_SECRET =
  "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export function signSvixHeaders(opts: {
  body: string;
  secret?: string;
  msgId?: string;
  timestamp?: Date;
}): Record<string, string> {
  const wh = new Webhook(opts.secret ?? TEST_WEBHOOK_SECRET);
  const msgId = opts.msgId ?? `msg_test_${crypto.randomUUID()}`;
  const timestamp = opts.timestamp ?? new Date();
  // `sign` retourneert `v1,<base64-signature>`. Svix-signature-header
  // accepteert space-separated lijst van versioned signatures.
  const signature = wh.sign(msgId, timestamp, opts.body);
  return {
    "svix-id": msgId,
    "svix-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
    "svix-signature": signature,
    "Content-Type": "application/json",
  };
}

// Helper voor het bouwen van een minimale `session.created`-payload die
// `@clerk/backend.verifyWebhook` types respecteert. We laten optionele velden
// als `client_id`, `actor`, etc. weg waar de impl ze niet nodig heeft — pinnen
// alleen de velden waarop registerFromSession leunt.
export function sessionCreatedPayload(opts: {
  subject: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  emailVerified?: boolean;
  primaryEmailId?: string;
  emailAddresses?: Array<{
    id: string;
    email: string;
    verified: boolean;
  }>;
}): string {
  const primaryEmailId = opts.primaryEmailId ?? "idn_primary";
  const emailAddresses = opts.emailAddresses ?? [
    {
      id: primaryEmailId,
      email: opts.email,
      verified: opts.emailVerified ?? true,
    },
  ];
  return JSON.stringify({
    type: "session.created",
    object: "event",
    data: {
      object: "session",
      id: `sess_${crypto.randomUUID()}`,
      user_id: opts.subject,
      status: "active",
      actor: null,
      last_active_at: Date.now(),
      expire_at: Date.now() + 86400_000,
      abandon_at: Date.now() + 86400_000,
      created_at: Date.now(),
      updated_at: Date.now(),
      user: {
        object: "user",
        id: opts.subject,
        first_name: opts.firstName ?? null,
        last_name: opts.lastName ?? null,
        username: null,
        image_url: "",
        has_image: false,
        primary_email_address_id: primaryEmailId,
        primary_phone_number_id: null,
        primary_web3_wallet_id: null,
        password_enabled: true,
        two_factor_enabled: false,
        totp_enabled: false,
        backup_code_enabled: false,
        email_addresses: emailAddresses.map((ea) => ({
          object: "email_address",
          id: ea.id,
          email_address: ea.email,
          verification: ea.verified
            ? { status: "verified", strategy: "email_code" }
            : { status: "unverified", strategy: "email_code" },
          linked_to: [],
        })),
        phone_numbers: [],
        web3_wallets: [],
        organization_memberships: null,
        external_accounts: [],
        enterprise_accounts: [],
        password_last_updated_at: null,
        public_metadata: {},
        private_metadata: {},
        unsafe_metadata: {},
        external_id: null,
        last_sign_in_at: Date.now(),
        banned: false,
        locked: false,
        lockout_expires_in_seconds: null,
        verification_attempts_remaining: null,
        created_at: Date.now(),
        updated_at: Date.now(),
        last_active_at: Date.now(),
        create_organization_enabled: true,
        create_organizations_limit: null,
        delete_self_enabled: true,
        legal_accepted_at: null,
        locale: null,
      },
    },
    event_attributes: {
      http_request: { client_ip: "127.0.0.1", user_agent: "test" },
    },
  });
}

// Variant met expliciete event-type override (voor user.created / user.updated /
// user.deleted / session.ended tests). Body-shape verder gelijk aan
// sessionCreatedPayload — payload-shape valideren op event-type-filter is
// het doel, niet payload-shape per event-type.
export function eventPayload(opts: {
  type: string;
  subject: string;
  email: string;
}): string {
  const base = JSON.parse(sessionCreatedPayload(opts));
  base.type = opts.type;
  return JSON.stringify(base);
}

// data.user === null variant — pin't graceful no-op-pad.
export function sessionCreatedNullUserPayload(subject: string): string {
  const base = JSON.parse(sessionCreatedPayload({ subject, email: "x@x.com" }));
  base.data.user = null;
  return JSON.stringify(base);
}
