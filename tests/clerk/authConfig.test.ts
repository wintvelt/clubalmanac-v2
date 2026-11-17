// Rooktest prod 2026-11-17: auth.config.ts had het dev-adres van Clerk vast in
// de code, waardoor prod elke prod-sessie weigerde. Het adres komt per
// deployment uit CLERK_FRONTEND_API_URL.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("convex/auth.config.ts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("neemt de Clerk-issuer uit CLERK_FRONTEND_API_URL", async () => {
    vi.stubEnv("CLERK_FRONTEND_API_URL", "https://clerk.example.test");
    const { default: config } = await import("../../convex/auth.config");
    expect(config.providers).toEqual([
      { domain: "https://clerk.example.test", applicationID: "convex" },
    ]);
  });

  it("bevat geen vast Clerk-adres", () => {
    const source = readFileSync(new URL("../../convex/auth.config.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/https:\/\/[a-z0-9.-]*clerk/i);
  });
});
