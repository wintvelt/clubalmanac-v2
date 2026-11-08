import { randomBytes } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { beforeAll, describe, expect, it } from "vitest";
import { makeTestFunctionsClient } from "../_helpers/testSecret";
import { assertNotProd } from "../_helpers/safety";

// ---------------------------------------------------------------------------
// WP17a vraag 1 — wat een Convex storage-URL is (meting op dev)
//
// De Convex-docs (Serving Files) zeggen: een URL van `storage.getUrl` werkt
// voor iedereen die hem heeft, zonder verdere auth; intrekken kan alleen door
// het bestand te wissen. Deze suite pint dat tegen de echte dev-deployment,
// en print wat de docs niet zeggen: of de URL per aanroep dezelfde is, en
// welke cache-headers de response draagt (relevant voor vraag 3).
//
// Hergebruikt de WP2-functies in convex/_test.ts (gegated op
// INTEGRATION_TEST_ENABLED, alleen op dev). Niet in CI.
//   npm run test:integration -- tests/integration/convex/storageUrl.test.ts
// ---------------------------------------------------------------------------

const FN_UPLOAD = makeFunctionReference<
  "action",
  { bytes: ArrayBuffer; contentType?: string },
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

const HEADERS_OF_INTEREST = [
  "cache-control",
  "etag",
  "last-modified",
  "expires",
  "content-type",
  "content-length",
  "accept-ranges",
  "access-control-allow-origin",
  "vary",
];

describe("WP17a — Convex storage-URL op dev", () => {
  beforeAll(() => {
    assertNotProd(process.env.CONVEX_URL ?? "");
  });

  it("een URL werkt zonder auth, en na wissen niet meer (docs, Serving Files)", async () => {
    const client = makeTestFunctionsClient();
    const payload = new Uint8Array(randomBytes(64 * 1024));
    const { storageId } = await client.action(FN_UPLOAD, {
      bytes: payload.buffer,
      contentType: "image/jpeg",
    });

    const url1 = await client.query(FN_DOWNLOAD_URL, { storageId });
    const url2 = await client.query(FN_DOWNLOAD_URL, { storageId });
    expect(typeof url1).toBe("string");

    // Meting, geen pin: is de URL stabiel, en bevat hij het storageId?
    console.info("[WP17a] URL-vorm:", (url1 as string).replace(storageId, "<storageId>"));
    console.info("[WP17a] zelfde URL bij twee aanroepen:", url1 === url2);
    console.info("[WP17a] URL bevat het storageId:", (url1 as string).includes(storageId));

    // Zonder enige header: geen cookie, geen token.
    const res = await fetch(url1 as string, { headers: {} });
    expect(res.status).toBe(200);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(payload.length);

    const seen: Record<string, string | null> = {};
    for (const h of HEADERS_OF_INTEREST) seen[h] = res.headers.get(h);
    console.info("[WP17a] response-headers:", JSON.stringify(seen, null, 2));

    // Een Range-verzoek (relevant voor grote beelden en voor video, WP21).
    const range = await fetch(url1 as string, { headers: { Range: "bytes=0-1023" } });
    console.info("[WP17a] Range-verzoek status:", range.status);
    await range.arrayBuffer();

    await client.mutation(FN_DELETE, { storageId });

    // Na wissen: getUrl geeft null, en de oude URL levert niets meer op.
    expect(await client.query(FN_DOWNLOAD_URL, { storageId })).toBeNull();
    const after = await fetch(url1 as string);
    console.info("[WP17a] oude URL na wissen, status:", after.status);
    expect(after.status).not.toBe(200);
    await after.arrayBuffer();
  });
});
