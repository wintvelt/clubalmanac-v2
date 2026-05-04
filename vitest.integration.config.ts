import { defineConfig } from "vitest/config";

// Integration test config — apart van de in-memory unit suite.
//
// Doel: aannames over externe services valideren tegen de echte API
// (productie-blind-spot uit docs/conventions/external-services.md).
//
// Verschillen met vitest.config.ts:
//   - environment: "node" — echte fetch, geen edge-runtime VM. We testen
//     hier de service-contracten zelf, niet Convex action-runtime.
//   - include: alleen tests/integration/** (default suite excludeert deze
//     folder, zodat `npm test` ze nooit per ongeluk meepakt).
//   - timeouts: ruim, omdat netwerk + cold-start (Photon, httpbin, etc.)
//     enkele seconden kunnen duren.
//
// Niet aanroepen vanuit CI. Lokaal: `npm run test:integration`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/_helpers/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
