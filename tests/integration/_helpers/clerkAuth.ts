import { createClerkClient } from "@clerk/backend";

// Clerk session-token mint helper voor de integration-suite (WP4).
//
// Doel: een **echte** Clerk JWT minten voor een test-user, zodat de
// integration-tests pinnen dat de "convex" JWT-template inderdaad de
// `email`-claim doorlevert. `t.withIdentity({ email })` in de unit-suite
// zegt daar niets over — dat is een mock van de identity, niet van het
// JWT-template-traject. Zie productie-blind-spot in plan-doc r.251.
//
// Gebruik:
//   const { token } = await mintTokenForEmail(email);
//   await fetch(whoamiUrl, { headers: { Authorization: `Bearer ${token}` } });
//
// Wouter maakt de test-users handmatig aan in de Clerk dev-instance
// (`picked-quail-97.clerk.accounts.dev`). De webmaster-test-user moet
// óók in `WEBMASTER_EMAILS` op de Convex dev-deployment staan, anders
// faalt `requireWebmaster` op email-match.
//
// JWT-template `convex` is geconfigureerd in Clerk dashboard en gematched
// door `convex/auth.config.ts` (`applicationID: "convex"`).

const JWT_TEMPLATE = "convex";

let cachedClient: ReturnType<typeof createClerkClient> | null = null;

function getClient(): ReturnType<typeof createClerkClient> {
  if (cachedClient) return cachedClient;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey || secretKey.length === 0) {
    throw new Error(
      "CLERK_SECRET_KEY ontbreekt. Zet 'm in .env.integration (zie .env.integration.example).",
    );
  }
  if (!secretKey.startsWith("sk_test_")) {
    // Clerk prod secrets beginnen met `sk_live_`. Tests mogen NOOIT tegen
    // prod minten — dat zou prod-users een sessie geven puur voor een test.
    throw new Error(
      `CLERK_SECRET_KEY lijkt geen dev-instance secret (verwacht prefix "sk_test_"). Integration-tests mogen niet tegen prod Clerk draaien.`,
    );
  }
  cachedClient = createClerkClient({ secretKey });
  return cachedClient;
}

/**
 * Zoek de Clerk user-ID die hoort bij dit emailadres.
 *
 * Throwt als niemand of meerderen matchen — de test-fixture moet
 * unambigu zijn. Zie .env.integration.example voor de var-namen.
 */
async function findUserIdByEmail(email: string): Promise<string> {
  const client = getClient();
  const list = await client.users.getUserList({ emailAddress: [email] });
  if (list.totalCount === 0) {
    throw new Error(
      `Clerk dev-instance heeft geen user met email "${email}". ` +
        `Wouter moet de test-user handmatig aanmaken in Clerk dashboard.`,
    );
  }
  if (list.totalCount > 1) {
    throw new Error(
      `Clerk dev-instance heeft meerdere users met email "${email}" (totalCount=${list.totalCount}). ` +
        `Dedup vereist — test-fixture moet unambigu zijn.`,
    );
  }
  return list.data[0].id;
}

/**
 * Mint een verse Clerk session-JWT voor de gegeven test-user-email,
 * gebruikmakend van de "convex" JWT-template.
 *
 * Returnt de raw `jwt`-string die direct als `Authorization: Bearer <jwt>`
 * naar een Convex httpAction kan.
 */
export async function mintTokenForEmail(
  email: string,
): Promise<{ jwt: string; userId: string; sessionId: string }> {
  const client = getClient();
  const userId = await findUserIdByEmail(email);
  const session = await client.sessions.createSession({ userId });
  const token = await client.sessions.getToken(session.id, JWT_TEMPLATE);
  return { jwt: token.jwt, userId, sessionId: session.id };
}

/**
 * Best-effort cleanup: revoke de sessie zodat we Clerk niet vol slepen
 * met losse test-sessies. Faalt geruisloos — cleanup mag tests niet rood
 * maken (consistent met `convex/_test.ts` storageDelete-pattern).
 */
export async function revokeSessionQuietly(sessionId: string): Promise<void> {
  try {
    await getClient().sessions.revokeSession(sessionId);
  } catch {
    // best-effort
  }
}
