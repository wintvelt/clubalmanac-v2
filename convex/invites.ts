import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireCurrentUser } from "./users";
import { activeUserBySubject, isEmailBeingDeleted } from "./lib/accountState";
import {
  acceptableInvitesFor,
  getMembership,
  isInviteAcceptable,
  refuse,
  requireAdminForWrite,
} from "./groups";
import { normalizeEmail } from "./lib/email";
import { validName } from "./lib/names";
import { isPublishedInGroup } from "./lib/photoAccess";
import {
  inviteForAdmin,
  inviteForAdminFields,
  inviteReceived,
  inviteReceivedFields,
  inviteSender,
  inviteSenderFields,
  pick,
  publicProfileFields,
  receivedGroupFields,
} from "./lib/shapes";
import { avatarFieldsOf } from "./lib/profilePhoto";
import { INVITES_SENDER, sendMailjetMessage } from "./lib/mailjet";
import {
  acceptedTemplate,
  bouncedTemplate,
  declinedTemplate,
  formatNlDate,
  INVITE_PHOTO_CONTENT_ID,
  INVITE_PHOTO_FILENAME,
  inviteTemplate,
} from "./lib/emailTemplates";

const ROLE = v.union(v.literal("admin"), v.literal("member"));

const DEFAULT_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // 14 dagen

// WP19b A-invariant 10: het bericht bij een uitnodiging, in code points.
export const INVITE_MESSAGE_MAX_LENGTH = 1000;

function generateToken(): string {
  return crypto.randomUUID();
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

/**
 * WP19b A-invariant 10: een adres met precies één `@`, een niet-lege kant
 * links en rechts, en geen spaties. Geeft het genormaliseerde adres.
 */
function validInviteEmail(raw: string): string {
  const email = normalizeEmail(raw);
  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1] || /\s/.test(email)) {
    throw new ConvexError({ code: "EMAIL_INVALID" });
  }
  return email;
}

/** Getrimd; leeg telt als geen bericht. */
function validInviteMessage(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const message = raw.trim();
  if (message.length === 0) return undefined;
  if ([...message].length > INVITE_MESSAGE_MAX_LENGTH) {
    throw new ConvexError({ code: "MESSAGE_TOO_LONG" });
  }
  return message;
}

// WP19b A-invariant 5, 8 en 10 (besluit 2, V1): uitnodigen met naam, e-mail,
// groep, en optioneel rol en bericht. Alleen een admin (WP28 W6), altijd met
// een groep (A-keuze 1). De volgorde van de gates blijft zoals WP28/WP29:
// eerst admin, dan EMAIL_BEING_DELETED, dan lid of dubbel. Een weigering op
// "al lid" of "al uitgenodigd" draagt het genormaliseerde adres, zodat de
// app het kan noemen. Geeft alleen het id terug, nooit het token.
export const create = mutation({
  args: {
    email: v.string(),
    name: v.string(),
    groupId: v.id("groups"),
    role: v.optional(ROLE),
    message: v.optional(v.string()),
  },
  returns: v.object({ inviteId: v.id("invites") }),
  handler: async (ctx, args) => {
    // WP28 besluit 6 (W6): alleen een admin nodigt uit. Geen lid of onbekende
    // groep: NOT_MEMBER; lid zonder admin-rol: NOT_ALLOWED.
    const { user } = await requireAdminForWrite(ctx, args.groupId);
    const name = validName(args.name, "NAME_REQUIRED");
    const email = validInviteEmail(args.email);
    const message = validInviteMessage(args.message);

    // WP29 fix 8: geen uitnodiging (en geen mail) aan iemand wiens account
    // nu wordt verwijderd. Fix-cyclus 2: pas na de admin-check (geen
    // e-mail-orakel voor niet-admins), maar vóór de check op "al lid".
    if (await isEmailBeingDeleted(ctx.db, email)) {
      // Fix-cyclus 1, A-invariant 19 (N1): een code met het adres.
      throw new ConvexError({ code: "EMAIL_BEING_DELETED", email });
    }

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existingUser && (await getMembership(ctx, existingUser._id, args.groupId))) {
      throw new ConvexError({ code: "ALREADY_MEMBER", email });
    }

    // Een open, niet verlopen uitnodiging voor dezelfde groep is dubbel. Een
    // verlopen uitnodiging (expiresAt <= now) blokkeert niet.
    const now = Date.now();
    const duplicate = (await findInvitesByEmail(ctx, email)).find(
      (i) => i.status === "pending" && i.expiresAt > now && i.groupId === args.groupId,
    );
    if (duplicate) throw new ConvexError({ code: "ALREADY_INVITED", email });

    const inviteId = await ctx.db.insert("invites", {
      email,
      invitedBy: user._id,
      groupId: args.groupId,
      role: args.role ?? "member",
      name,
      ...(message !== undefined ? { message } : {}),
      token: generateToken(),
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

    return { inviteId };
  },
});

/** WP24: de cover, als die in een album van die groep staat (en de foto bestaat). */
async function visibleGroupCover(ctx: QueryCtx, group: Doc<"groups">): Promise<Doc<"photos"> | null> {
  if (!group.coverPhotoId) return null;
  const cover = await ctx.db.get(group.coverPhotoId);
  if (!cover) return null;
  return (await isPublishedInGroup(ctx, cover._id, group._id)) ? cover : null;
}

// WP19b invariant 6, A-invariant 6, 14, 15: de ontvangen uitnodigingen van de
// caller. Alleen die nu accepteerbaar zijn, voor het adres van zijn users-rij,
// nieuwste eerst. Veld-whitelist (WP23): geen token, geen e-mailadres, geen
// invitedBy, geen naam die de admin typte, geen tijden behalve geldig tot. De
// groep met `hasCover` en zonder foto-id: het beeld loopt via
// `/beeld/uitnodiging/<inviteId>`. Anoniem of zonder rij: lege lijst.
export const listReceived = query({
  args: {},
  returns: v.array(inviteReceived),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await activeUserBySubject(ctx.db, identity.subject);
    if (!user) return [];
    const invites = await acceptableInvitesFor(ctx, user.email, Date.now());
    const out = [];
    for (const invite of invites) {
      const group = await ctx.db.get(invite.groupId!);
      if (!group) continue;
      const inviter = await ctx.db.get(invite.invitedBy);
      // WP19c A-invariant 12: bij de cover alleen zijn stand, zodat de kaart
      // *klein* rechtop toont. Dezelfde waarde die een lid krijgt.
      const cover = await visibleGroupCover(ctx, group);
      out.push({
        ...pick(invite, inviteReceivedFields),
        group: {
          ...pick(group, receivedGroupFields),
          hasCover: cover !== null,
          ...(cover?.exifOrientation !== undefined ? { coverOrientation: cover.exifOrientation } : {}),
        },
        inviter: inviter
          ? { ...pick(inviter, publicProfileFields), ...(await avatarFieldsOf(ctx, inviter)) }
          : null,
      });
    }
    return out;
  },
});

// WP19b A-invariant 12 (besluit 2, V3): de open, niet verlopen uitnodigingen
// van een groep, voor een admin van die groep. Nieuwste eerst. Een lid zonder
// admin-rol: NOT_ALLOWED; geen lid of onbekende groep: NOT_MEMBER.
export const listForGroup = query({
  args: { groupId: v.id("groups") },
  returns: v.array(inviteForAdmin),
  handler: async (ctx, { groupId }) => {
    await requireAdminForWrite(ctx, groupId);
    const now = Date.now();
    const rows = await ctx.db
      .query("invites")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    return rows
      .filter((i) => i.status === "pending" && i.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((i) => pick(i, inviteForAdminFields));
  },
});

/**
 * WP19b A-invariant 7: de uitnodiging achter een id, als die nu accepteerbaar
 * is en voor het adres van de caller. Anders één weigering, `INVITE_INVALID`
 * (van een ander adres, onbekend, ingetrokken, verlopen, al beantwoord, groep
 * weg, uitnodiger geen admin, zonder groep): zo verraadt hij niet of een id
 * bestaat.
 */
async function requireOwnAcceptableInvite(
  ctx: MutationCtx,
  user: Doc<"users">,
  invite: Doc<"invites"> | null,
): Promise<Doc<"invites"> & { groupId: Id<"groups"> }> {
  if (
    !invite ||
    invite.email !== normalizeEmail(user.email) ||
    !invite.groupId ||
    !(await isInviteAcceptable(ctx, invite, Date.now()))
  ) {
    refuse("INVITE_INVALID");
  }
  return invite as Doc<"invites"> & { groupId: Id<"groups"> };
}

// WP19b invariant 7, A-invariant 7: accepteren op het id uit `listReceived`.
// Geeft de groep terug (WP28 H2): de app gaat daarheen.
export const accept = mutation({
  args: { inviteId: v.id("invites") },
  returns: v.object({ groupId: v.id("groups") }),
  handler: async (ctx, { inviteId }) => {
    const user = await requireCurrentUser(ctx);
    const invite = await requireOwnAcceptableInvite(ctx, user, await ctx.db.get(inviteId));
    const now = Date.now();

    await ctx.db.patch(invite._id, { status: "accepted", respondedAt: now });

    const existing = await getMembership(ctx, user._id, invite.groupId);
    const desiredRole = invite.role ?? "member";
    if (!existing) {
      await ctx.db.insert("memberships", {
        userId: user._id,
        groupId: invite.groupId,
        role: desiredRole,
        joinedAt: now,
      });
    } else if (existing.role !== "admin" && desiredRole === "admin") {
      // Upgrade: bestaand lid wordt admin. Geen downgrade van admin → lid.
      await ctx.db.patch(existing._id, { role: "admin" });
    }

    // Notify inviter — best-effort gequeue'd action.
    await ctx.scheduler.runAfter(0, internal.invites.sendInviteEmail, {
      kind: "accepted",
      inviteId: invite._id,
    });
    return { groupId: invite.groupId };
  },
});

// WP19b invariant 7, A-invariant 7: afwijzen op id. Een eigen, al afgewezen
// uitnodiging nog eens afwijzen geeft geen fout en geen tweede mail
// (refresh, twee keer tikken). Al het andere dat niet accepteerbaar is:
// INVITE_INVALID.
export const decline = mutation({
  args: { inviteId: v.id("invites") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const user = await requireCurrentUser(ctx);
    const row = await ctx.db.get(inviteId);
    if (row && row.status === "declined" && row.email === normalizeEmail(user.email)) {
      return null;
    }
    const invite = await requireOwnAcceptableInvite(ctx, user, row);

    await ctx.db.patch(invite._id, { status: "declined", respondedAt: Date.now() });

    await ctx.scheduler.runAfter(0, internal.invites.sendInviteEmail, {
      kind: "declined",
      inviteId: invite._id,
    });
    return null;
  },
});

// Sender-view: eigen verstuurde invites (alle statussen, audit/history).
// Audit-8: gebruikt by_invitedBy index ipv full-table scan.
// WP23 (A-keuze 8): invite-vorm zonder token, invitedBy, respondedAt, bouncedAt.
export const listMine = query({
  args: {},
  returns: v.array(inviteSender),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await activeUserBySubject(ctx.db, identity.subject);
    if (!user) return [];
    const rows = await ctx.db
      .query("invites")
      .withIndex("by_invitedBy", (q) => q.eq("invitedBy", user._id))
      .collect();
    return rows.map((i) => pick(i, inviteSenderFields));
  },
});

// WP19b A-invariant 12 (besluit 2, V3): intrekken kan alleen een admin van de
// groep van de uitnodiging, ook de afzender alleen zolang hij admin is. Geen
// lid, onbekende groep, onbekend id of een uitnodiging zonder groep:
// NOT_MEMBER (geen bestaans-orakel); lid zonder admin-rol: NOT_ALLOWED. Een
// geaccepteerde uitnodiging blijft staan (geschiedenis van het lidmaatschap).
// De genodigde krijgt geen mail.
export const remove = mutation({
  args: { inviteId: v.id("invites") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    await requireCurrentUser(ctx);
    const invite = await ctx.db.get(inviteId);
    if (!invite || !invite.groupId) refuse("NOT_MEMBER");
    await requireAdminForWrite(ctx, invite.groupId);
    if (invite.status === "accepted") {
      throw new Error("Geaccepteerde invite kan niet meer ingetrokken worden");
    }
    await ctx.db.delete(inviteId);
    return null;
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
// registerFromSession (gespiegeld: expiresAt > now = nog geldig).
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
    // index op users werkt direct. Kan null zijn als de ontvanger er geen
    // account (meer) heeft.
    const recipientUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", invite.email))
      .unique();
    // WP19b A-invariant 4: geen token meer; wel naam en bericht voor de mail.
    return {
      invite: {
        email: invite.email,
        ...(invite.name !== undefined ? { name: invite.name } : {}),
        ...(invite.message !== undefined ? { message: invite.message } : {}),
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

// WP19c invariant 2–5, A-invariant 1–7: de groepsfoto voor de mail, of
// `null`. Welke foto beslist `images.inviteMailCover`; de pixels maakt de
// Node-action `inviteMail.coverAttachment` (sharp). Die wordt alleen
// aangeroepen als er een cover is. Mislukt er iets, dan gaat de mail zonder
// foto: de uitnodiging faalt er niet op.
async function inviteMailPhoto(
  ctx: ActionCtx,
  inviteId: Id<"invites">,
): Promise<{ base64Content: string; width: number } | null> {
  try {
    const cover = await ctx.runQuery(internal.images.inviteMailCover, { inviteId });
    if (!cover) return null;
    return await ctx.runAction(internal.inviteMail.coverAttachment, cover);
  } catch (e) {
    console.error(
      `[sendInviteEmail] groepsfoto mislukt inviteId=${inviteId}, de mail gaat zonder foto: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

// WP19c besluit 3, A-invariant 9: de vaste link naar de app in de App Store.
// De Apple ID komt uit `CLUBALMANAC_APP_STORE_ID` en geldt alleen als 6–12
// cijfers. Anders geen link, en een fout in de log (niet stil); de mail gaat.
const APP_STORE_ID_ENV = "CLUBALMANAC_APP_STORE_ID";

function appStoreUrlFromEnv(): string | undefined {
  const raw = process.env[APP_STORE_ID_ENV];
  if (raw !== undefined && /^\d{6,12}$/.test(raw)) return `https://apps.apple.com/app/id${raw}`;
  console.error(
    `[sendInviteEmail] ${APP_STORE_ID_ENV} ${raw === undefined || raw === "" ? "ontbreekt" : "is geen Apple ID (6–12 cijfers)"}; de uitnodiging gaat zonder App Store-link`,
  );
  return undefined;
}

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
      // WP19b A-invariant 4 en 13: geen link en geen token; wel het adres
      // waarmee de genodigde inlogt, de aanhef en het bericht.
      // WP19c: de groepsfoto als inline-bijlage en de App Store-link.
      const photo = await inviteMailPhoto(ctx, inviteId);
      const appStoreUrl = appStoreUrlFromEnv();
      const tpl = inviteTemplate({
        inviterName,
        groupName,
        inviteeName: data.invite.name,
        inviteeEmail: data.invite.email,
        message: data.invite.message,
        expirationDate: formatNlDate(data.invite.expiresAt),
        ...(photo ? { photo: { width: photo.width } } : {}),
        ...(appStoreUrl ? { appStoreUrl } : {}),
      });
      await sendMailjetMessage({
        from: { email: INVITES_SENDER },
        to: [{ email: data.invite.email }],
        subject: tpl.subject,
        htmlPart: tpl.htmlPart,
        textPart: tpl.textPart,
        ...(photo
          ? {
              inlinedAttachments: [
                {
                  contentType: "image/jpeg",
                  filename: INVITE_PHOTO_FILENAME,
                  contentId: INVITE_PHOTO_CONTENT_ID,
                  base64Content: photo.base64Content,
                },
              ],
            }
          : {}),
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
