// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../convex/schema";
import { modules } from "../_helpers/modules";
import { I, storageCount } from "./_helpers";

// WP25 fix-cyclus 1 — de controle van de beeldbibliotheek (A-invariant 24,
// kernvondst 11).
//
// Op T-2 draait `formaten --target prod` tegen een lege prod: de key-controle.
// Zonder foto's laadt die nooit sharp of heic-decode. `selfTest` draait
// `makeFormatImages` daarom op een ingebouwde JPEG en HEIC, en schrijft niets.
// Hier met de echte bibliotheek, in Node.

describe("photoFormats.selfTest", () => {
  it("maakt formaten van de ingebouwde JPEG en HEIC en geeft hun maten terug", async () => {
    const t = convexTest(schema, modules);

    const r = (await t.action(I.photoFormats.selfTest, {})) as {
      jpeg: { width: number; height: number };
      heic: { width: number; height: number };
    };

    for (const kind of ["jpeg", "heic"] as const) {
      expect(Number.isInteger(r[kind].width) && r[kind].width > 0, kind).toBe(true);
      expect(Number.isInteger(r[kind].height) && r[kind].height > 0, kind).toBe(true);
    }
  });

  it("schrijft niets: geen storage-object en geen rij", async () => {
    const t = convexTest(schema, modules);

    await t.action(I.photoFormats.selfTest, {});

    expect(await storageCount(t)).toBe(0);
    const rows = await t.run(async (ctx) => [
      ...(await ctx.db.query("photos").collect()),
      ...(await ctx.db.query("users").collect()),
    ]);
    expect(rows).toEqual([]);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toEqual([]);
  });
});
