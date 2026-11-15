import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { asUser, newT, seedWorld, useWebmasterEnv } from "../readWhitelist/_world";

// WP20 A-invariant 7: de reden bij melden is begrensd (hoogstens 500 tekens),
// anders ConvexError `REASON_TOO_LONG` en geen melding. Een lege reden na
// trimmen wordt niet bewaard. De app vraagt geen reden (A-keuze 1); de grens
// is voor de publieke API, want de webmaster leest de reden.
// Wereld: pAlice staat in A1 (G1) en A3; bob (G1) mag hem melden.
// Spec: docs/work-packages/WP20-melden.md §A-invarianten.

useWebmasterEnv();

describe("photos.flag — reden", () => {
  it("501 tekens: REASON_TOO_LONG, foto niet gemeld", async () => {
    const t = newT();
    const w = await seedWorld(t);
    let code: unknown;
    try {
      await asUser(t, w, "bob").mutation(api.photos.flag, { photoId: w.photos.pAlice, reason: "r".repeat(501) });
    } catch (e) {
      code = e instanceof ConvexError ? (e.data as { code?: unknown }).code : String(e);
    }
    expect(code).toBe("REASON_TOO_LONG");
    expect((await t.run((ctx) => ctx.db.get(w.photos.pAlice)))?.flaggedAt).toBeUndefined();
  });

  it("500 tekens mag en wordt getrimd bewaard", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const reason = "r".repeat(500);
    await asUser(t, w, "bob").mutation(api.photos.flag, { photoId: w.photos.pAlice, reason: `  ${reason}  ` });
    expect((await t.run((ctx) => ctx.db.get(w.photos.pAlice)))?.flagReason).toBe(reason);
  });

  it("lege reden na trimmen: gemeld, zonder reden", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "bob").mutation(api.photos.flag, { photoId: w.photos.pAlice, reason: "   " });
    const p = await t.run((ctx) => ctx.db.get(w.photos.pAlice));
    expect(p?.flaggedAt).toBeTypeOf("number");
    expect(p?.flagReason).toBeUndefined();
  });

  it("zonder reden (zoals de app): gemeld", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "bob").mutation(api.photos.flag, { photoId: w.photos.pAlice });
    expect((await t.run((ctx) => ctx.db.get(w.photos.pAlice)))?.flaggedAt).toBeTypeOf("number");
  });
});
