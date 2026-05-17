import { v } from "convex/values";
import {
  internalAction,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireCurrentUser } from "./users";
import { getWebmasterEmails, requireWebmaster } from "./lib/auth";
import { INFO_SENDER, sendMailjetMessage } from "./lib/mailjet";
import {
  getStageLabel,
  problemReportTemplate,
} from "./lib/emailTemplates";

const TYPE = v.union(v.literal("feature"), v.literal("problem"));
const STATUS = v.union(
  v.literal("open"),
  v.literal("planned"),
  v.literal("inProgress"),
  v.literal("done"),
  v.literal("rejected"),
);

export const create = mutation({
  args: {
    type: TYPE,
    title: v.string(),
    description: v.string(),
  },
  returns: v.id("features"),
  handler: async (ctx, { type, title, description }) => {
    const user = await requireCurrentUser(ctx);
    const featureId = await ctx.db.insert("features", {
      type,
      title,
      description,
      submittedBy: user._id,
      status: "open",
      upvoteCount: 0,
      createdAt: Date.now(),
    });

    // Problem-reports notificeren webmaster via mail (best-effort
    // gescheduled). Feature-requests sturen geen mail — staan in
    // dashboard via list-query.
    if (type === "problem") {
      await ctx.scheduler.runAfter(
        0,
        internal.features.sendProblemReport,
        { featureId },
      );
    }

    return featureId;
  },
});

export const update = mutation({
  args: {
    featureId: v.id("features"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { featureId, title, description }) => {
    await requireWebmaster(ctx);
    const feature = await ctx.db.get(featureId);
    if (!feature) throw new Error("Feature bestaat niet");

    const patch: Partial<Doc<"features">> = {};
    if (title !== undefined) patch.title = title;
    if (description !== undefined) patch.description = description;
    if (Object.keys(patch).length > 0) await ctx.db.patch(featureId, patch);
  },
});

export const remove = mutation({
  args: { featureId: v.id("features") },
  handler: async (ctx, { featureId }) => {
    await requireWebmaster(ctx);
    const feature = await ctx.db.get(featureId);
    if (!feature) throw new Error("Feature bestaat niet");

    // Cascade upvotes.
    const upvotes = await ctx.db
      .query("featureUpvotes")
      .withIndex("by_feature", (q) => q.eq("featureId", featureId))
      .collect();
    for (const u of upvotes) await ctx.db.delete(u._id);

    await ctx.db.delete(featureId);
  },
});

export const getById = query({
  args: { featureId: v.id("features") },
  handler: async (ctx, { featureId }) => {
    return await ctx.db.get(featureId);
  },
});

export const list = query({
  args: {
    type: v.optional(TYPE),
    status: v.optional(STATUS),
  },
  handler: async (ctx, { type, status }) => {
    if (status) {
      const all = await ctx.db
        .query("features")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      return type ? all.filter((f) => f.type === type) : all;
    }
    const all = await ctx.db.query("features").collect();
    return type ? all.filter((f) => f.type === type) : all;
  },
});

export const upvote = mutation({
  args: { featureId: v.id("features") },
  handler: async (ctx, { featureId }) => {
    const user = await requireCurrentUser(ctx);
    const feature = await ctx.db.get(featureId);
    if (!feature) throw new Error("Feature bestaat niet");

    const existing = await ctx.db
      .query("featureUpvotes")
      .withIndex("by_feature_and_user", (q) =>
        q.eq("featureId", featureId).eq("userId", user._id),
      )
      .unique();
    if (existing) return; // idempotent

    await ctx.db.insert("featureUpvotes", {
      featureId,
      userId: user._id,
      createdAt: Date.now(),
    });
    await ctx.db.patch(featureId, {
      upvoteCount: feature.upvoteCount + 1,
    });
  },
});

export const removeUpvote = mutation({
  args: { featureId: v.id("features") },
  handler: async (ctx, { featureId }) => {
    const user = await requireCurrentUser(ctx);
    const feature = await ctx.db.get(featureId);
    if (!feature) throw new Error("Feature bestaat niet");

    const existing = await ctx.db
      .query("featureUpvotes")
      .withIndex("by_feature_and_user", (q) =>
        q.eq("featureId", featureId).eq("userId", user._id),
      )
      .unique();
    if (!existing) return; // idempotent

    await ctx.db.delete(existing._id);
    await ctx.db.patch(featureId, {
      upvoteCount: Math.max(0, feature.upvoteCount - 1),
    });
  },
});

export const hasUpvoted = query({
  args: { featureId: v.id("features") },
  handler: async (ctx, { featureId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const user = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    if (!user) return false;
    const existing = await ctx.db
      .query("featureUpvotes")
      .withIndex("by_feature_and_user", (q) =>
        q.eq("featureId", featureId).eq("userId", user._id),
      )
      .unique();
    return existing !== null;
  },
});

// ──────────────────────────────────────────────────────────────────
// Problem-report email — naar webmaster(s)
// ──────────────────────────────────────────────────────────────────

// Internal helper-query voor sendProblemReport-action (action heeft geen
// ctx.db). Levert platte DTO + submitter-data. Null als feature inmiddels
// weg is (cascade-race).
export const getProblemReportForEmail = internalQuery({
  args: { featureId: v.id("features") },
  handler: async (ctx, { featureId }) => {
    const feature = await ctx.db.get(featureId);
    if (!feature) return null;
    const submitter = await ctx.db.get(feature.submittedBy);
    return {
      title: feature.title,
      description: feature.description,
      createdAt: feature.createdAt,
      submitter: submitter
        ? {
            name: submitter.name ?? submitter.email,
            email: submitter.email,
          }
        : null,
    };
  },
});

// Problem-report mail naar webmaster(s) uit `WEBMASTER_EMAILS`.
// Best-effort: lege/ontbrekende env-var → no-op (geen webmaster
// geconfigureerd op deze deployment, mag scheduler niet stuk maken).
// Meerdere webmasters → fan-out via één Mailjet-call met meerdere TO's.
export const sendProblemReport = internalAction({
  args: { featureId: v.id("features") },
  handler: async (ctx, { featureId }) => {
    const data = await ctx.runQuery(
      internal.features.getProblemReportForEmail,
      { featureId },
    );
    if (!data) {
      console.log(
        `[sendProblemReport] feature niet meer gevonden featureId=${featureId}, skipping`,
      );
      return;
    }

    const webmasters = getWebmasterEmails();
    if (webmasters.length === 0) {
      console.log(
        `[sendProblemReport] geen WEBMASTER_EMAILS geconfigureerd, skipping`,
      );
      return;
    }

    const submitterName = data.submitter?.name ?? "onbekende gebruiker";
    const submitterEmail = data.submitter?.email ?? "onbekend";

    const tpl = problemReportTemplate({
      submitterName,
      submitterEmail,
      description: data.description,
      title: data.title,
      stage: getStageLabel(),
      timestamp: new Date(data.createdAt).toISOString(),
    });

    await sendMailjetMessage({
      from: { email: INFO_SENDER },
      to: webmasters.map((email) => ({ email })),
      subject: tpl.subject,
      htmlPart: tpl.htmlPart,
      textPart: tpl.textPart,
    });
  },
});
