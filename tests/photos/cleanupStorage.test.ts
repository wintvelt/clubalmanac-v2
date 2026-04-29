import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Cascade matrix row U7 (action zelf): cleanupStorage als losse internal action.
// Mutation-side koppeling staat in tests/users/delete.test.ts.

describe("photos.cleanupStorage action", () => {
  it("verwijdert alle gegeven storage IDs", async () => {
    const t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      const a = await ctx.storage.store(new Blob(["a"]));
      const b = await ctx.storage.store(new Blob(["b"]));
      return [a, b];
    });

    await t.action(internal.photos.cleanupStorage, { storageIds: ids });

    for (const id of ids) {
      const url = await t.run((ctx) => ctx.storage.getUrl(id));
      expect(url).toBeNull();
    }
  });

  it("is idempotent — geen error op niet-bestaande storage IDs", async () => {
    const t = convexTest(schema);
    const id = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"])),
    );
    await t.action(internal.photos.cleanupStorage, { storageIds: [id] });

    // Tweede aanroep mag niet falen ondanks dat storage al weg is
    await expect(
      t.action(internal.photos.cleanupStorage, { storageIds: [id] }),
    ).resolves.not.toThrow();
  });

  it("lege array doet niets", async () => {
    const t = convexTest(schema);
    await expect(
      t.action(internal.photos.cleanupStorage, { storageIds: [] }),
    ).resolves.not.toThrow();
  });
});
