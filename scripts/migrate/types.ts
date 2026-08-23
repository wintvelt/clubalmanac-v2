// WP12 — gedeelde types + tabel-metadata voor de migratie-tooling.
//
// Zie docs/work-packages/WP12-data-migratie-tooling.md §Transform-outputcontract.
// Eén bron voor: welke tabellen er zijn, in welke volgorde ze geladen worden,
// welke velden foreign keys zijn, en welke velden een S3-sleutel dragen.
// `transform`, `load-files`, `load-records` en `verify` leunen alle vier op deze
// tabel — hem hier centraal houden voorkomt dat ze uit elkaar lopen.

/** Eén reeds-ge-unmarshalled DynamoDB-item, zoals `extract` het wegschrijft. */
export type SourceItem = Record<string, unknown>;

/** Eén Convex-vormige rij. `sourceKey` = de natuurlijke bron-ID. */
export type Row = Record<string, unknown> & { sourceKey: string };

/**
 * Laadvolgorde (WP12 §Volgorde binnen `load-records`). Elke stap vult de
 * ID-map die de volgende nodig heeft. `groups.coverPhotoId` en
 * `albums.coverPhotoId` worden in een aparte pass nagevuld (zie DEFERRED_FKS):
 * groups/albums verwijzen vooruit naar photos, photos verwijst via ownerId
 * terug naar users. Die cirkel is niet in één pass te schrijven.
 */
export const TABLE_ORDER = [
  "users",
  "groups",
  "memberships",
  "albums",
  "photos",
  "albumPhotos",
  "ratings",
  "invites",
  "features",
  "featureUpvotes",
  "albumLastSeen",
] as const;

export type TableName = (typeof TABLE_ORDER)[number];

export type Records = Record<TableName, Row[]>;

export type TransformResult = {
  records: Records;
  warnings: string[];
};

export type FkSpec = { field: string; target: TableName; required: boolean };

/**
 * Foreign keys per tabel. Dezelfde lijst als `REQUIRED_FKS`/`OPTIONAL_FKS` in
 * convex/monitoring.ts — wat de transform hier laat glippen, meldt WP10's
 * integrityCheck vanaf dag één elke dag.
 */
export const FKS: Record<TableName, FkSpec[]> = {
  users: [],
  groups: [
    { field: "createdBy", target: "users", required: true },
    { field: "coverPhotoId", target: "photos", required: false },
  ],
  memberships: [
    { field: "userId", target: "users", required: true },
    { field: "groupId", target: "groups", required: true },
  ],
  albums: [
    { field: "groupId", target: "groups", required: true },
    { field: "createdBy", target: "users", required: true },
    { field: "coverPhotoId", target: "photos", required: false },
  ],
  photos: [
    { field: "ownerId", target: "users", required: true },
    { field: "flaggedBy", target: "users", required: false },
  ],
  albumPhotos: [
    { field: "albumId", target: "albums", required: true },
    { field: "photoId", target: "photos", required: true },
    { field: "groupId", target: "groups", required: true },
    { field: "addedBy", target: "users", required: true },
  ],
  ratings: [
    { field: "photoId", target: "photos", required: true },
    { field: "userId", target: "users", required: true },
  ],
  invites: [
    { field: "invitedBy", target: "users", required: true },
    { field: "groupId", target: "groups", required: false },
  ],
  features: [{ field: "submittedBy", target: "users", required: true }],
  featureUpvotes: [
    { field: "featureId", target: "features", required: true },
    { field: "userId", target: "users", required: true },
  ],
  albumLastSeen: [
    { field: "userId", target: "users", required: true },
    { field: "albumId", target: "albums", required: true },
  ],
};

/**
 * FK's die pas in de tweede pass geschreven worden (na `photos`). Ze worden bij
 * de eerste insert weggelaten en daarna gepatcht.
 */
export const DEFERRED_FKS: Partial<Record<TableName, string[]>> = {
  groups: ["coverPhotoId"],
  albums: ["coverPhotoId"],
};

/**
 * Velden die in de transform-output een **S3-sleutel** dragen en die
 * `load-records` vervangt door het Convex-`_storage`-id uit storage-map.json.
 */
export const STORAGE_FIELDS: Partial<
  Record<TableName, Array<{ from: string; to: string; required: boolean }>>
> = {
  users: [
    { from: "profilePhotoStorageKey", to: "profilePhotoStorageId", required: false },
  ],
  photos: [{ from: "storageKey", to: "storageId", required: true }],
};

/** Velden die alleen de tooling aangaan en nooit naar Convex mogen. */
export const INTERNAL_FIELDS = new Set([
  "sourceKey",
  "storageKey",
  "profilePhotoStorageKey",
]);

export function emptyRecords(): Records {
  return {
    users: [],
    groups: [],
    memberships: [],
    albums: [],
    photos: [],
    albumPhotos: [],
    ratings: [],
    invites: [],
    features: [],
    featureUpvotes: [],
    albumLastSeen: [],
  };
}
