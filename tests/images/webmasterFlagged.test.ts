import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, asUser, newT, seedWorld, useWebmasterEnv, WEBMASTER_EMAIL, type T } from "../readWhitelist/_world";

// WP20 A-invariant 9 (kernvondst 2): de webmaster ziet het beeld van een
// gemelde foto, ook zonder lidmaatschap, zolang de foto gemeld is
// (`flaggedAt` gezet). Anders kan hij in de wachtrij niet beslissen.
// Alleen het beeldpad; geen andere read krijgt een webmaster-uitzondering.
// Wereld (readWhitelist/_world): wm heeft geen lidmaatschap. pBob is gemeld
// (bezwaar afgewezen) en staat in A1 (G1). pAlice en pCarol zijn niet gemeld.
// Spec: docs/work-packages/WP20-melden.md §A-invarianten.

useWebmasterEnv();

const photoImage = makeFunctionReference<"query", { photoId: string }, Id<"_storage"> | null>(
  "images:photoImage",
);
const photoImageInFormat = makeFunctionReference<
  "query",
  { photoId: string; formaat: "klein" | "groot" },
  { storageId: Id<"_storage">; fallback: boolean } | null
>("images:photoImageInFormat");

async function withFormats(t: T, photoId: Id<"photos">) {
  return await t.run(async (ctx) => {
    const klein = await ctx.storage.store(new Blob(["klein"]));
    const groot = await ctx.storage.store(new Blob(["groot"]));
    await ctx.db.patch(photoId, { formats: { klein, groot } });
    return { klein, groot };
  });
}

async function storageOf(t: T, photoId: Id<"photos">) {
  return (await t.run((ctx) => ctx.db.get(photoId)))!.storageId;
}

describe("beeldpad — de webmaster en een gemelde foto", () => {
  it("gemelde foto, webmaster zonder lidmaatschap: origineel en klein", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const f = await withFormats(t, w.photos.pBob);
    const wm = asUser(t, w, "wm");
    expect(await wm.query(photoImage, { photoId: w.photos.pBob })).toBe(await storageOf(t, w.photos.pBob));
    expect(await wm.query(photoImageInFormat, { photoId: w.photos.pBob, formaat: "klein" })).toEqual({
      storageId: f.klein,
      fallback: false,
    });
  });

  it("gemeld zonder bezwaar en gemeld met bezwaar: ook", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.patch(w.photos.pCarol, { flaggedAt: now, flaggedDeleteDate: now + 14 * 86_400_000 });
      await ctx.db.patch(w.photos.pBobPrivate, { flaggedAt: now, flaggedAppealDate: now });
    });
    const wm = asUser(t, w, "wm");
    expect(await wm.query(photoImage, { photoId: w.photos.pCarol })).toBe(await storageOf(t, w.photos.pCarol));
    expect(await wm.query(photoImage, { photoId: w.photos.pBobPrivate })).toBe(
      await storageOf(t, w.photos.pBobPrivate),
    );
  });

  it("niet gemelde foto: de webmaster krijgt niets (geen algemene bypass)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await withFormats(t, w.photos.pCarol);
    const wm = asUser(t, w, "wm");
    expect(await wm.query(photoImage, { photoId: w.photos.pCarol })).toBeNull();
    expect(await wm.query(photoImageInFormat, { photoId: w.photos.pCarol, formaat: "klein" })).toBeNull();
  });

  it("na goedkeuren (velden gewist): niet meer", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const wm = asUser(t, w, "wm");
    // pBob heeft een bezwaar (afgewezen); goedkeuren overrulet en wist alles (FL2).
    await wm.mutation(api.photos.decideFlag, { photoId: w.photos.pBob, approve: true });
    expect(await wm.query(photoImage, { photoId: w.photos.pBob })).toBeNull();
  });

  it("een niet-webmaster zonder toegang krijgt een gemelde foto niet", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // carol en dave zitten niet in G1.
    for (const key of ["carol", "dave"] as const) {
      expect(await asUser(t, w, key).query(photoImage, { photoId: w.photos.pBob })).toBeNull();
    }
  });

  it("het webmaster-adres zonder users-rij: niets", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expect(await as(t, "user_wm_ghost", WEBMASTER_EMAIL).query(photoImage, { photoId: w.photos.pBob })).toBeNull();
  });

  it("controle: geen webmaster-uitzondering in een gewone read (photos.getById)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expect(asUser(t, w, "wm").query(api.photos.getById, { photoId: w.photos.pBob })).rejects.toThrow();
  });
});
