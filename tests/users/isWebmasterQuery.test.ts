import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { as, asGhost, asUser, newT, seedWorld, useWebmasterEnv, WEBMASTER_EMAIL } from "../readWhitelist/_world";

// WP20 A-invariant 5: de app weet of je webmaster bent via users.isWebmaster
// (een boolean). Hij gooit nooit: false zonder identity, zonder users-rij, of
// voor een account dat wordt verwijderd. Zelfde regel als isWebmaster in
// convex/lib/auth (WP24 invariant 5).
// Spec: docs/work-packages/WP20-melden.md §A-invarianten.

useWebmasterEnv();

const isWebmaster = makeFunctionReference<"query", Record<string, never>, boolean>("users:isWebmaster");

describe("users.isWebmaster", () => {
  it("de webmaster: true", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expect(await asUser(t, w, "wm").query(isWebmaster, {})).toBe(true);
  });

  it("webmaster-adres in andere hoofdletters: true (zoals requireWebmaster)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expect(await as(t, w.users.wm.subject, WEBMASTER_EMAIL.toUpperCase()).query(isWebmaster, {})).toBe(true);
  });

  it("een gewoon lid: false", async () => {
    const t = newT();
    const w = await seedWorld(t);
    for (const key of ["alice", "bob", "carol", "dave"] as const) {
      expect(await asUser(t, w, key).query(isWebmaster, {})).toBe(false);
    }
  });

  it("uitgelogd: false, geen fout", async () => {
    const t = newT();
    await seedWorld(t);
    expect(await t.query(isWebmaster, {})).toBe(false);
  });

  it("identity zonder users-rij, ook met het webmaster-adres: false", async () => {
    const t = newT();
    await seedWorld(t);
    expect(await asGhost(t).query(isWebmaster, {})).toBe(false);
    expect(await as(t, "user_wm_ghost", WEBMASTER_EMAIL).query(isWebmaster, {})).toBe(false);
  });

  it("de webmaster wiens account wordt verwijderd: false", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(w.users.wm.id, { deletion: { startedAt: Date.now() } });
    });
    const { activeUserBySubject } = await import("../../convex/lib/accountState");
    const stillActive = await t.run(async (ctx) => activeUserBySubject(ctx.db, w.users.wm.subject));
    // Controle: de opzet maakt het account echt "wordt verwijderd".
    expect(stillActive).toBeNull();
    expect(await asUser(t, w, "wm").query(isWebmaster, {})).toBe(false);
  });

  it("zonder WEBMASTER_EMAILS: false voor iedereen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    delete process.env.WEBMASTER_EMAILS;
    expect(await asUser(t, w, "wm").query(isWebmaster, {})).toBe(false);
  });
});
