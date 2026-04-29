import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireCurrentUser } from "./users";
import { getMembership } from "./groups";

const ROLE = v.union(v.literal("admin"), v.literal("member"));

const DEFAULT_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // 14 dagen

function generateToken(): string {
  return crypto.randomUUID();
}

async function findByToken(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<Doc<"invites"> | null> {
  return await ctx.db
    .query("invites")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}

export const create = mutation({
  args: {
    email: v.string(),
    groupId: v.optional(v.id("groups")),
    role: v.optional(ROLE),
  },
  returns: v.object({ inviteId: v.id("invites"), token: v.string() }),
  handler: async (ctx, { email, groupId, role }) => {
    const user = await requireCurrentUser(ctx);

    // Group-scoped invite: caller moet member zijn van die groep.
    if (groupId) {
      const m = await getMembership(ctx, user._id, groupId);
      if (!m) {
        throw new Error("Alleen members kunnen invites voor deze groep sturen");
      }
    }

    const token = generateToken();
    const now = Date.now();
    const inviteId = await ctx.db.insert("invites", {
      email,
      invitedBy: user._id,
      groupId,
      role,
      token,
      status: "pending",
      expiresAt: now + DEFAULT_EXPIRY_MS,
      createdAt: now,
    });
    return { inviteId, token };
  },
});

// Public: gebruikt door invite-landingpagina vóór login.
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const invite = await findByToken(ctx, token);
    if (!invite) return null;
    const inviter = await ctx.db.get(invite.invitedBy);
    const group = invite.groupId ? await ctx.db.get(invite.groupId) : null;
    return { ...invite, inviter, group };
  },
});

export const accept = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireCurrentUser(ctx);
    const invite = await findByToken(ctx, token);
    if (!invite) throw new Error("Invite niet gevonden");
    if (invite.email !== user.email) {
      throw new Error("Invite is niet voor jouw email");
    }
    if (invite.status !== "pending") {
      throw new Error("Invite is niet meer pending");
    }
    if (invite.expiresAt < Date.now()) {
      // Status-patch zou worden teruggedraaid door de throw (Convex
      // mutations zijn atomair). Markeren als expired gebeurt door een
      // periodieke cron — TODO wanneer scheduled functions infra landt.
      throw new Error("Invite is verlopen");
    }

    await ctx.db.patch(invite._id, {
      status: "accepted",
      respondedAt: Date.now(),
    });

    if (invite.groupId) {
      const existing = await getMembership(ctx, user._id, invite.groupId);
      if (!existing) {
        await ctx.db.insert("memberships", {
          userId: user._id,
          groupId: invite.groupId,
          role: invite.role ?? "member",
          joinedAt: Date.now(),
        });
      }
    }
  },
});

export const decline = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireCurrentUser(ctx);
    const invite = await findByToken(ctx, token);
    if (!invite) throw new Error("Invite niet gevonden");
    if (invite.email !== user.email) {
      throw new Error("Invite is niet voor jouw email");
    }
    if (invite.status !== "pending") return; // idempotent
    await ctx.db.patch(invite._id, {
      status: "declined",
      respondedAt: Date.now(),
    });
  },
});

// Gebruikt door de Clerk pre-signup webhook (in fase 4) om
// invite-only signup te enforcen: alleen emails met een pending,
// niet-verlopen invite mogen registeren.
export const listPendingForEmail = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const now = Date.now();
    const all = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    return all.filter((i) => i.status === "pending" && i.expiresAt > now);
  },
});

export const hasPendingForEmail = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const now = Date.now();
    const all = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    return all.some((i) => i.status === "pending" && i.expiresAt > now);
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    if (!user) return [];
    const all = await ctx.db.query("invites").collect();
    return all.filter((i) => i.invitedBy === user._id);
  },
});

export const remove = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    const user = await requireCurrentUser(ctx);
    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new Error("Invite bestaat niet");
    if (invite.invitedBy !== user._id) {
      throw new Error("Alleen sender kan deze invite intrekken");
    }
    await ctx.db.delete(inviteId);
  },
});
