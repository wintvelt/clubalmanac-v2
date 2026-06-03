import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireCurrentUser } from "./users";
import { getMembership } from "./groups";
import { normalizeEmail } from "./lib/email";
import { INVITES_SENDER, sendMailjetMessage } from "./lib/mailjet";
import {
  acceptedTemplate,
  bouncedTemplate,
  buildInviteUrl,
  declinedTemplate,
  formatNlDate,
  inviteTemplate,
} from "./lib/emailTemplates";

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
    // Audit-8 §9: expiresAt > now ⇔ nog geldig (gespiegelde polariteit van
    // de <= now "verlopen"-spec in accept/decline). Boundary-moment telt als
    // verlopen; een invite met expiresAt === now is dus géén duplicate.
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
//
// Audit-8: defense-in-depth tegen info-leak op anonymous endpoint. Inviter
// wordt gesluisd tot {name, profilePhotoStorageId} — geen email, Clerk
// subject, photoCount/photoLimit, lastVisitAt, createdAt of interne
// Convex-velden lekken naar de publieke landingspagina.
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const invite = await findByToken(ctx, token);
    if (!invite) return null;
    const inviterDoc = await ctx.db.get(invite.invitedBy);
    const inviter = inviterDoc
      ? {
          name: inviterDoc.name,
          profilePhotoStorageId: inviterDoc.profilePhotoStorageId,
        }
      : null;
    const group = invite.groupId ? await ctx.db.get(invite.groupId) : null;
    const isExpired = invite.expiresAt <= Date.now();
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
    // Audit-8 §9: expiresAt <= now is verlopen (boundary-moment telt al als
    // verlopen). Harmoniseert met hasPendingForEmail (`> now` als geldig).
    // Status-patch zou worden teruggedraaid door de throw (Convex mutations
    // zijn atomair). Markeren als expired gebeurt door cron of bounce-handler.
    if (invite.expiresAt <= Date.now()) {
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

    // Audit-8 order-bug: status-checks vóór email-check. Een tweede call op
    // een reeds-declined invite (refresh, history-replay) moet idempotent
    // zijn ongeacht caller-email. Voor terminal states (declined/accepted/
    // expired) is geen state-overgang meer nodig en is de email-mismatch-
    // throw ongepast (lekt status niet, want eerste rechtmatige caller heeft
    // 'm al gezet).
    if (invite.status === "declined") return;
    if (invite.status === "accepted") {
      throw new Error("Invite is al geaccepteerd");
    }
    if (invite.status === "expired") {
      throw new Error("Invite is verlopen");
    }
    if (invite.expiresAt <= Date.now()) {
      throw new Error("Invite is verlopen");
    }
    // Pending: vereist matching email vóór state-overgang.
    if (invite.email !== normalizeEmail(user.email)) {
      throw new Error("Invite is niet voor jouw email");
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
// Audit-8: gebruikt by_invitedBy index ipv full-table scan — schaalt bij
// groei van invites-table (was O(n) over alle invites).
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
    return await ctx.db
      .query("invites")
      .withIndex("by_invitedBy", (q) => q.eq("invitedBy", user._id))
      .collect();
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

    // Idempotency dedup-marker. Alle DB-mutations binnen één Convex mutation
    // zijn atomair (alles-of-niets), dus volgorde van inserts is irrelevant
    // voor consistency. Marker dient om duplicate webhook calls (zelfde
    // providerEventId) als no-op te detecteren.
    await ctx.db.insert("inviteBounceEvents", {
      providerEventId,
      processedAt: now,
    });

    return { matched: pending.length };
  },
});

// IB2: natural-expiry cron. Patcht pending invites waarvan expiresAt
// gepasseerd is naar status="expired". Los van het bounce-pad (handleBounce):
// schrijft NOOIT bouncedAt of respondedAt en verstuurt geen notify-mail —
// natural expiry is verwacht-gedrag en blijft stil. Zie cascade-matrix IB2
// (single-row state-transition, geen cascade) + WP9-spec.
//
// by_status is single-field (geen composite met expiresAt), dus geen
// range-query mogelijk: eq("status","pending") via index, daarna in-memory
// expiresAt <= now-filter. Zelfde patroon als handleBounce (by_email collect
// + in-memory status-filter). Boundary <= consistent met FL1, accept en
// hasPendingForEmail (gespiegeld: expiresAt > now = nog geldig).
export const expirePendingInvites = internalMutation({
  args: {},
  returns: v.object({ expired: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("invites")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    let expired = 0;
    for (const invite of pending) {
      if (invite.expiresAt <= now) {
        await ctx.db.patch(invite._id, { status: "expired" });
        expired++;
      }
    }
    return { expired };
  },
});

// Internal helper-query voor sendInviteEmail-action. Action draait in
// runtime zonder ctx.db; FK-walk gebeurt hier en levert een platte DTO.
// Retourneert null als invite niet meer bestaat (race met sender die de
// invite intussen heeft ingetrokken).
export const getInviteForEmail = internalQuery({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get(inviteId);
    if (!invite) return null;
    const inviter = await ctx.db.get(invite.invitedBy);
    const group = invite.groupId ? await ctx.db.get(invite.groupId) : null;
    // accepter/decliner lookup: invite.email is altijd normalized, by_email
    // index op users werkt direct. Kan null zijn als de ontvanger zich nog
    // niet had geregistreerd (decline via public-token zonder account).
    const recipientUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", invite.email))
      .unique();
    return {
      invite: {
        email: invite.email,
        token: invite.token,
        expiresAt: invite.expiresAt,
        invitedBy: invite.invitedBy,
        groupId: invite.groupId ?? null,
      },
      inviter: inviter
        ? { name: inviter.name ?? inviter.email, email: inviter.email }
        : null,
      group: group ? { name: group.name } : null,
      recipientUser: recipientUser
        ? { name: recipientUser.name ?? recipientUser.email }
        : null,
    };
  },
});

// Mailjet-action voor de vier invite-mail-kinds.
//
// Recipient-resolutie:
//   kind=invite                       → invite.email (de geïnviteerde)
//   kind=accepted|declined|bounced    → inviter (via invite.invitedBy → users.get)
//
// Graceful skip: als invite of (voor notify-kinds) inviter inmiddels weg
// is, no-op zonder throw. Scheduler-retry zou anders eindeloos blijven
// hangen aan een race-loser.
//
// Verified-sender hard gate: élke send via `sendMailjetMessage`, die
// vóór de fetch checkt of `from` in `MAILJET_VERIFIED_SENDERS` zit.
// Ontbrekend/leeg → throw `UNVERIFIED_SENDER:` (zie lib/mailjet.ts).
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
  handler: async (ctx, { kind, inviteId }) => {
    const data = await ctx.runQuery(internal.invites.getInviteForEmail, {
      inviteId,
    });
    if (!data) {
      console.log(
        `[sendInviteEmail] invite niet meer gevonden inviteId=${inviteId}, skipping`,
      );
      return;
    }

    const groupName = data.group?.name;

    if (kind === "invite") {
      const inviterName = data.inviter?.name ?? "iemand";
      const tpl = inviteTemplate({
        inviterName,
        groupName,
        inviteUrl: buildInviteUrl(data.invite.token),
        token: data.invite.token,
        expirationDate: formatNlDate(data.invite.expiresAt),
      });
      await sendMailjetMessage({
        from: { email: INVITES_SENDER },
        to: [{ email: data.invite.email }],
        subject: tpl.subject,
        htmlPart: tpl.htmlPart,
        textPart: tpl.textPart,
      });
      return;
    }

    // Notify-kinds: ontvanger = inviter. Skip gracefully als inviter weg is.
    if (!data.inviter) {
      console.log(
        `[sendInviteEmail] inviter niet meer gevonden inviteId=${inviteId} kind=${kind}, skipping`,
      );
      return;
    }
    const inviterName = data.inviter.name;
    const otherName = data.recipientUser?.name ?? data.invite.email;

    let tpl;
    if (kind === "accepted") {
      tpl = acceptedTemplate({
        inviterName,
        accepterName: otherName,
        groupName,
      });
    } else if (kind === "declined") {
      tpl = declinedTemplate({
        inviterName,
        declinerName: otherName,
        groupName,
      });
    } else {
      // bounced
      tpl = bouncedTemplate({
        inviterName,
        bouncedEmail: data.invite.email,
        groupName,
      });
    }

    await sendMailjetMessage({
      from: { email: INVITES_SENDER },
      to: [{ email: data.inviter.email }],
      subject: tpl.subject,
      htmlPart: tpl.htmlPart,
      textPart: tpl.textPart,
    });
  },
});
