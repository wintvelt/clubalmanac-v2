// WP12 — configuratie. Eén tool, twee configuraties.
//
// Invariant (WP12 §Invarianten): "Dev en prod verschillen alleen in config
// (filter, anonimisatie, ID-map, doel-deployment), niet in code-pad. Een
// verschil dat niet in config uit te drukken is, is een ontwerpfout."
//
// De ID-map staat NIET in de repo. Dev bevat Cognito-subs, prod bovendien de
// 16 echte emailadressen — beide PII. Ze wonen in `scripts/.data/`, dat
// gitignored is.

import { DEFAULT_PHOTO_LIMIT } from "../../convex/lib/constants.ts";
import { dataFileExists, readData } from "./paths.ts";
import type { TransformConfig } from "./transform.ts";
import type { SourceItem } from "./types.ts";

export type Target = "dev" | "prod";

export const DEV_CONFIG_FILE = "dev-config.json";
export const PROD_CONFIG_FILE = "prod-config.json";

type DevConfigFile = {
  /** De 3 chosen users, als `U{cognitoSub}` zoals in de DynamoDB-sleutel. */
  chosenUserIds: string[];
  /** `U{cognitoSub}` → Clerk-**dev**-ID. Handmatig aangemaakt in dev-Clerk. */
  subjectByUserId: Record<string, string>;
  founderOverrides?: Record<string, string>;
};

type ProdConfigFile = {
  /**
   * email → Clerk-**prod**-ID. Gevuld op T-2 weken nadat de 16 users via de
   * Clerk Invitations API zijn voorgemaakt (migratie-status fase 5).
   */
  clerkIdByEmail: Record<string, string>;
  founderOverrides?: Record<string, string>;
};

const DEV_EXAMPLE = `{
  "chosenUserIds": ["U<sub-1>", "U<sub-2>", "U<sub-3>"],
  "subjectByUserId": { "U<sub-1>": "user_...", "U<sub-2>": "user_...", "U<sub-3>": "user_..." },
  "founderOverrides": {}
}`;

const PROD_EXAMPLE = `{
  "clerkIdByEmail": { "iemand@voorbeeld.nl": "user_..." },
  "founderOverrides": {}
}`;

function missing(file: string, example: string): never {
  throw new Error(
    `[migrate] scripts/.data/${file} ontbreekt. Maak 'm aan met deze vorm:\n${example}\n` +
      `Zie docs/runbooks/wp12-data-migratie.md.`,
  );
}

/**
 * Bouwt de transform-config voor een target. De prod-ID-map is email →
 * Clerk-ID; die wordt hier herleid naar `U{sub}` → Clerk-ID aan de hand van het
 * extract, zodat `transform` zelf één code-pad houdt.
 */
export function loadConfig(target: Target, items: SourceItem[], now: number): TransformConfig {
  if (target === "dev") {
    if (!dataFileExists(DEV_CONFIG_FILE)) missing(DEV_CONFIG_FILE, DEV_EXAMPLE);
    const file = readData<DevConfigFile>(DEV_CONFIG_FILE);
    if (!Array.isArray(file.chosenUserIds) || file.chosenUserIds.length === 0) {
      throw new Error(`[migrate] ${DEV_CONFIG_FILE}: chosenUserIds is leeg. Draai eerst 'inspect'.`);
    }
    return {
      target: "dev",
      chosenUserIds: file.chosenUserIds,
      anonymize: true,
      subjectByUserId: file.subjectByUserId ?? {},
      defaultPhotoLimit: DEFAULT_PHOTO_LIMIT,
      now,
      founderOverrides: file.founderOverrides,
    };
  }

  if (!dataFileExists(PROD_CONFIG_FILE)) missing(PROD_CONFIG_FILE, PROD_EXAMPLE);
  const file = readData<ProdConfigFile>(PROD_CONFIG_FILE);
  const byEmail = new Map<string, string>();
  for (const [email, clerkId] of Object.entries(file.clerkIdByEmail ?? {})) {
    byEmail.set(email.trim().toLowerCase(), clerkId);
  }
  if (byEmail.size === 0) {
    throw new Error(
      `[migrate] ${PROD_CONFIG_FILE}: clerkIdByEmail is leeg. Zonder ID-map kan geen enkele ` +
        `user na cutover inloggen.`,
    );
  }

  // email → Clerk-ID herleiden naar U{sub} → Clerk-ID via de UBbase-records.
  const subjectByUserId: Record<string, string> = {};
  for (const item of items) {
    if (item.PK !== "UBbase") continue;
    const userId = typeof item.SK === "string" ? item.SK : undefined;
    const email = typeof item.email === "string" ? item.email.trim().toLowerCase() : undefined;
    if (userId === undefined || email === undefined) continue;
    const clerkId = byEmail.get(email);
    if (clerkId !== undefined) subjectByUserId[userId] = clerkId;
  }

  return {
    target: "prod",
    chosenUserIds: null,
    anonymize: false,
    subjectByUserId,
    defaultPhotoLimit: DEFAULT_PHOTO_LIMIT,
    now,
    founderOverrides: file.founderOverrides,
  };
}

// ── AWS-bron ──────────────────────────────────────────────────────────
//
// Eén bron: de productie-tabel en de productie-bucket, in eu-central-1. Ook de
// dev-seed leest productie — de AWS-dev-omgeving wordt bewust genegeerd, want
// alleen productie is representatief genoeg om clients tegenaan te bouwen.
// Overschrijfbaar via env, met de gebruikte waarden altijd in de banner.

export type AwsSource = { region: string; table: string; bucket: string };

export function awsSource(): AwsSource {
  return {
    region: process.env.MIGRATE_AWS_REGION ?? "eu-central-1",
    table: process.env.MIGRATE_DYNAMO_TABLE ?? "blob-images-photos-prod",
    bucket: process.env.MIGRATE_S3_BUCKET ?? "blob-images",
  };
}
