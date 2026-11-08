import { randomBytes } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { beforeAll, describe, expect, it } from "vitest";
import { makeConvexClient } from "../_helpers/convexClient";
import { assertNotProd } from "../_helpers/safety";
import { makeTestFunctionsClient } from "../_helpers/testSecret";

// ---------------------------------------------------------------------------
// WP26 gate-stap 6 — de _test-functies op dev weigeren zonder geheim
//
// Tegen de echte dev-deployment: met het geheim (uit .env.integration) werkt
// een _test-functie; zonder of met een fout geheim weigert hij, met
// hetzelfde antwoord, en niet door argumentvalidatie. De unit-suite
// (tests/testGate/) pint dit in-process; deze laag toont dat de code en de
// env-vars op dev kloppen.
//
// Niet in CI. Pas draaien als de WP26-code op dev staat.
//   npm run test:integration -- tests/integration/convex/testGate.test.ts
// ---------------------------------------------------------------------------

const FN_UPLOAD = makeFunctionReference<
  "action",
  { bytes: ArrayBuffer; contentType?: string },
  { storageId: string }
>("_test:storageUpload");
const FN_DOWNLOAD_URL = makeFunctionReference<
  "query",
  { storageId: string; testSecret?: string },
  string | null
>("_test:storageDownloadUrl");
const FN_DELETE = makeFunctionReference<
  "mutation",
  { storageId: string },
  null
>("_test:storageDelete");

// Nep-waarde, alleen om "fout geheim" te beproeven.
const WRONG_SECRET = "wp26-integratie-fout-geheim-0000000000000000";
const VALIDATION_ERROR = /ArgumentValidationError|Validator error|extra field|missing the required field/i;

// Convex zet per aanroep een eigen `[Request ID: …]` in de foutmelding. Dat
// id zegt niets over de oorzaak; de rest van de melding moet gelijk zijn.
const REQUEST_ID = /\[Request ID: [^\]]*\]/g;

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return message.replace(REQUEST_ID, "[Request ID: …]");
  }
  throw new Error("verwacht: geweigerd; kreeg: een antwoord");
}

describe("WP26 — _test-functies op dev achter het geheim", () => {
  beforeAll(() => {
    assertNotProd(process.env.CONVEX_URL ?? "");
  });

  it("zonder en met een fout geheim: geweigerd, hetzelfde antwoord; met het geheim: werkt", async () => {
    const withSecret = makeTestFunctionsClient();
    const plain = makeConvexClient();
    const { storageId } = await withSecret.action(FN_UPLOAD, {
      bytes: new Uint8Array(randomBytes(32)).buffer,
    });
    try {
      const missing = await refusal(plain.query(FN_DOWNLOAD_URL, { storageId }));
      const wrong = await refusal(
        plain.query(FN_DOWNLOAD_URL, { storageId, testSecret: WRONG_SECRET }),
      );
      expect(missing).not.toMatch(VALIDATION_ERROR);
      expect(wrong).toBe(missing);
      expect(wrong).not.toContain(WRONG_SECRET);
      console.info("[WP26] weigering op dev:", missing);

      expect(typeof (await withSecret.query(FN_DOWNLOAD_URL, { storageId }))).toBe("string");
    } finally {
      await withSecret.mutation(FN_DELETE, { storageId });
    }
  });
});
