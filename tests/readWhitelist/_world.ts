import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect } from "vitest";
import schema from "../../convex/schema";
import type { Id, TableNames } from "../../convex/_generated/dataModel";
import { modules } from "../_helpers/modules";

// WP23 — gedeelde seed-wereld + helpers voor de read-whitelist-tests.
//
// Elke rij heeft álle optionele velden gevuld die de vorm toestaat, zodat
// "precies deze velden" deterministisch te vergelijken is (set van keys met
// een gedefinieerde waarde). Velden die buiten een vorm vallen (email,
// subject, GPS, filename, flag-velden, token, bouncedAt, …) zijn óók gevuld:
// anders bewijst hun afwezigheid in een response niets.
//
// Vormen = spec docs/work-packages/WP23-read-whitelist.md §Vormen.

export const ISSUER = "https://picked-quail-97.clerk.accounts.dev";
export const WEBMASTER_EMAIL = "wm@x.com";
const DAY = 24 * 60 * 60 * 1000;

export type T = ReturnType<typeof convexTest>;
// Responses worden losjes getypeerd: de tests pinnen de vorm zelf, niet het
// TypeScript-type dat B kiest.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type R = Record<string, any>;

export const SHAPE = {
  publicProfile: ["_id", "name", "profilePhotoStorageId"],
  ownProfile: [
    "_id",
    "email",
    "name",
    "profilePhotoStorageId",
    "photoCount",
    "createdAt",
    "lastVisitAt",
  ],
  group: ["_id", "name", "description", "coverPhotoId", "createdBy", "createdAt"],
  membership: ["_id", "userId", "groupId", "role", "joinedAt"],
  album: [
    "_id",
    "groupId",
    "name",
    "description",
    "coverPhotoId",
    "createdBy",
    "createdAt",
  ],
  albumPhoto: ["_id", "albumId", "photoId", "groupId", "addedAt", "addedBy"],
  photo: [
    "_id",
    "ownerId",
    "storageId",
    "width",
    "height",
    "takenAt",
    "locationLabel",
    "exifOrientation",
    "ratingAverage",
    "ratingCount",
    "createdAt",
  ],
  ownFlag: [
    "flaggedAt",
    "flaggedDeleteDate",
    "flaggedAppealDate",
    "flaggedAppealDenyDate",
  ],
  allFlag: [
    "flaggedAt",
    "flaggedDeleteDate",
    "flaggedAppealDate",
    "flaggedAppealDenyDate",
    "flaggedBy",
    "flagReason",
  ],
  rating: ["photoId", "value"],
  feature: [
    "_id",
    "type",
    "title",
    "description",
    "status",
    "upvoteCount",
    "createdAt",
  ],
  inviteSender: [
    "_id",
    "email",
    "groupId",
    "role",
    "status",
    "expiresAt",
    "createdAt",
  ],
  // A-keuze 6 herzien (Wouter, 47b65bc): email van de genodigde wél.
  inviteLanding: ["status", "isExpired", "role", "email", "group", "inviter"],
  landingGroup: ["_id", "name", "description"],
  landingInviter: ["name", "profilePhotoStorageId"],
} as const;

/** Keys met een gedefinieerde waarde, gesorteerd. `null` telt als gedefinieerd. */
export function keysOf(x: unknown): string[] {
  expect(x, "verwacht een object, kreeg null/undefined").toBeTruthy();
  return Object.entries(x as R)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k)
    .sort();
}

export function expectShape(x: unknown, keys: readonly string[]): void {
  expect(keysOf(x)).toEqual([...keys].sort());
}

type Outcome = { ok: unknown } | { err: string };

export async function outcome(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { ok: await run() };
  } catch (e) {
    return { err: e instanceof Error ? e.message : String(e) };
  }
}

/** Geen data: een throw, `null` of een lege lijst. */
export function expectNoData(o: Outcome): void {
  if ("err" in o) return;
  const v = o.ok;
  const empty = v === null || (Array.isArray(v) && v.length === 0);
  expect(empty, `verwacht geen data, kreeg ${JSON.stringify(v)}`).toBe(true);
}

/**
 * Invariant 4: "bestaat niet" en "bestaat, geen toegang" zijn voor dezelfde
 * caller niet te onderscheiden. Beide geven geen data én een identieke
 * uitkomst (zelfde error-tekst, of allebei dezelfde lege waarde).
 */
export async function expectNoOracle(
  missing: () => Promise<unknown>,
  noAccess: () => Promise<unknown>,
): Promise<void> {
  const a = await outcome(missing);
  const b = await outcome(noAccess);
  expectNoData(b);
  expect(a).toEqual(b);
}

export function as(t: T, subject: string, email?: string) {
  return t.withIdentity({
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    ...(email !== undefined ? { email } : {}),
  });
}

/** Zet WEBMASTER_EMAILS voor de duur van elke test in het bestand. */
export function useWebmasterEnv(): void {
  beforeEach(() => {
    process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
  });
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });
}

type UserKey = "alice" | "bob" | "carol" | "dave" | "wm";

export type World = Awaited<ReturnType<typeof seedWorld>>;

/**
 * Wereld:
 *   G1 "Club"   — alice (admin, oprichter), bob (member). Album A1 met pBob
 *                 (gemeld door alice, beroep afgewezen) en pAlice.
 *   G2 "Ander"  — carol (admin). Album A2 met pCarol.
 *   G3 "Derde"  — alice (admin), dave (member). Album A3 met pAlice.
 *   pBobPrivate — bob, in geen enkel album.
 *   wm          — webmaster, geen lidmaatschappen.
 */
export async function seedWorld(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const storage = async () => await ctx.storage.store(new Blob(["x"]));

    const mkUser = async (key: UserKey, name: string) => {
      const subject = `user_${key}`;
      const email = key === "wm" ? WEBMASTER_EMAIL : `${key}@x.com`;
      const id = await ctx.db.insert("users", {
        subject,
        email,
        name,
        profilePhotoStorageId: await storage(),
        photoCount: 3,
        photoLimit: 1000,
        lastVisitAt: now - DAY,
        createdAt: now - 100 * DAY,
      });
      return { id, subject, email, name };
    };

    const users = {
      alice: await mkUser("alice", "Alice"),
      bob: await mkUser("bob", "Bob"),
      carol: await mkUser("carol", "Carol"),
      dave: await mkUser("dave", "Dave"),
      wm: await mkUser("wm", "Webmaster"),
    };

    const basePhoto = async (ownerId: Id<"users">, label: string) => ({
      ownerId,
      storageId: await storage(),
      filename: `IMG_${label}_van_${label}.jpg`,
      mimeType: "image/jpeg",
      width: 4032,
      height: 3024,
      takenAt: now - 10 * DAY,
      latitude: 52.3731,
      longitude: 4.8922,
      locationLabel: "Amsterdam",
      exifOrientation: 6,
      ratingAverage: 3,
      ratingCount: 2,
      createdAt: now - 9 * DAY,
    });

    const FLAG_REASON = "ik sta er niet goed op";
    const pBob = await ctx.db.insert("photos", {
      ...(await basePhoto(users.bob.id, "bob")),
      flaggedAt: now - 5 * DAY,
      flaggedBy: users.alice.id,
      flagReason: FLAG_REASON,
      flaggedAppealDate: now - 4 * DAY,
      flaggedAppealDenyDate: now - 3 * DAY,
      flaggedDeleteDate: now + 4 * DAY,
    });
    const pAlice = await ctx.db.insert(
      "photos",
      await basePhoto(users.alice.id, "alice"),
    );
    const pBobPrivate = await ctx.db.insert(
      "photos",
      await basePhoto(users.bob.id, "bobprivate"),
    );
    const pCarol = await ctx.db.insert(
      "photos",
      await basePhoto(users.carol.id, "carol"),
    );

    const mkGroup = async (
      name: string,
      createdBy: Id<"users">,
      coverPhotoId: Id<"photos">,
    ) =>
      await ctx.db.insert("groups", {
        name,
        description: `Omschrijving ${name}`,
        coverPhotoId,
        createdBy,
        createdAt: now - 50 * DAY,
      });
    const G1 = await mkGroup("Club", users.alice.id, pBob);
    const G2 = await mkGroup("Ander", users.carol.id, pCarol);
    const G3 = await mkGroup("Derde", users.alice.id, pAlice);

    const member = async (
      userId: Id<"users">,
      groupId: Id<"groups">,
      role: "admin" | "member",
    ) =>
      await ctx.db.insert("memberships", {
        userId,
        groupId,
        role,
        joinedAt: now - 40 * DAY,
      });
    await member(users.alice.id, G1, "admin");
    await member(users.bob.id, G1, "member");
    await member(users.carol.id, G2, "admin");
    await member(users.alice.id, G3, "admin");
    await member(users.dave.id, G3, "member");

    const mkAlbum = async (
      groupId: Id<"groups">,
      name: string,
      createdBy: Id<"users">,
      coverPhotoId: Id<"photos">,
    ) =>
      await ctx.db.insert("albums", {
        groupId,
        name,
        description: `Album ${name}`,
        coverPhotoId,
        createdBy,
        createdAt: now - 30 * DAY,
      });
    const A1 = await mkAlbum(G1, "A1", users.alice.id, pBob);
    const A2 = await mkAlbum(G2, "A2", users.carol.id, pCarol);
    const A3 = await mkAlbum(G3, "A3", users.alice.id, pAlice);

    const publish = async (
      albumId: Id<"albums">,
      groupId: Id<"groups">,
      photoId: Id<"photos">,
      addedBy: Id<"users">,
    ) =>
      await ctx.db.insert("albumPhotos", {
        albumId,
        photoId,
        groupId,
        addedBy,
        addedAt: now - 8 * DAY,
      });
    await publish(A1, G1, pBob, users.bob.id);
    await publish(A1, G1, pAlice, users.alice.id);
    await publish(A2, G2, pCarol, users.carol.id);
    await publish(A3, G3, pAlice, users.alice.id);

    const rate = async (
      photoId: Id<"photos">,
      userId: Id<"users">,
      value: number,
    ) =>
      await ctx.db.insert("ratings", {
        photoId,
        userId,
        value,
        createdAt: now - 2 * DAY,
        updatedAt: now - DAY,
      });
    await rate(pBob, users.alice.id, 4);
    await rate(pBob, users.bob.id, 2);
    await rate(pAlice, users.bob.id, 5);

    const tokens = {
      g1: "tok-g1-secret-0001",
      bounced: "tok-bounced-secret-0002",
      general: "tok-general-secret-0003",
      carol: "tok-carol-secret-0004",
    };
    const invG1 = await ctx.db.insert("invites", {
      email: "new@x.com",
      invitedBy: users.alice.id,
      groupId: G1,
      role: "member",
      token: tokens.g1,
      status: "pending",
      expiresAt: now + 10 * DAY,
      createdAt: now - DAY,
    });
    const invBounced = await ctx.db.insert("invites", {
      email: "bounce@x.com",
      invitedBy: users.alice.id,
      groupId: G1,
      role: "admin",
      token: tokens.bounced,
      status: "expired",
      expiresAt: now - DAY,
      createdAt: now - 20 * DAY,
      respondedAt: now - 2 * DAY,
      bouncedAt: now - 2 * DAY,
    });
    const invGeneral = await ctx.db.insert("invites", {
      email: "gen@x.com",
      invitedBy: users.alice.id,
      token: tokens.general,
      status: "pending",
      expiresAt: now + 10 * DAY,
      createdAt: now - DAY,
    });
    const invCarol = await ctx.db.insert("invites", {
      email: "other@x.com",
      invitedBy: users.carol.id,
      groupId: G2,
      role: "member",
      token: tokens.carol,
      status: "pending",
      expiresAt: now + 10 * DAY,
      createdAt: now - DAY,
    });

    const mkFeature = async (
      type: "feature" | "problem",
      title: string,
      submittedBy: Id<"users">,
    ) =>
      await ctx.db.insert("features", {
        type,
        title,
        description: `Beschrijving ${title}`,
        submittedBy,
        status: "open",
        upvoteCount: 1,
        createdAt: now - DAY,
      });
    const fFeature = await mkFeature("feature", "Donkere modus", users.bob.id);
    const fBobProblem = await mkFeature("problem", "Bob crasht", users.bob.id);
    const fCarolProblem = await mkFeature(
      "problem",
      "Carol crasht",
      users.carol.id,
    );

    return {
      users,
      photos: { pBob, pAlice, pBobPrivate, pCarol },
      groups: { G1, G2, G3 },
      albums: { A1, A2, A3 },
      invites: { invG1, invBounced, invGeneral, invCarol },
      tokens,
      features: { fFeature, fBobProblem, fCarolProblem },
      flagReason: FLAG_REASON,
    };
  });
}

/** Ingelogde client voor een wereld-user (met email-claim, nodig voor de webmaster). */
export function asUser(t: T, w: World, key: UserKey) {
  const u = w.users[key];
  return as(t, u.subject, u.email);
}

/** Identity zonder users-rij. */
export function asGhost(t: T) {
  return as(t, "user_ghost", "ghost@x.com");
}

/**
 * Een geldig-gevormd id dat niet (meer) bestaat: insert + delete in dezelfde
 * tabel. Voor de orakel-vergelijking.
 */
export async function staleId<TN extends TableNames>(
  t: T,
  w: World,
  table: TN,
): Promise<Id<TN>> {
  return (await t.run(async (ctx) => {
    const now = Date.now();
    let id: Id<TableNames>;
    switch (table) {
      case "users":
        id = await ctx.db.insert("users", {
          subject: "user_stale",
          email: "stale@x.com",
          photoCount: 0,
          photoLimit: 1000,
          createdAt: now,
        });
        break;
      case "groups":
        id = await ctx.db.insert("groups", {
          name: "Weg",
          createdBy: w.users.alice.id,
          createdAt: now,
        });
        break;
      case "albums":
        id = await ctx.db.insert("albums", {
          groupId: w.groups.G1,
          name: "Weg",
          createdBy: w.users.alice.id,
          createdAt: now,
        });
        break;
      case "photos":
        id = await ctx.db.insert("photos", {
          ownerId: w.users.bob.id,
          storageId: await ctx.storage.store(new Blob(["x"])),
          ratingCount: 0,
          createdAt: now,
        });
        break;
      case "features":
        id = await ctx.db.insert("features", {
          type: "problem",
          title: "Weg",
          description: "Weg",
          submittedBy: w.users.carol.id,
          status: "open",
          upvoteCount: 0,
          createdAt: now,
        });
        break;
      default:
        throw new Error(`staleId: tabel ${table} niet ondersteund`);
    }
    await ctx.db.delete(id);
    return id;
  })) as Id<TN>;
}

/**
 * Diepe scan: de geserialiseerde response bevat geen email en geen
 * Clerk-subject van enige wereld-user. `allowEmail` = de eigen email in het
 * eigen profiel.
 */
export function expectNoUserSecrets(
  value: unknown,
  w: World,
  opts: { allowEmail?: string } = {},
): void {
  const json = JSON.stringify(value);
  for (const u of Object.values(w.users)) {
    expect(json, `subject van ${u.name} in response`).not.toContain(u.subject);
    if (u.email !== opts.allowEmail) {
      expect(json, `email van ${u.name} in response`).not.toContain(u.email);
    }
  }
}

export function newT(): T {
  return convexTest(schema, modules);
}
