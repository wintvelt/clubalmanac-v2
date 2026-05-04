import { ConvexHttpClient } from "convex/browser";
import { assertNotProd } from "./safety";

// Geconfigureerde ConvexHttpClient voor integration-tests.
//
// Leest `CONVEX_URL` uit de environment (geladen door
// `tests/integration/_helpers/setup.ts` uit `.env.integration` via dotenv).
// Throwt early als de var ontbreekt of naar productie wijst.
//
// Hergebruikbaar voor toekomstige Convex-integration-werkpakketten.

export function makeConvexClient(): ConvexHttpClient {
  const url = process.env.CONVEX_URL;
  if (!url || url.length === 0) {
    throw new Error(
      "CONVEX_URL ontbreekt. Zet 'm in .env.integration (zie .env.integration.example).",
    );
  }
  assertNotProd(url);
  return new ConvexHttpClient(url);
}
