import { defineConfig } from "vitest/config";

// Alleen pure logica, in Node, zonder React Native.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
