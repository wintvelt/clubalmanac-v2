import { createHash, randomBytes } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { beforeAll, describe, expect, it } from "vitest";
import { makeConvexClient } from "../_helpers/convexClient";
import { assertNotProd } from "../_helpers/safety";

// ---------------------------------------------------------------------------
// Convex storage — live roundtrip integration tests (WP2)
//
// Productie-blind-spot: bytes geschreven via `ctx.storage.store` moeten
// identiek terugkomen via `ctx.storage.getUrl` + fetch. Onze unit-suite
// gebruikt `convex-test`, een in-memory mock — die kan divergeren van
// échte Convex storage SDK-gedrag (encoding, content-type roundtrip,
// signed-URL TTL, etc.). Deze suite pint dat contract.
//
// Architectuur (zie docs/migratie-plan-convex.md WP2-sectie + B-spec):
//   - Test-only Convex functions in `convex/_test.ts` (door B geschreven):
//       - `storageUpload` (action)       : bytes → storageId
//       - `storageDownloadUrl` (query)   : storageId → signed URL | null
//       - `storageDelete` (mutation)     : cleanup hygiene voor tests
//   - Elke functie env-var-gated op `INTEGRATION_TEST_ENABLED === "true"`.
//     Wouter zet de var alleen op de dev-deployment via Convex dashboard.
//   - Geen Clerk-auth: storage-roundtrip is auth-vrij ontkoppeld van
//     de productie-`/upload` httpAction (die wacht op WP3 Clerk).
//
// Niet in CI. `npm run test:integration` lokaal.
// ---------------------------------------------------------------------------

function sha256Hex(buf: ArrayBuffer | Uint8Array): string {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return createHash("sha256").update(view).digest("hex");
}

// Untyped function-references — `convex/_test.ts` bestaat nog niet (B's
// werk), dus codegen heeft geen type-info. `makeFunctionReference` levert
// een correct getypeerde FunctionReference op basis van een "module:fn"
// string en is bedoeld voor exact deze "no codegen yet"-use-case.
const FN_UPLOAD = makeFunctionReference<
  "action",
  { bytes: ArrayBuffer },
  { storageId: string }
>("_test:storageUpload");
const FN_DOWNLOAD_URL = makeFunctionReference<
  "query",
  { storageId: string },
  string | null
>("_test:storageDownloadUrl");
const FN_DELETE = makeFunctionReference<
  "mutation",
  { storageId: string },
  null
>("_test:storageDelete");

describe("Convex storage — live roundtrip", () => {
  beforeAll(() => {
    // Tweede laag op de safety: client-helper ook checkt prod, maar
    // expliciet één assertion per test-suite is goedkoop en duidelijk.
    const url = process.env.CONVEX_URL ?? "";
    assertNotProd(url);
  });

  it("random 2 KB blob met 0x00 bytes → roundtrip pin't byte-identiteit", async () => {
    const client = makeConvexClient();

    // 2 KB random + expliciet 0x00 byte op vaste positie. Pin't dat
    // null-bytes niet gestript worden in encoding (base64 ↔ binary,
    // signed-URL fetch).
    const payload = new Uint8Array(randomBytes(2048));
    payload[0] = 0x00;
    payload[1024] = 0x00;
    payload[payload.length - 1] = 0x00;
    const inputHash = sha256Hex(payload);

    // Action accepteert v.bytes() (ArrayBuffer over de wire).
    const uploadResult = await client.action(FN_UPLOAD, {
      bytes: payload.buffer,
    });

    expect(typeof uploadResult.storageId).toBe("string");
    expect(uploadResult.storageId.length).toBeGreaterThan(0);

    const downloadUrl = await client.query(FN_DOWNLOAD_URL, {
      storageId: uploadResult.storageId,
    });

    expect(typeof downloadUrl).toBe("string");
    expect(downloadUrl).not.toBeNull();

    const fetched = await fetch(downloadUrl as string);
    expect(fetched.status).toBe(200);
    const downloaded = new Uint8Array(await fetched.arrayBuffer());

    expect(downloaded.length).toBe(payload.length);
    expect(sha256Hex(downloaded)).toBe(inputHash);

    // Cleanup. Best-effort: failure hier mag de assertion niet maskeren,
    // dus geen await-throw escalatie.
    try {
      await client.mutation(FN_DELETE, {
        storageId: uploadResult.storageId,
      });
    } catch {
      // best-effort
    }
  });

  it("leeg blob (0 bytes) → roundtrip levert eveneens leeg blob terug", async () => {
    const client = makeConvexClient();

    const empty = new Uint8Array(0);
    const inputHash = sha256Hex(empty);

    const uploadResult = await client.action(FN_UPLOAD, {
      bytes: empty.buffer,
    });

    expect(typeof uploadResult.storageId).toBe("string");

    const downloadUrl = await client.query(FN_DOWNLOAD_URL, {
      storageId: uploadResult.storageId,
    });

    expect(typeof downloadUrl).toBe("string");

    const fetched = await fetch(downloadUrl as string);
    expect(fetched.status).toBe(200);
    const downloaded = new Uint8Array(await fetched.arrayBuffer());

    expect(downloaded.length).toBe(0);
    expect(sha256Hex(downloaded)).toBe(inputHash);

    try {
      await client.mutation(FN_DELETE, {
        storageId: uploadResult.storageId,
      });
    } catch {
      // best-effort
    }
  });
});
