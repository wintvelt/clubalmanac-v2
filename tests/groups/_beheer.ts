import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";

// WP28 — gedeelde opzet voor de groepsbeheer-tests.
// Spec: docs/work-packages/WP28-groepsbeheer.md (§Besluiten Wouter, A-invarianten).
//
// De opzet schrijft rijen direct (t.run), niet via groups.addMember of
// albums.create: die paden zijn zelf onderwerp van WP28 (A-keuze 1, besluit 2).
// De oprichter is `groups.createdBy` (spec §Vraag 2).

export const newT = () => convexTest(schema, modules);
export type T = ReturnType<typeof newT>;
export type Role = "admin" | "member";

export const as = (t: T, subject: string) => withUser(t, subject);

export type World = {
  groupId: Id<"groups">;
  users: Record<string, Id<"users">>;
};

/**
 * Eén groep. `founder` is admin en oprichter; `members` krijgen de gegeven
 * rol. Elke naam is ook het Clerk-subject `user_<naam>` en het adres
 * `<naam>@x.test`. `outsiders` zijn users zonder lidmaatschap.
 */
export async function seedGroup(
  t: T,
  spec: { founder: string; members?: Record<string, Role>; outsiders?: string[] },
): Promise<World> {
  const users: Record<string, Id<"users">> = {};
  const names = [spec.founder, ...Object.keys(spec.members ?? {}), ...(spec.outsiders ?? [])];
  for (const name of names) {
    users[name] = await registerUser(t, `user_${name}`, `${name}@x.test`, name);
  }
  const groupId = await t.run(async (ctx) => {
    const now = Date.now();
    const gid = await ctx.db.insert("groups", {
      name: "Club",
      createdBy: users[spec.founder]!,
      createdAt: now,
    });
    await ctx.db.insert("memberships", {
      userId: users[spec.founder]!,
      groupId: gid,
      role: "admin",
      joinedAt: now,
    });
    let i = 1;
    for (const [name, role] of Object.entries(spec.members ?? {})) {
      await ctx.db.insert("memberships", {
        userId: users[name]!,
        groupId: gid,
        role,
        joinedAt: now + i++,
      });
    }
    return gid;
  });
  return { groupId, users };
}

export async function seedAlbum(
  t: T,
  groupId: Id<"groups">,
  createdBy: Id<"users">,
  name = "Album",
): Promise<Id<"albums">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("albums", { groupId, name, createdBy, createdAt: Date.now() }),
  );
}

/** Een foto van `ownerId`, met een echt (klein) beeld in storage. */
export async function seedPhoto(t: T, ownerId: Id<"users">): Promise<Id<"photos">> {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["beeld"], { type: "image/jpeg" }));
    return await ctx.db.insert("photos", {
      ownerId,
      storageId,
      createdAt: Date.now(),
    });
  });
}

/** Zet een foto in een album (publicatie), zonder gate. */
export async function publish(
  t: T,
  albumId: Id<"albums">,
  photoId: Id<"photos">,
): Promise<Id<"albumPhotos">> {
  return await t.run(async (ctx) => {
    const album = await ctx.db.get(albumId);
    const photo = await ctx.db.get(photoId);
    return await ctx.db.insert("albumPhotos", {
      albumId,
      photoId,
      groupId: album!.groupId,
      addedAt: Date.now(),
      addedBy: photo!.ownerId,
    });
  });
}

/** Een geldig groep-id van een groep die niet meer bestaat. */
export async function goneGroupId(t: T): Promise<Id<"groups">> {
  return await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", {
      subject: `user_weg_${crypto.randomUUID()}`,
      email: `weg_${crypto.randomUUID()}@x.test`,
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    });
    const id = await ctx.db.insert("groups", { name: "Weg", createdBy: owner, createdAt: Date.now() });
    await ctx.db.delete(id);
    return id;
  });
}

/** Een geldig album-id van een album dat niet meer bestaat. */
export async function goneAlbumId(t: T, groupId: Id<"groups">, by: Id<"users">): Promise<Id<"albums">> {
  const id = await seedAlbum(t, groupId, by, "Weg");
  await t.run(async (ctx) => ctx.db.delete(id));
  return id;
}

/** Een geldig user-id van een user die niet meer bestaat. */
export async function goneUserId(t: T): Promise<Id<"users">> {
  const id = await registerUser(t, `user_weg_${crypto.randomUUID()}`, `weg_${crypto.randomUUID()}@x.test`);
  await t.run(async (ctx) => ctx.db.delete(id));
  return id;
}

// --- uitkomsten -------------------------------------------------------------

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error("de aanroep had moeten falen, maar slaagde");
}

/** Alle tabellen die een beheeractie kan raken. */
const TABLES = [
  "groups",
  "memberships",
  "albums",
  "albumPhotos",
  "albumLastSeen",
  "photos",
  "invites",
  "users",
] as const;

export async function snapshot(t: T): Promise<Record<string, unknown[]>> {
  return await t.run(async (ctx) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES) out[table] = await ctx.db.query(table).collect();
    return out;
  });
}

/**
 * A-invariant 2: de mutation faalt met een `ConvexError` met deze code, en
 * de state is daarna gelijk aan ervoor. Geeft de data van de fout terug.
 */
export async function expectRefused(
  t: T,
  code: string,
  run: () => Promise<unknown>,
): Promise<unknown> {
  const before = await snapshot(t);
  const err = await caught(run);
  expect(err, `verwacht ConvexError ${code}, kreeg: ${String(err)}`).toBeInstanceOf(ConvexError);
  const data = (err as ConvexError<{ code: string }>).data;
  expect(data).toMatchObject({ code });
  expect(await snapshot(t), "state gewijzigd door een geweigerde actie").toEqual(before);
  return data;
}

/** Geweigerd (welke fout ook) en de state is ongewijzigd. */
export async function expectRejectedNoChange(t: T, run: () => Promise<unknown>): Promise<void> {
  const before = await snapshot(t);
  await caught(run);
  expect(await snapshot(t), "state gewijzigd door een geweigerde actie").toEqual(before);
}

export async function membership(t: T, groupId: Id<"groups">, userId: Id<"users">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_user_and_group", (q) => q.eq("userId", userId).eq("groupId", groupId))
      .unique(),
  );
}

export async function groupRow(t: T, groupId: Id<"groups">) {
  return await t.run(async (ctx) => ctx.db.get(groupId));
}

export async function albumRow(t: T, albumId: Id<"albums">) {
  return await t.run(async (ctx) => ctx.db.get(albumId));
}
