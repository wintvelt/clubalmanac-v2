import { ConvexError } from "convex/values";
import { expect } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { publish, seedAlbum, seedGroup, type T, type World } from "../groups/_beheer";

// WP19b — gedeelde opzet. Spec: docs/work-packages/WP19b-uitnodigen-aanmelden.md
// (§A-invarianten, §A-invarianten na besluit 2).
//
// De wereld: groep "Club" met oprichter olga (admin), anna (admin), lex (lid);
// bob en eve hebben een account zonder lidmaatschap. Elke naam is het subject
// `user_<naam>` en het adres `<naam>@x.test`.

export const DAY_MS = 24 * 60 * 60 * 1000;

export async function world(t: T): Promise<World> {
  return await seedGroup(t, {
    founder: "olga",
    members: { anna: "admin", lex: "member" },
    outsiders: ["bob", "eve"],
  });
}

export type InviteSeed = {
  email: string;
  invitedBy: Id<"users">;
  groupId?: Id<"groups">;
  role?: "admin" | "member";
  status?: "pending" | "accepted" | "declined" | "expired";
  expiresAt?: number;
  createdAt?: number;
  name?: string;
  message?: string;
};

/**
 * Een uitnodiging direct in de tabel (geen gate, geen mail). `name` en
 * `message` zijn nieuwe, optionele kolommen (A-invariant 10); de cast houdt
 * dit bestand compileerbaar zolang het schema ze nog niet kent.
 */
export async function seedInvite(t: T, s: InviteSeed): Promise<Id<"invites">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const row: Record<string, unknown> = {
      email: s.email.trim().toLowerCase(),
      invitedBy: s.invitedBy,
      token: crypto.randomUUID(),
      status: s.status ?? "pending",
      expiresAt: s.expiresAt ?? now + 14 * DAY_MS,
      createdAt: s.createdAt ?? now,
    };
    if (s.groupId !== undefined) row.groupId = s.groupId;
    if (s.role !== undefined) row.role = s.role;
    if (s.name !== undefined) row.name = s.name;
    if (s.message !== undefined) row.message = s.message;
    return await ctx.db.insert("invites", row as never);
  });
}

/** Een ander, bestaand groep-id: een tweede groep met olga als admin. */
export async function secondGroup(t: T, w: World, name = "Tweede"): Promise<Id<"groups">> {
  return await t.run(async (ctx) => {
    const gid = await ctx.db.insert("groups", {
      name,
      createdBy: w.users.olga!,
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", {
      userId: w.users.olga!,
      groupId: gid,
      role: "admin",
      joinedAt: Date.now(),
    });
    return gid;
  });
}

/**
 * De cover van de groep: een foto van olga in een album van die groep, en
 * `coverPhotoId` erop. `bytes` is het origineel; met `formats` ook *klein* en
 * *groot* (WP25).
 */
export async function seedCover(
  t: T,
  w: World,
  opts: { bytes: Uint8Array; formats?: { klein: Uint8Array; groot: Uint8Array }; groupId?: Id<"groups"> },
): Promise<{ photoId: Id<"photos">; albumId: Id<"albums"> }> {
  const groupId = opts.groupId ?? w.groupId;
  const albumId = await seedAlbum(t, groupId, w.users.olga!);
  const photoId = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([opts.bytes as BlobPart], { type: "image/jpeg" }));
    const formats = opts.formats
      ? {
          klein: await ctx.storage.store(new Blob([opts.formats.klein as BlobPart], { type: "image/jpeg" })),
          groot: await ctx.storage.store(new Blob([opts.formats.groot as BlobPart], { type: "image/jpeg" })),
        }
      : undefined;
    return await ctx.db.insert("photos", {
      ownerId: w.users.olga!,
      storageId,
      ...(formats ? { formats } : {}),
      createdAt: Date.now(),
    });
  });
  await publish(t, albumId, photoId);
  await t.run(async (ctx) => ctx.db.patch(groupId, { coverPhotoId: photoId }));
  return { photoId, albumId };
}

export async function inviteRow(t: T, id: Id<"invites">) {
  return await t.run(async (ctx) => ctx.db.get(id));
}

export async function allInvites(t: T) {
  return await t.run(async (ctx) => ctx.db.query("invites").collect());
}

export async function usersByEmail(t: T, email: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect(),
  );
}

export async function scheduledCount(t: T): Promise<number> {
  return await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).length);
}

/** De data van een ConvexError, of een fout als het iets anders was. */
export async function refusalData(run: () => Promise<unknown>): Promise<unknown> {
  let err: unknown;
  try {
    await run();
  } catch (e) {
    err = e;
  }
  expect(err, "de aanroep had moeten falen").toBeDefined();
  expect(err, `verwacht een ConvexError, kreeg: ${String(err)}`).toBeInstanceOf(ConvexError);
  return (err as { data: unknown }).data;
}

/** Recursief alle sleutels van een JSON-waarde. */
export function allKeys(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, sub] of Object.entries(v)) {
        out.push(k);
        walk(sub);
      }
    }
  };
  walk(value);
  return out;
}
