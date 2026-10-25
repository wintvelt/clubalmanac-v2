// WP13 invarianten 7 + 14: geen stille env-defaults, geen geheimen in de bundel.
// Expo neemt een EXPO_PUBLIC_-var alleen op bij letterlijke toegang
// (`process.env.EXPO_PUBLIC_X`); de aanroeper leest ze dus zelf uit en geeft
// ze hier door.

export type ClientEnvInput = {
  EXPO_PUBLIC_CONVEX_URL?: string;
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
};

export type ClientEnv = {
  convexUrl: string;
  clerkPublishableKey: string;
};

const CONVEX_VAR = "EXPO_PUBLIC_CONVEX_URL";
const CLERK_VAR = "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY";

// Client-URL van een deployment, bv. https://glorious-pheasant-759.eu-west-1.convex.cloud.
// Geen pad of query. `.convex.site` is de HTTP-actions-host, niet de client-URL.
// Regex in plaats van `new URL()`: de URL-implementatie van React Native is beperkt.
const CONVEX_CLOUD_URL = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.convex\.cloud\/?$/i;

const CLERK_PUBLISHABLE_KEY = /^pk_(test|live)_[A-Za-z0-9+/=_-]+$/;

// Gooit één Error die elke ontbrekende of ongeldige var bij naam noemt. De
// waarden zelf staan nooit in de melding: een verkeerd geplakte secret key mag
// niet in een log of op het scherm belanden.
export function parseClientEnv(env: ClientEnvInput): ClientEnv {
  const convexUrl = env.EXPO_PUBLIC_CONVEX_URL?.trim() ?? "";
  const clerkPublishableKey = env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  const problems: string[] = [];

  if (convexUrl === "") {
    problems.push(`${CONVEX_VAR} ontbreekt.`);
  } else if (!CONVEX_CLOUD_URL.test(convexUrl)) {
    problems.push(
      `${CONVEX_VAR} is geen Convex-client-URL (verwacht https://<deployment>.convex.cloud).`,
    );
  }

  if (clerkPublishableKey === "") {
    problems.push(`${CLERK_VAR} ontbreekt.`);
  } else if (!CLERK_PUBLISHABLE_KEY.test(clerkPublishableKey)) {
    problems.push(
      `${CLERK_VAR} is geen Clerk publishable key (verwacht pk_test_… of pk_live_…).`,
    );
  }

  if (problems.length > 0) {
    throw new Error(`App-configuratie ongeldig:\n${problems.join("\n")}`);
  }
  return { convexUrl, clerkPublishableKey };
}
