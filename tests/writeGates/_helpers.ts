import { expect } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { as, outcome, type T } from "../readWhitelist/_world";

// WP24 — gedeelde helpers voor de write-gate-tests. De seed-wereld komt uit
// tests/readWhitelist/_world.ts (WP23):
//   G1 — alice (admin), bob (member). A1: pBob (gemeld door alice), pAlice.
//   G2 — carol (admin). A2: pCarol.
//   G3 — alice (admin), dave (member). A3: pAlice.
//   pBobPrivate — van bob, in geen album.
//   wm — webmaster, geen lidmaatschappen.
// Spec: docs/work-packages/WP24-write-gates.md.

/** Tabellen die een write-gate kan raken. */
const TABLES = [
  "albumPhotos",
  "albums",
  "groups",
  "photos",
  "ratings",
  "features",
  "featureUpvotes",
  "albumLastSeen",
  "memberships",
  "users",
] as const;

/**
 * Volledige snapshot van alle tabellen die een write-gate kan raken.
 * "State ongewijzigd" = snapshot na de call is diep-gelijk aan die ervoor.
 */
export async function snapshot(t: T): Promise<Record<string, unknown[]>> {
  return await t.run(async (ctx) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES) {
      out[table] = await ctx.db.query(table).collect();
    }
    return out;
  });
}

/**
 * De mutation faalt én laat de state ongewijzigd. Een mislukte mutation in
 * Convex rolt terug, dus een geweigerde call die tóch schrijft, is een stille
 * no-op die wel slaagt — die vangt de eerste assert.
 */
export async function expectRejectedNoChange(
  t: T,
  run: () => Promise<unknown>,
  label?: string,
): Promise<void> {
  const before = await snapshot(t);
  const o = await outcome(run);
  expect("err" in o, `${label ?? "mutation"} had moeten falen, slaagde`).toBe(
    true,
  );
  expect(await snapshot(t), `${label ?? "mutation"}: state gewijzigd`).toEqual(
    before,
  );
}

/**
 * Invariant 3 (mutations): zelfde caller, onbekend id tegenover bestaand id
 * zonder toegang, geeft een identieke uitkomst. Beide laten de state
 * ongewijzigd. De test schrijft niet voor óf het een throw of een stille
 * no-op is — alleen dat de twee niet te onderscheiden zijn.
 */
export async function expectNoMutationOracle(
  t: T,
  missing: () => Promise<unknown>,
  noAccess: () => Promise<unknown>,
): Promise<void> {
  const s0 = await snapshot(t);
  const a = await outcome(missing);
  expect(await snapshot(t), "onbekend id: state gewijzigd").toEqual(s0);
  const b = await outcome(noAccess);
  expect(await snapshot(t), "bestaand id zonder toegang: state gewijzigd").toEqual(
    s0,
  );
  expect(a).toEqual(b);
}

/** Een vers account zonder groepen (de aanvaller). */
export async function newAccount(
  t: T,
  key: string,
): Promise<{ id: Id<"users">; client: ReturnType<typeof as> }> {
  const subject = `user_${key}`;
  const email = `${key}@x.com`;
  const id = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      subject,
      email,
      name: key,
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    }),
  );
  return { id, client: as(t, subject, email) };
}

/** Voeg een lidmaatschap direct toe (seed, geen auth). */
export async function addMembership(
  t: T,
  userId: Id<"users">,
  groupId: Id<"groups">,
  role: "admin" | "member" = "member",
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("memberships", {
      userId,
      groupId,
      role,
      joinedAt: Date.now(),
    });
  });
}

/** Extra album in een groep (seed). */
export async function seedAlbum(
  t: T,
  groupId: Id<"groups">,
  createdBy: Id<"users">,
  name = "Extra",
): Promise<Id<"albums">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("albums", {
      groupId,
      name,
      createdBy,
      createdAt: Date.now(),
    }),
  );
}

/** Een extra foto van `ownerId`, in geen album (seed). */
export async function seedPhoto(
  t: T,
  ownerId: Id<"users">,
): Promise<Id<"photos">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("photos", {
      ownerId,
      storageId: await ctx.storage.store(new Blob(["y"])),
      ratingCount: 0,
      createdAt: Date.now(),
    }),
  );
}

export { as, asGhost, asUser, newT, seedWorld, staleId, useWebmasterEnv } from "../readWhitelist/_world";
export type { R, T, World } from "../readWhitelist/_world";
