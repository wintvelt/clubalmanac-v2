import { config } from "dotenv";

// Laadt `.env.integration` (gitignored) naar process.env voor alle
// integration-tests. Geregistreerd via `setupFiles` in
// vitest.integration.config.ts.
//
// `.env.integration` is optioneel: WP1 (Photon) heeft geen env-vars nodig,
// dus dotenv gaat stilletjes door als de file ontbreekt. Tests die env-vars
// wél nodig hebben (WP2+) checken zelf op aanwezigheid en throwen met
// duidelijke melding (zie convexClient.ts).
config({ path: ".env.integration" });
