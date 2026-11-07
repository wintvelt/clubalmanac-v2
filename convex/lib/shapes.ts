import {
  v,
  type Infer,
  type ObjectType,
  type PropertyValidators,
} from "convex/values";

// WP23: vormen voor publieke reads. Eén bron per vorm: het veld-object is
// tegelijk de return-validator (Convex weigert een response met een veld
// erbuiten) en de whitelist voor `pick` (kopieert alleen die velden uit een
// rij). Een nieuw schema-veld verschijnt dus pas in een response als iemand
// het hier bewust toevoegt. Geen spreads van ruwe rijen in publieke queries.
//
// Spec: docs/work-packages/WP23-read-whitelist.md §Vormen. `_creationTime`
// zit in geen enkele vorm.

const ROLE = v.union(v.literal("admin"), v.literal("member"));

/**
 * Per whitelist-veld: het veld moet in de rij bestaan, en het kolomtype moet
 * passen in het validator-type. Anders wordt het veld-type `never` en faalt
 * de aanroep van `pick` bij compile-time (bv. een tikfout in een veldnaam, of
 * een vorm die op de verkeerde tabel wordt toegepast).
 */
type FieldsOf<Row, F extends PropertyValidators> = {
  [K in keyof F]: K extends keyof Row
    ? [Row[K]] extends [Infer<F[K]>]
      ? F[K]
      : never
    : never;
};

/**
 * Kopieert alleen de velden uit `fields` die in de rij een waarde hebben.
 * Gekoppeld aan het rij-type (`Doc<tabel>` op de aanroep-plek) via FieldsOf.
 */
export function pick<Row extends object, F extends PropertyValidators>(
  row: Row,
  fields: F & FieldsOf<Row, F>,
): ObjectType<F> {
  const src = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return out as ObjectType<F>;
}

// ── users ─────────────────────────────────────────────────────────

/**
 * Wat een ander lid van een user ziet. Geen email, subject, tellers, tijden.
 * WP17a invariant 10: geen beeld-id. De profielfoto loopt via het user-id
 * (`GET /beeld/profiel/<userId>`).
 */
export const publicProfileFields = {
  _id: v.id("users"),
  name: v.optional(v.string()),
};
/**
 * WP25 A-invariant 19 en 26: de avatar-velden, van de foto-rij die het
 * profielpad serveert (`lib/profilePhoto`). `profileOrientation` is de stand
 * van die rij; `profileHasFormats` zegt of het profielpad een formaat geeft.
 * Geen kolommen van `users`, dus niet in de `pick`-velden; de query zet ze
 * erbij (`avatarFieldsOf`).
 */
const avatarFields = { profileOrientation: v.optional(v.number()), profileHasFormats: v.boolean() };

export const publicProfile = v.object({ ...publicProfileFields, ...avatarFields });

/**
 * Wat de user van zichzelf ziet. Geen subject, geen photoLimit (A-keuze 10),
 * geen lastVisitAt (WP15b: het bezoek is niet zichtbaar).
 */
export const ownProfileFields = {
  _id: v.id("users"),
  email: v.string(),
  name: v.optional(v.string()),
  photoCount: v.number(),
  createdAt: v.number(),
};
export const ownProfile = v.object({ ...ownProfileFields, ...avatarFields });

// ── groups / memberships ──────────────────────────────────────────

export const groupFields = {
  _id: v.id("groups"),
  name: v.string(),
  description: v.optional(v.string()),
  coverPhotoId: v.optional(v.id("photos")),
  sortDate: v.optional(v.number()),
  createdBy: v.id("users"),
  createdAt: v.number(),
};
export const group = v.object(groupFields);

export const membershipFields = {
  _id: v.id("memberships"),
  userId: v.id("users"),
  groupId: v.id("groups"),
  role: ROLE,
  joinedAt: v.number(),
};
export const membership = v.object(membershipFields);

// ── albums ────────────────────────────────────────────────────────

export const albumFields = {
  _id: v.id("albums"),
  groupId: v.id("groups"),
  name: v.string(),
  description: v.optional(v.string()),
  coverPhotoId: v.optional(v.id("photos")),
  sortDate: v.optional(v.number()),
  createdBy: v.id("users"),
  createdAt: v.number(),
};
export const album = v.object(albumFields);

export const albumPhotoFields = {
  _id: v.id("albumPhotos"),
  albumId: v.id("albums"),
  photoId: v.id("photos"),
  groupId: v.id("groups"),
  addedAt: v.number(),
  addedBy: v.id("users"),
};
export const albumPhoto = v.object(albumPhotoFields);

// ── photos ────────────────────────────────────────────────────────

/**
 * Foto-vorm. Geen `filename`/`mimeType` (A-keuze 3), geen GPS (A-keuze 2),
 * geen flag-velden: die komen er alleen bij via de flag-veldsets hieronder.
 * WP17a invariant 10: geen `storageId`; het beeld loopt via het foto-id
 * (`GET /beeld/foto/<photoId>`), met een toegangscheck per verzoek.
 */
export const photoFields = {
  _id: v.id("photos"),
  ownerId: v.id("users"),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  takenAt: v.optional(v.number()),
  locationLabel: v.optional(v.string()),
  exifOrientation: v.optional(v.number()),
  ratingAverage: v.optional(v.number()),
  ratingCount: v.number(),
  createdAt: v.number(),
};
/**
 * WP25 A-invariant 26: of het beeldpad een formaat geeft (een volledige set)
 * of het origineel. Geen kolom, dus niet in `photoFields`; `photoView` in
 * lib/formatSet zet hem erbij. Altijd aanwezig, en geen id.
 */
export const hasFormatsField = { hasFormats: v.boolean() };
export const photo = v.object({ ...photoFields, ...hasFormatsField });

/** Flag-velden voor de eigenaar: datums, geen melder en geen reden (A-keuze 4). */
export const ownFlagFields = {
  flaggedAt: v.optional(v.number()),
  flaggedDeleteDate: v.optional(v.number()),
  flaggedAppealDate: v.optional(v.number()),
  flaggedAppealDenyDate: v.optional(v.number()),
};

/** Alle flag-velden, incl. melder-identiteit. Alleen voor de webmaster (inv. 9). */
export const allFlagFields = {
  ...ownFlagFields,
  flaggedBy: v.optional(v.id("users")),
  flagReason: v.optional(v.string()),
};

// ── ratings ───────────────────────────────────────────────────────

/** Rating-vorm. Geen `userId` (is altijd de caller), geen tijden (A-keuze 1). */
export const ratingFields = {
  photoId: v.id("photos"),
  value: v.number(),
};
export const rating = v.object(ratingFields);

// ── features ──────────────────────────────────────────────────────

/** Feature-vorm. Geen `submittedBy` (A-keuze 5). */
export const featureFields = {
  _id: v.id("features"),
  type: v.union(v.literal("feature"), v.literal("problem")),
  title: v.string(),
  description: v.string(),
  status: v.union(
    v.literal("open"),
    v.literal("planned"),
    v.literal("inProgress"),
    v.literal("done"),
    v.literal("rejected"),
  ),
  upvoteCount: v.number(),
  createdAt: v.number(),
};
export const feature = v.object(featureFields);

// ── invites ───────────────────────────────────────────────────────

const INVITE_STATUS = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("expired"),
);

/** Invite voor de afzender. Geen token, invitedBy, respondedAt, bouncedAt (A-keuze 8). */
export const inviteSenderFields = {
  _id: v.id("invites"),
  email: v.string(),
  groupId: v.optional(v.id("groups")),
  role: v.optional(ROLE),
  status: INVITE_STATUS,
  expiresAt: v.number(),
  createdAt: v.number(),
};
export const inviteSender = v.object(inviteSenderFields);

/** Groep op de invite-landing: genoeg om te tonen en na accepteren te navigeren. */
export const landingGroupFields = {
  _id: v.id("groups"),
  name: v.string(),
  description: v.optional(v.string()),
};

/**
 * Inviter op de invite-landing. WP17a besluit 8 + invariant 10: het user-id
 * (de landing toont de profielfoto via het openbare profielpad), geen
 * beeld-id. Herziet audit-8 ("geen `_id`").
 */
export const landingInviterFields = {
  _id: v.id("users"),
  name: v.optional(v.string()),
};

/**
 * Invite-landing (anoniem, token = toegangsbewijs). Mét invitee-email (A-keuze
 * 6, herzien 47b65bc); geen token, invitedBy, bouncedAt, `_id` of tijden.
 */
export const inviteLanding = v.object({
  status: INVITE_STATUS,
  isExpired: v.boolean(),
  role: v.optional(ROLE),
  email: v.string(),
  group: v.union(v.object(landingGroupFields), v.null()),
  inviter: v.union(v.object({ ...landingInviterFields, ...avatarFields }), v.null()),
});
