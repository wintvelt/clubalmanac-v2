// WP31 — de Clerk-ID-map voor prod (`clerkIdByEmail` in prod-config.json).
//
// Inloggen op prod gaat alleen op de Clerk-ID: het adres wordt daarbij niet
// vergeleken. Een verwisselde ID in de map laat lid B dus stil de groepen van
// lid A zien, en `verify` ziet dat niet. Daarom wordt de map niet overgetypt
// maar uit Clerk prod zelf gehaald, op primair adres, en elke run controleert
// de map die er al staat tegen Clerk.
//
//   npm run migrate -- clerk-ids             alleen lezen: vergelijken en melden
//   npm run migrate -- clerk-ids --create    de ontbrekende leden aanmaken in Clerk
//                                            prod (geen mail, geen wachtwoord);
//                                            eist MIGRATE_ALLOW_PROD=yes
//   npm run migrate -- clerk-ids --write     de map in prod-config.json zetten
//
// De leden komen uit het extract, min `excludeUserIds` uit prod-config.json.
// Die lijst moet er dus eerst staan, anders wordt het reviewaccount ook
// aangemaakt. Sleutel: MIGRATE_CLERK_SECRET_KEY_PROD in .env.migrate.

import { config as loadDotenv } from "dotenv";
import { PROD_CONFIG_FILE } from "./config.ts";
import { dataFileExists, EXTRACT_FILE, readData, writeData } from "./paths.ts";
import type { SourceItem } from "./types.ts";

loadDotenv({ path: ".env.migrate", quiet: true });

const CLERK_API = "https://api.clerk.com/v1/users";
const PAGE = 500;

type ClerkUser = {
  id: string;
  primary_email_address_id: string | null;
  email_addresses: Array<{ id: string; email_address: string }>;
};

type Member = { userId: string; name: string };

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

function secretKey(): string {
  const key = process.env.MIGRATE_CLERK_SECRET_KEY_PROD?.trim();
  if (key === undefined || key === "") {
    throw new Error(
      "[migrate] MIGRATE_CLERK_SECRET_KEY_PROD ontbreekt in .env.migrate (Clerk-dashboard → prod → API keys).",
    );
  }
  if (!key.startsWith("sk_live_")) {
    throw new Error("[migrate] MIGRATE_CLERK_SECRET_KEY_PROD is geen prod-sleutel (begint niet met sk_live_).");
  }
  return key;
}

async function clerk(key: string, init: { method: string; path?: string; body?: unknown }): Promise<unknown> {
  const response = await fetch(`${CLERK_API}${init.path ?? ""}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`[migrate] Clerk ${init.method} ${init.path ?? "/"}: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function listClerkUsers(key: string): Promise<ClerkUser[]> {
  const all: ClerkUser[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = (await clerk(key, { method: "GET", path: `?limit=${PAGE}&offset=${offset}` })) as ClerkUser[];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

function primaryEmail(user: ClerkUser): string | undefined {
  const found = user.email_addresses.find((e) => e.id === user.primary_email_address_id);
  return found === undefined ? undefined : normalize(found.email_address);
}

/** primair adres → Clerk-ID. Twee Clerk-users met hetzelfde primaire adres is een stop. */
function byPrimaryEmail(users: ClerkUser[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const user of users) {
    const email = primaryEmail(user);
    if (email === undefined) continue;
    const clash = map.get(email);
    if (clash !== undefined) {
      throw new Error(`[migrate] Clerk prod heeft twee users met hetzelfde primaire adres: ${clash} en ${user.id}.`);
    }
    map.set(email, user.id);
  }
  return map;
}

export async function clerkIds(create: boolean, write: boolean): Promise<number> {
  if (!dataFileExists(PROD_CONFIG_FILE)) {
    throw new Error(
      `[migrate] scripts/.data/${PROD_CONFIG_FILE} ontbreekt. Zet er eerst excludeUserIds in ` +
        `(het reviewaccount), anders wordt dat ook aangemaakt.`,
    );
  }
  const config = readData<Record<string, unknown>>(PROD_CONFIG_FILE);
  const excluded = new Set(Array.isArray(config.excludeUserIds) ? (config.excludeUserIds as string[]) : []);
  if (excluded.size === 0) {
    throw new Error(`[migrate] ${PROD_CONFIG_FILE}: excludeUserIds is leeg; het reviewaccount moet erin (W5).`);
  }

  // De leden: UBbase-records uit het extract, min de uitgesloten users.
  const { items } = readData<{ items: SourceItem[] }>(EXTRACT_FILE);
  const members = new Map<string, Member>();
  for (const item of items) {
    if (item.PK !== "UBbase" || typeof item.SK !== "string" || excluded.has(item.SK)) continue;
    if (typeof item.email !== "string") throw new Error(`[migrate] user ${item.SK} heeft geen adres in het extract.`);
    const email = normalize(item.email);
    if (members.has(email)) throw new Error(`[migrate] user ${item.SK} heeft hetzelfde adres als een andere user in het extract.`);
    members.set(email, { userId: item.SK, name: typeof item.name === "string" ? item.name : "?" });
  }
  console.log(`[clerk-ids] ${members.size} leden in het extract (zonder ${excluded.size} uitgesloten)`);

  const key = secretKey();
  let clerkByEmail = byPrimaryEmail(await listClerkUsers(key));

  if (create) {
    if (process.env.MIGRATE_ALLOW_PROD !== "yes") {
      throw new Error("[migrate] --create schrijft in Clerk prod en vereist MIGRATE_ALLOW_PROD=yes.");
    }
    let created = 0;
    for (const [email, member] of members) {
      if (clerkByEmail.has(email)) continue;
      // Backend API: geen uitnodiging, geen verificatiemail.
      await clerk(key, {
        method: "POST",
        body: { email_address: [email], skip_password_requirement: true },
      });
      created++;
      console.log(`[clerk-ids] aangemaakt: ${member.name} (${member.userId})`);
    }
    console.log(`[clerk-ids] ${created} aangemaakt`);
    clerkByEmail = byPrimaryEmail(await listClerkUsers(key));
  }

  let problems = 0;
  for (const [email, member] of members) {
    if (!clerkByEmail.has(email)) {
      problems++;
      console.log(`[clerk-ids] ONTBREEKT in Clerk prod: ${member.name} (${member.userId})`);
    }
  }
  const memberIds = new Set([...members.keys()].map((email) => clerkByEmail.get(email)));
  const extra = [...clerkByEmail.values()].filter((id) => !memberIds.has(id));
  if (extra.length > 0) {
    console.log(
      `[clerk-ids] ${extra.length} Clerk-user(s) zonder lid in het extract (demo-account, wegwerp uit de rooktests): ` +
        extra.join(", "),
    );
  }

  // De map die er al staat: elke ID moet in Clerk precies dát primaire adres hebben.
  const existing = (config.clerkIdByEmail ?? {}) as Record<string, string>;
  const idToEmail = new Map([...clerkByEmail].map(([email, id]) => [id, email]));
  const seen = new Set<string>();
  for (const [rawEmail, id] of Object.entries(existing)) {
    const email = normalize(rawEmail);
    if (seen.has(id)) {
      problems++;
      console.log(`[clerk-ids] MAP: ${id} staat bij meer dan één adres`);
    }
    seen.add(id);
    if (idToEmail.get(id) !== email) {
      problems++;
      const member = members.get(email);
      console.log(
        `[clerk-ids] MAP KLOPT NIET: ${member?.name ?? "onbekend adres"} wijst naar ${id}, ` +
          `maar dat is in Clerk ${idToEmail.has(id) ? "een ander adres" : "geen bestaande user"}`,
      );
    }
    if (!members.has(email)) {
      problems++;
      console.log(`[clerk-ids] MAP: ${id} hoort bij geen lid in het extract`);
    }
  }
  const missingInMap = [...members.keys()].filter((email) => existing[email] === undefined).length;

  if (write) {
    const missing = [...members.keys()].filter((email) => !clerkByEmail.has(email));
    if (missing.length > 0) {
      console.log(`[clerk-ids] niet geschreven: ${missing.length} lid/leden ontbreken in Clerk prod`);
      return 1;
    }
    const map: Record<string, string> = {};
    for (const email of [...members.keys()].sort()) map[email] = clerkByEmail.get(email)!;
    writeData(PROD_CONFIG_FILE, { ...config, clerkIdByEmail: map });
    console.log(`[clerk-ids] clerkIdByEmail geschreven: ${Object.keys(map).length} leden, gelijk aan Clerk prod`);
    return 0;
  }

  if (missingInMap > 0) console.log(`[clerk-ids] ${missingInMap} lid/leden nog niet in clerkIdByEmail (draai met --write)`);
  if (problems === 0 && missingInMap === 0) {
    console.log(`[clerk-ids] in orde: clerkIdByEmail is gelijk aan Clerk prod (${members.size} leden)`);
    return 0;
  }
  return 1;
}
