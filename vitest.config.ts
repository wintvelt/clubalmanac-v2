import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // convex-test draait Convex functions in een edge-runtime VM.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["tests/**/*.test.ts"],
    // Integration tests draaien tegen echte externe services. Aparte config
    // (vitest.integration.config.ts) + script (`npm run test:integration`).
    // Hier excluderen zodat `npm test` ze nooit per ongeluk meepakt.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/integration/**"],
  },
});
