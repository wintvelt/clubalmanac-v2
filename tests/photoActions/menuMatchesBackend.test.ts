/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  photoActions,
  previewOrientation,
  type PhotoAction,
} from "../../app/src/lib/photoActions";
import { as, newT, outcome, type T } from "../readWhitelist/_world";

// WP17b invariant 10: het menu is nooit ruimer dan de backend, en voor een
// foto die alleen in dit album staat ook niet strenger. Het orakel is de
// backend zelf (WP8, WP24, WP17a invariant 16), los geschreven en los getest;
// het menu (app/src/lib/photoActions.ts) deelt er geen code mee.
//
// Invariant 11: de stand na photos.rotate is de stand die het draaischerm als
// voorbeeld toont (previewOrientation).
//
// Spec: docs/work-packages/WP17b-foto-acties.md §Spec-criticus aanvullingen.

// Een weigering moet een echte weigering zijn, niet "functie bestaat niet":
// anders zou een ontbrekende users.setProfilePhoto als "menu verbergt, backend
// weigert" vals groen staan.
const MISSING_FUNCTION =
  /could not find|no such export|exported from module|no function named|not a function|not registered/i;

type Role = "admin" | "member";
type ViewerKey = "owner" | "admin" | "member" | "creator";

/**
 * Wereld:
 *   G — owner (rol naar keuze), admin (admin), member (member), creator (member).
 *   Album AL in G, gemaakt door creator. Foto P van owner, door owner in AL gezet.
 */
async function world(t: T, ownerRole: Role) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const user = async (key: ViewerKey) => ({
      key,
      subject: `user_${key}`,
      id: await ctx.db.insert("users", {
        subject: `user_${key}`,
        email: `${key}@x.com`,
        name: key,
        photoCount: 0,
        photoLimit: 1000,
        createdAt: now,
      }),
    });
    const users = {
      owner: await user("owner"),
      admin: await user("admin"),
      member: await user("member"),
      creator: await user("creator"),
    };
    const groupId = await ctx.db.insert("groups", {
      name: "G",
      createdBy: users.admin.id,
      createdAt: now,
    });
    const roles: Record<ViewerKey, Role> = {
      owner: ownerRole,
      admin: "admin",
      member: "member",
      creator: "member",
    };
    for (const key of Object.keys(users) as ViewerKey[]) {
      await ctx.db.insert("memberships", {
        userId: users[key].id,
        groupId,
        role: roles[key],
        joinedAt: now,
      });
    }
    const albumId = await ctx.db.insert("albums", {
      groupId,
      name: "AL",
      createdBy: users.creator.id,
      createdAt: now,
    });
    const photoId = await ctx.db.insert("photos", {
      ownerId: users.owner.id,
      storageId: await ctx.storage.store(new Blob(["p"])),
      exifOrientation: 1,
      ratingCount: 0,
      createdAt: now,
    });
    await ctx.db.insert("albumPhotos", {
      albumId,
      photoId,
      groupId,
      addedAt: now,
      addedBy: users.owner.id,
    });
    return { users, roles, groupId, albumId, photoId };
  });
}

type W = Awaited<ReturnType<typeof world>>;

function runAction(t: T, w: W, viewer: ViewerKey, action: PhotoAction): Promise<unknown> {
  const client = as(t, w.users[viewer].subject, `${viewer}@x.com`);
  switch (action) {
    case "rotate":
      return client.mutation(api.photos.rotate, { photoId: w.photoId, rotation: 90, flipY: false });
    case "delete":
      return client.mutation(api.photos.remove, { photoId: w.photoId });
    case "removeFromAlbum":
      return client.mutation(api.albums.removePhoto, { albumId: w.albumId, photoId: w.photoId });
    case "albumCover":
      return client.mutation(api.albums.update, { albumId: w.albumId, coverPhotoId: w.photoId });
    case "groupCover":
      return client.mutation(api.groups.update, { groupId: w.groupId, coverPhotoId: w.photoId });
    case "profilePhoto":
      return client.mutation(api.users.setProfilePhoto, { photoId: w.photoId });
  }
  throw new Error(`onbekende actie ${String(action)}`);
}

async function backendAllows(t: T, w: W, viewer: ViewerKey, action: PhotoAction): Promise<boolean> {
  const o = await outcome(() => runAction(t, w, viewer, action));
  if ("err" in o) {
    expect(o.err, `${viewer}/${action}: geen echte weigering`).not.toMatch(MISSING_FUNCTION);
    return false;
  }
  return true;
}

function menuFor(w: W, viewer: ViewerKey): PhotoAction[] {
  return photoActions({
    me: w.users[viewer].id,
    role: w.roles[viewer],
    ownerId: w.users.owner.id,
    addedBy: w.users.owner.id,
  });
}

const ACTIONS: PhotoAction[] = [
  "rotate",
  "albumCover",
  "groupCover",
  "profilePhoto",
  "removeFromAlbum",
  "delete",
];

const CASES: { ownerRole: Role; viewer: ViewerKey }[] = [
  { ownerRole: "member", viewer: "owner" },
  { ownerRole: "admin", viewer: "owner" },
  { ownerRole: "member", viewer: "admin" },
  { ownerRole: "member", viewer: "member" },
  { ownerRole: "member", viewer: "creator" },
];

describe("invariant 10: het menu toont een actie precies als de backend hem toelaat", () => {
  for (const { ownerRole, viewer } of CASES) {
    for (const action of ACTIONS) {
      it(`${viewer} (eigenaar is ${ownerRole}): ${action}`, async () => {
        const t = newT();
        const w = await world(t, ownerRole);
        const shown = menuFor(w, viewer).includes(action);
        const allowed = await backendAllows(t, w, viewer, action);
        expect(shown, `menu ${shown ? "toont" : "verbergt"}, backend ${allowed ? "laat toe" : "weigert"}`).toBe(
          allowed,
        );
      });
    }
  }
});

describe("invariant 10: strenger mag, ruimer niet — foto ook in een groep waar de kijker admin is", () => {
  // De kijker is gewoon lid van G, maar admin van G2 waar de foto ook in een
  // album staat. De backend laat hem draaien (WP8: admin van een groep met de
  // foto); het menu in AL kent alleen de rol in G en mag dat verbergen.
  it("wat het menu toont, laat de backend toe", async () => {
    for (const action of ACTIONS) {
      const t = newT();
      const w = await world(t, "member");
      await t.run(async (ctx) => {
        const now = Date.now();
        const g2 = await ctx.db.insert("groups", { name: "G2", createdBy: w.users.member.id, createdAt: now });
        await ctx.db.insert("memberships", { userId: w.users.member.id, groupId: g2, role: "admin", joinedAt: now });
        await ctx.db.insert("memberships", { userId: w.users.owner.id, groupId: g2, role: "member", joinedAt: now });
        const a2 = await ctx.db.insert("albums", { groupId: g2, name: "A2", createdBy: w.users.member.id, createdAt: now });
        await ctx.db.insert("albumPhotos", { albumId: a2, photoId: w.photoId, groupId: g2, addedAt: now, addedBy: w.users.owner.id });
      });
      const shown = menuFor(w, "member").includes(action);
      const allowed = await backendAllows(t, w, "member", action);
      if (shown) expect(allowed, `menu toont ${action}, backend weigert`).toBe(true);
    }
  });
});

describe("invariant 11: na bewaren staat de foto zoals het voorbeeld", () => {
  const edits = [0, 90, 180, 270].flatMap((rotation) =>
    [false, true].map((flipY) => ({ rotation: rotation as 0 | 90 | 180 | 270, flipY })),
  );

  for (const start of [undefined, 1, 3, 5, 6, 8] as const) {
    it(`vanaf stand ${start ?? "leeg"}`, async () => {
      for (const e of edits) {
        const t = newT();
        const w = await world(t, "member");
        await t.run(async (ctx) => {
          await ctx.db.patch(w.photoId, { exifOrientation: start });
        });
        await as(t, w.users.owner.subject).mutation(api.photos.rotate, { photoId: w.photoId, ...e });
        const after = await t.run(async (ctx) => (await ctx.db.get(w.photoId as Id<"photos">))!.exifOrientation);
        expect(after, `${start}, ${e.rotation}, ${e.flipY}`).toBe(previewOrientation(start, e));
      }
    });
  }
});
