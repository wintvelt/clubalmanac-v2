import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireCurrentUser } from "./users";
import { getMembership } from "./groups";

const ROLE = v.union(v.literal("admin"), v.literal("member"));

const DEFAULT_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // 14 dagen

function generateToken(): string {
  return crypto.randomUUID();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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

async function findInvitesByEmail(
  ctx: QueryCtx | MutationCtx,
  email: string,
): Promise<Doc<"invites">[]> {
  return await ctx.db
    .query("invites")
    .withIndex("by_email", (q) => q.eq("email", normalizeEmail(email)))
    .collect();
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
    const normalizedEmail = normalizeEmail(email);

    // Group-scoped invite: caller moet member zijn van die groep.
    if (groupId) {
      const m = await getMembership(ctx, user._id, groupId);
      if (!m) {
        throw new Error("Alleen members kunnen invites voor deze groep sturen");
      }

      // [GAP] Weiger als de email al member is van de group — beter hier
      // catchen dan pas op accept (oude AWS code deed dat in acceptInvite).
      const existingUser = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
        .unique();
      if (existingUser) {
        const existingMembership = await getMembership(
          ctx,
          existingUser._id,
          groupId,
        );
        if (existingMembership) {
          throw new Error("Deze gebruiker is al lid van de groep");
        }
      }
    }

    // [GAP] Dedup: voorkom dubbele pending invite voor (email, groupId).
    const existingInvites = await findInvitesByEmail(ctx, normalizedEmail);
    const now = Date.now();
    const duplicate = existingInvites.find(
      (i) =>
        i.status === "pending" &&
        i.expiresAt > now &&
        i.groupId === groupId,
    );
    if (duplicate) {
      throw new Error("Er staat al een open invite voor dit emailadres");
    }

    const token = generateToken();
    const effectiveRole = groupId ? (role ?? "member") : role;
    const inviteId = await ctx.db.insert("invites", {
      email: normalizedEmail,
      invitedBy: user._id,
      groupId,
      role: effectiveRole,
      token,
      status: "pending",
      expiresAt: now + DEFAULT_EXPIRY_MS,
      createdAt: now,
    });

    // Best-effort: invite-mail naar ontvanger queue'n. Faalt deze action,
    // dan blijft de invite gewoon bestaan (mutation slaagt los van mail).
    await ctx.scheduler.runAfter(0, internal.invites.sendInviteEmail, {
      kind: "invite",
      inviteId,
    });

    return { inviteId, token };
  },
});

// Public: gebruikt door invite-landingpagina vóór login. Geen auth-check.
// Frontend bepaalt wat te tonen op basis van status + isExpired.
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const invite = await findByToken(ctx, token);
    if (!invite) return null;
    const inviter = await ctx.db.get(invite.invitedBy);
    const group = invite.groupId ? await ctx.db.get(invite.groupId) : null;
    const isExpired = invite.expiresAt < Date.now();
    return { ...invite, inviter, group, isExpired };
  },
});

export const accept = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireCurrentUser(ctx);
    const invite = await findByToken(ctx, token);
    if (!invite) throw new Error("Invite niet gevonden");
    if (invite.email !== normalizeEmail(user.email)) {
      throw new Error("Invite is niet voor jouw email");
    }
    if (invite.status !== "pending") {
      throw new Error("Invite is niet meer pending");
    }
    if (invite.expiresAt < Date.now()) {
      // Status-patch zou worden teruggedraaid door de throw (Convex
      // mutations zijn atomair). Markeren als expired gebeurt door cron
      // of bounce-handler.
      throw new Error("Invite is verlopen");
    }

    await ctx.db.patch(invite._id, {
      status: "accepted",
      respondedAt: Date.now(),
    });

    if (invite.groupId) {
      const existing = await getMembership(ctx, user._id, invite.groupId);
      const desiredRole = invite.role ?? "member";
      if (!existing) {
        await ctx.db.insert("memberships", {
          userId: user._id,
          groupId: invite.groupId,
          role: desiredRole,
          joinedAt: Date.now(),
        });
      } else if (existing.role !== "admin" && desiredRole === "admin") {
        // Upgrade: bestaand member wordt admin (oude AWS:
        // hasBetterRoleForMember). Geen downgrade van admin → member.
        await ctx.db.patch(existing._id, { role: "admin" });
      }
    }

    // Notify inviter — best-effort gequeue'd action.
    await ctx.scheduler.runAfter(0, internal.invites.sendInviteEmail, {
      kind: "accepted",
      inviteId: invite._id,
    });
  },
});

export const decline = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireCurrentUser(ctx);
    const invite = await findByToken(ctx, token);
    if (!invite) throw new Error("Invite niet gevonden");
    if (invite.email !== normalizeEmail(user.email)) {
      throw new Error("Invite is niet voor jouw email");
    }
    // Idempotent voor reeds gedeclined: geen throw, geen tweede notify.
    if (invite.status === "declined") return;
    if (invite.status === "accepted") {
      throw new Error("Invite is al geaccepteerd");
    }
    if (invite.status === "expired") {
      throw new Error("Invite is verlopen");
    }
    if (invite.expiresAt < Date.now()) {
      throw new Error("Invite is verlopen");
    }

    await ctx.db.patch(invite._id, {
      status: "declined",
      respondedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.invites.sendInviteEmail, {
      kind: "declined",
      inviteId: invite._id,
    });
  },
});

// Pre-signup gate (Clerk webhook in fase 4): alleen emails met een
// pending, niet-verlopen invite mogen registreren. Anonymous query.
export const listPendingForEmail = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const now = Date.now();
    const all = await findInvitesByEmail(ctx, email);
    return all.filter((i) => i.status === "pending" && i.expiresAt > now);
  },
});

export const hasPendingForEmail = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const now = Date.now();
    const all = await findInvitesByEmail(ctx, email);
    return all.some((i) => i.status === "pending" && i.expiresAt > now);
  },
});

// Sender-view: eigen verstuurde invites (alle statussen, audit/history).
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

// Sender of een group-admin van de invite-group kan een pending invite
// intrekken. Reeds responded invites (accepted/declined) niet — dat zou
// een latent membership orphanen.
export const remove = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    const user = await requireCurrentUser(ctx);
    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new Error("Invite bestaat niet");

    if (invite.status === "accepted") {
      throw new Error("Geaccepteerde invite kan niet meer ingetrokken worden");
    }

    let allowed = invite.invitedBy === user._id;
    if (!allowed && invite.groupId) {
      const callerMembership = await getMembership(
        ctx,
        user._id,
        invite.groupId,
      );
      if (callerMembership && callerMembership.role === "admin") {
        allowed = true;
      }
    }
    if (!allowed) {
      throw new Error("Geen rechten om deze invite in te trekken");
    }

    await ctx.db.delete(inviteId);
  },
});

// ──────────────────────────────────────────────────────────────────
// Bounce handling (Mailjet webhook → http endpoint → handleBounce)
// ──────────────────────────────────────────────────────────────────

// Internal mutation: aangeroepen vanuit de Mailjet bounce-webhook.
// Markeert alle pending invites voor het email als expired + bouncedAt
// en plant notify-emails naar inviters. Idempotent op providerEventId.
export const handleBounce = internalMutation({
  args: {
    email: v.string(),
    providerEventId: v.string(),
  },
  returns: v.object({ matched: v.number() }),
  handler: async (ctx, { email, providerEventId }) => {
    // Dedup: tweede call met zelfde event-id is no-op.
    const seen = await ctx.db
      .query("inviteBounceEvents")
      .withIndex("by_eventId", (q) =>
        q.eq("providerEventId", providerEventId),
      )
      .unique();
    if (seen) return { matched: 0 };

    const all = await findInvitesByEmail(ctx, email);
    const pending = all.filter((i) => i.status === "pending");

    const now = Date.now();
    for (const invite of pending) {
      await ctx.db.patch(invite._id, {
        status: "expired",
        bouncedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.invites.sendInviteEmail, {
        kind: "bounced",
        inviteId: invite._id,
      });
    }

    // Pas dedup-marker plaatsen ná verwerking — als handler eerder zou
    // throwen rolt Convex de hele transactie terug inclusief deze marker.
    await ctx.db.insert("inviteBounceEvents", {
      providerEventId,
      processedAt: now,
    });

    return { matched: pending.length };
  },
});

// Stub voor invite/notify-emails. Echte Mailjet-implementatie landt in
// de email-bullet van fase 2 (zie migratie-plan-convex.md). Tot dan is
// de scheduler-call genoeg om de "best-effort"-pattern te bewijzen.
export const sendInviteEmail = internalAction({
  args: {
    kind: v.union(
      v.literal("invite"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("bounced"),
    ),
    inviteId: v.id("invites"),
  },
  handler: async (_ctx, _args) => {
    // No-op stub. Mailjet-integratie volgt in email-bullet.
  },
});
