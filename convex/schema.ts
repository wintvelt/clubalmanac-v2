import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Schema voor Clubalmanac v2.
// Vertaling van het single-table DynamoDB design (zie docs/migratie-plan-convex.md)
// naar aparte Convex tables. Velden gemarkeerd v.optional(...) zijn nullable
// of pas in latere fasen verplicht.

export default defineSchema({
  // ──────────────────────────────────────────────────────────────────
  // Users
  // ──────────────────────────────────────────────────────────────────
  // Vervangt USER / UB / UV / US / UP records uit DynamoDB.
  // Auth identity (Clerk subject) → "subject" veld voor lookup vanuit ctx.auth.
  users: defineTable({
    // Clerk identity subject (user_xxx). Bron van waarheid voor auth.
    subject: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    // Storage ID van profielfoto in Convex file storage (later naar R2).
    profilePhotoStorageId: v.optional(v.id("_storage")),
    // Denormalized stats — onderhouden door mutations, periodiek gevalideerd.
    photoCount: v.number(),
    // Limiet voor uploads. Default in createUser mutation.
    photoLimit: v.number(),
    // Laatste activiteit (voor visit-tracking, was UV record).
    lastVisitAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_subject", ["subject"])
    .index("by_email", ["email"]),

  // ──────────────────────────────────────────────────────────────────
  // Groups
  // ──────────────────────────────────────────────────────────────────
  // Vervangt GB records.
  groups: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    coverPhotoId: v.optional(v.id("photos")),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_createdBy", ["createdBy"]),

  // Lidmaatschap user ↔ group. Vervangt UM records.
  memberships: defineTable({
    userId: v.id("users"),
    groupId: v.id("groups"),
    role: v.union(v.literal("admin"), v.literal("member")),
    joinedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_group", ["groupId"])
    .index("by_user_and_group", ["userId", "groupId"]),

  // ──────────────────────────────────────────────────────────────────
  // Albums
  // ──────────────────────────────────────────────────────────────────
  // Vervangt GA records.
  albums: defineTable({
    groupId: v.id("groups"),
    name: v.string(),
    description: v.optional(v.string()),
    coverPhotoId: v.optional(v.id("photos")),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_group", ["groupId"]),

  // Photo ↔ album koppeling (many-to-many). Vervangt GP records.
  albumPhotos: defineTable({
    albumId: v.id("albums"),
    photoId: v.id("photos"),
    groupId: v.id("groups"), // gedupliceerd voor efficient query
    addedAt: v.number(),
    addedBy: v.id("users"),
  })
    .index("by_album", ["albumId"])
    .index("by_photo", ["photoId"])
    .index("by_group", ["groupId"])
    // Range scan voor unread count per album (AP1).
    .index("by_album_added", ["albumId", "addedAt"]),

  // ──────────────────────────────────────────────────────────────────
  // Photos
  // ──────────────────────────────────────────────────────────────────
  // Vervangt PO records.
  photos: defineTable({
    ownerId: v.id("users"),
    storageId: v.id("_storage"),
    // Origineel bestandsnaam, mime type.
    filename: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    // EXIF / geocoding (gevuld door action na upload).
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    takenAt: v.optional(v.number()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    locationLabel: v.optional(v.string()),
    // Aggregate rating (gemiddelde van ratings table).
    ratingAverage: v.optional(v.number()),
    ratingCount: v.number(),
    // Flagging (FL1: auto-delete na 14 dagen, FL2: appeal + admin decision).
    flaggedAt: v.optional(v.number()),
    flaggedBy: v.optional(v.id("users")),
    flagReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_takenAt", ["takenAt"])
    .index("by_flagged", ["flaggedAt"]),

  // ──────────────────────────────────────────────────────────────────
  // Ratings
  // ──────────────────────────────────────────────────────────────────
  // Vervangt UF records.
  ratings: defineTable({
    photoId: v.id("photos"),
    userId: v.id("users"),
    value: v.number(), // bv. 1..5
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_photo", ["photoId"])
    .index("by_user", ["userId"])
    .index("by_photo_and_user", ["photoId", "userId"]),

  // ──────────────────────────────────────────────────────────────────
  // Invites
  // ──────────────────────────────────────────────────────────────────
  // Invite-only signup: pre-signup checkt of email een open invite heeft.
  invites: defineTable({
    email: v.string(),
    invitedBy: v.id("users"),
    // Optioneel: invite voor specifieke group.
    groupId: v.optional(v.id("groups")),
    role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
    // Token voor public invite-pagina.
    token: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("expired"),
    ),
    expiresAt: v.number(),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_token", ["token"])
    .index("by_status", ["status"]),

  // ──────────────────────────────────────────────────────────────────
  // Features (feature requests + upvoting + problem reports)
  // ──────────────────────────────────────────────────────────────────
  features: defineTable({
    type: v.union(v.literal("feature"), v.literal("problem")),
    title: v.string(),
    description: v.string(),
    submittedBy: v.id("users"),
    status: v.union(
      v.literal("open"),
      v.literal("planned"),
      v.literal("inProgress"),
      v.literal("done"),
      v.literal("rejected"),
    ),
    upvoteCount: v.number(),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_submittedBy", ["submittedBy"]),

  // Upvotes (apart om dubbele votes te voorkomen).
  featureUpvotes: defineTable({
    featureId: v.id("features"),
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_feature", ["featureId"])
    .index("by_feature_and_user", ["featureId", "userId"]),

  // ──────────────────────────────────────────────────────────────────
  // Album last-seen (per user × album)
  // ──────────────────────────────────────────────────────────────────
  // Vervangt de oude `seenPics` array op memberships (cascade matrix
  // AP1 + AP2). Eén record per (user, album) met laatste open-tijdstip;
  // unread count wordt live berekend via range scan op albumPhotos.
  albumLastSeen: defineTable({
    userId: v.id("users"),
    albumId: v.id("albums"),
    lastSeenAt: v.number(),
  })
    .index("by_user_album", ["userId", "albumId"])
    .index("by_user", ["userId"]) // U9 cascade
    .index("by_album", ["albumId"]), // A2 cascade
});
