import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // convex-test draait Convex functions in een edge-runtime VM.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["tests/**/*.test.ts"],
  },
});
