import { describe, expect, it } from "vitest";
import { parseClientEnv } from "../src/lib/env";

// WP13 invarianten 7 + 14: geen stille env-defaults, geen geheimen in de bundel.
// De app leest twee EXPO_PUBLIC_-vars. Ontbreekt er een of is hij ongeldig,
// dan stopt de app bij de start met een melding die de var bij naam noemt.

const CONVEX_URL = "https://glorious-pheasant-759.eu-west-1.convex.cloud";
const CLERK_KEY = "pk_test_cGlja2VkLXF1YWlsLTk3LmNsZXJrLmFjY291bnRzLmRldiQ";

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e;
    throw new Error(`gooide geen Error maar ${String(e)}`);
  }
  throw new Error("gooide niets");
}

describe("parseClientEnv — geldige waarden", () => {
  it("geeft de dev-combinatie terug", () => {
    expect(
      parseClientEnv({
        EXPO_PUBLIC_CONVEX_URL: CONVEX_URL,
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: CLERK_KEY,
      }),
    ).toEqual({ convexUrl: CONVEX_URL, clerkPublishableKey: CLERK_KEY });
  });

  it("haalt spaties en regeleinden rond de waarden weg", () => {
    expect(
      parseClientEnv({
        EXPO_PUBLIC_CONVEX_URL: `  ${CONVEX_URL}\n`,
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: ` ${CLERK_KEY} `,
      }),
    ).toEqual({ convexUrl: CONVEX_URL, clerkPublishableKey: CLERK_KEY });
  });

  it("accepteert een live publishable key (prod, fase 5)", () => {
    const live = "pk_live_Y2xlcmsuY2x1YmFsbWFuYWMuY29tJA";
    expect(
      parseClientEnv({
        EXPO_PUBLIC_CONVEX_URL: CONVEX_URL,
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: live,
      }).clerkPublishableKey,
    ).toBe(live);
  });
});

describe("parseClientEnv — ontbrekende waarden (invariant 7)", () => {
  it("zonder Convex-URL: fout noemt EXPO_PUBLIC_CONVEX_URL", () => {
    const err = errorOf(() =>
      parseClientEnv({ EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: CLERK_KEY }),
    );
    expect(err.message).toContain("EXPO_PUBLIC_CONVEX_URL");
    expect(err.message).not.toContain("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
  });

  it("zonder Clerk-key: fout noemt EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", () => {
    const err = errorOf(() =>
      parseClientEnv({ EXPO_PUBLIC_CONVEX_URL: CONVEX_URL }),
    );
    expect(err.message).toContain("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(err.message).not.toContain("EXPO_PUBLIC_CONVEX_URL");
  });

  it("zonder beide: fout noemt beide in één keer", () => {
    const err = errorOf(() => parseClientEnv({}));
    expect(err.message).toContain("EXPO_PUBLIC_CONVEX_URL");
    expect(err.message).toContain("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
  });

  it("lege string en alleen-spaties tellen als ontbrekend", () => {
    const err = errorOf(() =>
      parseClientEnv({
        EXPO_PUBLIC_CONVEX_URL: "",
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "   ",
      }),
    );
    expect(err.message).toContain("EXPO_PUBLIC_CONVEX_URL");
    expect(err.message).toContain("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
  });
});

describe("parseClientEnv — ongeldige Convex-URL", () => {
  const cases: Array<[string, string]> = [
    // .convex.site is de HTTP-actions-host (webhooks), niet de client-URL.
    ["HTTP-actions-host", "https://glorious-pheasant-759.eu-west-1.convex.site"],
    ["geen https", "http://glorious-pheasant-759.eu-west-1.convex.cloud"],
    ["geen URL", "glorious-pheasant-759"],
    ["ander domein", "https://example.com"],
    ["convex.cloud alleen in de query", "https://evil.example.com/?x=.convex.cloud"],
    ["convex.cloud als prefix van ander domein", "https://a.convex.cloud.evil.example.com"],
  ];

  for (const [label, url] of cases) {
    it(`weigert ${label}`, () => {
      const err = errorOf(() =>
        parseClientEnv({
          EXPO_PUBLIC_CONVEX_URL: url,
          EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: CLERK_KEY,
        }),
      );
      expect(err.message).toContain("EXPO_PUBLIC_CONVEX_URL");
    });
  }
});

describe("parseClientEnv — ongeldige Clerk-key (invariant 14)", () => {
  it("weigert een secret key en toont de waarde niet", () => {
    const secret = "sk_test_ditIsGeheimEnMagNietInDeLogs123";
    const err = errorOf(() =>
      parseClientEnv({
        EXPO_PUBLIC_CONVEX_URL: CONVEX_URL,
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: secret,
      }),
    );
    expect(err.message).toContain("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(err.message).not.toContain(secret);
    expect(err.message).not.toContain("ditIsGeheim");
  });

  it("weigert een live secret key", () => {
    const err = errorOf(() =>
      parseClientEnv({
        EXPO_PUBLIC_CONVEX_URL: CONVEX_URL,
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "sk_live_abc123",
      }),
    );
    expect(err.message).toContain("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
  });

  it("weigert een willekeurige string", () => {
    const err = errorOf(() =>
      parseClientEnv({
        EXPO_PUBLIC_CONVEX_URL: CONVEX_URL,
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "picked-quail-97",
      }),
    );
    expect(err.message).toContain("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
  });

  it("weigert een prefix zonder inhoud", () => {
    const err = errorOf(() =>
      parseClientEnv({
        EXPO_PUBLIC_CONVEX_URL: CONVEX_URL,
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_",
      }),
    );
    expect(err.message).toContain("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
  });
});
