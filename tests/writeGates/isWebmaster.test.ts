import { describe, expect, it } from "vitest";
import { isWebmaster } from "../../convex/lib/auth";
import { as, newT, useWebmasterEnv, WEBMASTER_EMAIL } from "../readWhitelist/_world";

// WP24 invariant 5: isWebmaster dwingt de users-rij zelf af. Een identity met
// een webmaster-email maar zonder users-rij is geen webmaster, ook als de
// aanroeper dat niet vooraf checkt.

useWebmasterEnv();

async function seedUser(t: ReturnType<typeof newT>, subject: string, email: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      subject,
      email,
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    });
  });
}

describe("isWebmaster", () => {
  it("webmaster-email zonder users-rij: false", async () => {
    const t = newT();
    const result = await as(t, "user_wm_ghost", WEBMASTER_EMAIL).run(async (ctx) =>
      isWebmaster(ctx),
    );
    expect(result).toBe(false);
  });

  it("controle: webmaster-email mét users-rij: true", async () => {
    const t = newT();
    await seedUser(t, "user_wm", WEBMASTER_EMAIL);
    const result = await as(t, "user_wm", WEBMASTER_EMAIL).run(async (ctx) =>
      isWebmaster(ctx),
    );
    expect(result).toBe(true);
  });

  it("controle: gewone email mét users-rij: false", async () => {
    const t = newT();
    await seedUser(t, "user_x", "x@x.com");
    const result = await as(t, "user_x", "x@x.com").run(async (ctx) => isWebmaster(ctx));
    expect(result).toBe(false);
  });

  it("controle: geen identity: false", async () => {
    const t = newT();
    const result = await t.run(async (ctx) => isWebmaster(ctx));
    expect(result).toBe(false);
  });
});
