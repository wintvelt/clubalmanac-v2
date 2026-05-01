import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getBySubject, requireCurrentUser } from "./users";
import {
  deleteAlbumLastSeenByAlbum,
  deleteAlbumLastSeenForUserInGroup,
  upsertAlbumLastSeen,
} from "./albums";

const ROLE = v.union(v.literal("admin"), v.literal("member"));

export async function getMembership(
  ctx: QueryCtx,
  userId: Id<"users">,
  groupId: Id<"groups">,
): Promise<Doc<"memberships"> | null> {
  return await ctx.db
    .query("memberships")
    .withIndex("by_user_and_group", (q) =>
      q.eq("userId", userId).eq("groupId", groupId),
    )
    .unique();
}

async function requireGroup(
  ctx: QueryCtx,
  groupId: Id<"groups">,
): Promise<Doc<"groups">> {
  const group = await ctx.db.get(groupId);
  if (!group) throw new Error("Groep bestaat niet");
  return group;
}

export async function requireMember(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"groups">,
) {
  const user = await requireCurrentUser(ctx);
  const membership = await getMembership(ctx, user._id, groupId);
  if (!membership) throw new Error("Geen lid van deze groep");
  return { user, membership };
}

export async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"groups">,
) {
  const { user, membership } = await requireMember(ctx, groupId);
  if (membership.role !== "admin") throw new Error("Admin-rechten vereist");
  return { user, membership };
}

async function countAdmins(
  ctx: QueryCtx,
  groupId: Id<"groups">,
): Promise<number> {
  const all = await ctx.db
    .query("memberships")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  return all.filter((m) => m.role === "admin").length;
}

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.id("groups"),
  handler: async (ctx, { name, description }) => {
    const user = await requireCurrentUser(ctx);

    const groupId = await ctx.db.insert("groups", {
      name,
      description,
      createdBy: user._id,
      createdAt: Date.now(),
    });

    await ctx.db.insert("memberships", {
      userId: user._id,
      groupId,
      role: "admin",
      joinedAt: Date.now(),
    });

    return groupId;
  },
});

export const getById = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    return await ctx.db.get(groupId);
  },
});

// Cat-1 join-on-read: group + cover photo. Cascade matrix row P2.
// Member-only (groep-data is sowieso member-only).
export const getWithCover = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    await requireMember(ctx, groupId);
    const group = await ctx.db.get(groupId);
    if (!group) return null;
    const cover = group.coverPhotoId
      ? await ctx.db.get(group.coverPhotoId)
      : null;
    return { ...group, cover };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await getBySubject(ctx, identity.subject);
    if (!user) return [];

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const groups = await Promise.all(
      memberships.map(async (m) => {
        const group = await ctx.db.get(m.groupId);
        if (!group) return null;
        return { ...group, role: m.role };
      }),
    );
    return groups.filter((g): g is NonNullable<typeof g> => g !== null);
  },
});

export const listMembers = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    await requireMember(ctx, groupId);

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();

    return await Promise.all(
      memberships.map(async (m) => ({
        membership: m,
        user: await ctx.db.get(m.userId),
      })),
    );
  },
});

export const update = mutation({
  args: {
    groupId: v.id("groups"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    coverPhotoId: v.optional(v.id("photos")),
  },
  handler: async (ctx, { groupId, ...rest }) => {
    await requireAdmin(ctx, groupId);
    const patch: Partial<Doc<"groups">> = {};
    if (rest.name !== undefined) patch.name = rest.name;
    if (rest.description !== undefined) patch.description = rest.description;
    if (rest.coverPhotoId !== undefined) patch.coverPhotoId = rest.coverPhotoId;
    if (Object.keys(patch).length > 0) await ctx.db.patch(groupId, patch);
  },
});

export const remove = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    await requireAdmin(ctx, groupId);
    await requireGroup(ctx, groupId);

    // G4 + transitief A1+A2: cascade albums (incl. albumPhotos en albumLastSeen).
    // Match groupDelToAlbums.js + transitief albumDelToAlbumPhoto.js (A1) +
    // nieuwe A2 (albumLastSeen, geen AWS-equivalent).
    // Volgorde: albumPhotos → albumLastSeen → albums → memberships → group.
    // Photos blijven (eigendom van users, niet groups).
    // [Cascade matrix G4, A1, A2]
    const albumPhotos = await ctx.db
      .query("albumPhotos")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    for (const ap of albumPhotos) await ctx.db.delete(ap._id);

    const albums = await ctx.db
      .query("albums")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    for (const a of albums) {
      await deleteAlbumLastSeenByAlbum(ctx, a._id);
      await ctx.db.delete(a._id);
    }

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    for (const m of memberships) await ctx.db.delete(m._id);

    await ctx.db.delete(groupId);
  },
});

export const addMember = mutation({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
    role: v.optional(ROLE),
  },
  handler: async (ctx, { groupId, userId, role }) => {
    await requireAdmin(ctx, groupId);

    const existing = await getMembership(ctx, userId, groupId);
    if (existing) throw new Error("User is al lid van deze groep");

    const target = await ctx.db.get(userId);
    if (!target) throw new Error("User bestaat niet");

    await ctx.db.insert("memberships", {
      userId,
      groupId,
      role: role ?? "member",
      joinedAt: Date.now(),
    });
  },
});

// Internal helper: doet de volle M1+M2+M3 cascade voor één membership.
// Aangeroepen door groups.removeMember (na auth check) en door
// users.deleteSelf voor transitieve cascade per membership.
//
// Cascade matrix rows M1, M2 (a-e), M3.
export async function internalRemoveMember(
  ctx: MutationCtx,
  args: { userId: Id<"users">; groupId: Id<"groups"> },
): Promise<void> {
  const { userId, groupId } = args;
  const target = await getMembership(ctx, userId, groupId);
  if (!target) return;

  // M1: ruim albumPhotos op waar photo-owner deze user is en publicatie in
  // deze groep zit. Match memberDelToAlbumPhoto.js regel 51
  // (userPhotoKeys.includes filter op photo-owner-keys). Bob vertrekt → al
  // zijn foto's uit alle albums in deze group, ongeacht wie ze had toegevoegd.
  // [Cascade matrix M1]
  const groupAps = await ctx.db
    .query("albumPhotos")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  for (const ap of groupAps) {
    const photo = await ctx.db.get(ap.photoId);
    if (photo?.ownerId === userId) await ctx.db.delete(ap._id);
  }

  // M3: cascade albumLastSeen voor deze user × albums in déze group.
  // Andere groepen blijven intact.
  await deleteAlbumLastSeenForUserInGroup(ctx, userId, groupId);

  await ctx.db.delete(target._id);

  // [GAP] zero-member check telt invites niet mee. Heroverwegen wanneer
  // invite-systeem in Convex landt (cascade-matrix.md row S1).
  const remaining = await ctx.db
    .query("memberships")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();

  if (remaining.length === 0) {
    // cascade-matrix.md M2-e: laatste lid weg, group cascade-delete
    // (albums + albumPhotos + albumLastSeen).
    const remainingAps = await ctx.db
      .query("albumPhotos")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    for (const ap of remainingAps) await ctx.db.delete(ap._id);
    const albums = await ctx.db
      .query("albums")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    for (const a of albums) {
      await deleteAlbumLastSeenByAlbum(ctx, a._id);
      await ctx.db.delete(a._id);
    }
    await ctx.db.delete(groupId);
    return;
  }

  // cascade-matrix.md M2-c: laatste admin weg, anderen promoveren.
  const adminsLeft = remaining.filter((m) => m.role === "admin");
  if (adminsLeft.length === 0) {
    for (const m of remaining) {
      await ctx.db.patch(m._id, { role: "admin" });
    }
  }

  // cascade-matrix.md M2-d: founder weg, eerste admin promoveren tot
  // founder.
  const group = await ctx.db.get(groupId);
  if (group && group.createdBy === userId) {
    const refreshed = await ctx.db
      .query("memberships")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    // [GAP] sort op joinedAt asc voor admin/founder promotie. Bewust
    // deterministisch gekozen, equivalent aan willekeurige insert-volgorde
    // want createdAt monotoon stijgt.
    const newFounder = refreshed
      .filter((m) => m.role === "admin")
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (newFounder) {
      await ctx.db.patch(groupId, { createdBy: newFounder.userId });
    }
  }
}

export const removeMember = mutation({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
  },
  handler: async (ctx, { groupId, userId }) => {
    const caller = await requireCurrentUser(ctx);
    const callerMembership = await getMembership(ctx, caller._id, groupId);
    if (!callerMembership) throw new Error("Geen lid van deze groep");

    const isSelf = caller._id === userId;
    if (!isSelf && callerMembership.role !== "admin") {
      throw new Error("Admin-rechten vereist");
    }
    // self-removal: caller wordt ex-member, callerMembership niet meer
    // geraadpleegd na delete.

    const target = await getMembership(ctx, userId, groupId);
    if (!target) throw new Error("User is geen lid van deze groep");

    await internalRemoveMember(ctx, { userId, groupId });
  },
});

export const updateMemberRole = mutation({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
    role: ROLE,
  },
  handler: async (ctx, { groupId, userId, role }) => {
    await requireAdmin(ctx, groupId);

    const target = await getMembership(ctx, userId, groupId);
    if (!target) throw new Error("User is geen lid van deze groep");
    if (target.role === role) return;

    if (target.role === "admin" && role === "member") {
      const adminCount = await countAdmins(ctx, groupId);
      if (adminCount <= 1) {
        throw new Error("Laatste admin kan niet gedemoted worden");
      }
    }

    await ctx.db.patch(target._id, { role });
  },
});


// Escape hatch: markeer alle albums in een group als gezien voor caller.
// Bedoeld voor nieuwe members die niet handmatig elk album hoeven te openen.
export const markAllAlbumsSeen = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    const { user } = await requireMember(ctx, groupId);
    const albums = await ctx.db
      .query("albums")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    const now = Date.now();
    for (const a of albums) {
      await upsertAlbumLastSeen(ctx, user._id, a._id, now);
    }
  },
});
