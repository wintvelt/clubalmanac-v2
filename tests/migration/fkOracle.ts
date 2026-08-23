// WP12 fix-cyclus 2 (R2-3) — de handmatige oracle voor tabellen en foreign keys.
//
// Deze lijst is met de hand opgeschreven uit `convex/schema.ts` en uit wat WP10
// dagelijks controleert. Hij wordt bewust **niet** afgeleid uit
// `convex/monitoring.ts`, `convex/migration.ts` of `scripts/migrate/types.ts`.
// Dat is geen slordigheid maar de opzet:
//
//   - `transform.ts` gebruikt `FKS` uit types.ts zélf voor zijn slotcontrole.
//     Zou de transform-test diezelfde lijst importeren, dan controleert hij de
//     transform met het materiaal van de transform — precies het patroon dat
//     deze cyclus bestrijdt.
//   - `migration.ts` telt en leegt de tabellen die het zelf opsomt. Een test die
//     over die opsomming loopt krimpt mee als er een tabel uit verdwijnt.
//
// De oracle staat dus buiten alle drie, en `sharedLists.test.ts` klinkt hem aan
// de andere lijsten vast: ze mogen van elkaar verschillen noch stil uit elkaar
// lopen. Verandert het schema, dan is deze lijst de plek waar je het met de hand
// nabouwt en waar de rest zich naar moet voegen.

export type FkOracleEntry = {
  table: string;
  field: string;
  /** Tabel waar de verwijzing in moet resolven. */
  target: string;
  /** Verplicht = altijd gezet én resolvend. Optioneel = leeg mag. */
  required: boolean;
};

/**
 * Élke foreign key die `internal.monitoring.integrityCheck` controleert.
 * Handmatig overgeschreven uit het schema, inclusief de twee op
 * `uploadIdempotency` — die tabel hoort bij de upload-flow, niet bij de
 * brondata, maar WP10 bewaakt hem wel en dus valt hij onder reset + telling.
 */
export const MONITORED_FK_ORACLE: FkOracleEntry[] = [
  { table: "groups", field: "createdBy", target: "users", required: true },
  { table: "groups", field: "coverPhotoId", target: "photos", required: false },
  { table: "memberships", field: "userId", target: "users", required: true },
  { table: "memberships", field: "groupId", target: "groups", required: true },
  { table: "albums", field: "groupId", target: "groups", required: true },
  { table: "albums", field: "createdBy", target: "users", required: true },
  { table: "albums", field: "coverPhotoId", target: "photos", required: false },
  { table: "photos", field: "ownerId", target: "users", required: true },
  { table: "photos", field: "flaggedBy", target: "users", required: false },
  { table: "albumPhotos", field: "albumId", target: "albums", required: true },
  { table: "albumPhotos", field: "photoId", target: "photos", required: true },
  { table: "albumPhotos", field: "groupId", target: "groups", required: true },
  { table: "albumPhotos", field: "addedBy", target: "users", required: true },
  { table: "ratings", field: "photoId", target: "photos", required: true },
  { table: "ratings", field: "userId", target: "users", required: true },
  { table: "invites", field: "invitedBy", target: "users", required: true },
  { table: "invites", field: "groupId", target: "groups", required: false },
  { table: "features", field: "submittedBy", target: "users", required: true },
  { table: "featureUpvotes", field: "featureId", target: "features", required: true },
  { table: "featureUpvotes", field: "userId", target: "users", required: true },
  { table: "albumLastSeen", field: "userId", target: "users", required: true },
  { table: "albumLastSeen", field: "albumId", target: "albums", required: true },
  { table: "uploadIdempotency", field: "ownerId", target: "users", required: true },
  { table: "uploadIdempotency", field: "photoId", target: "photos", required: false },
];

/**
 * Élke tabel die de integriteitsscan aanraakt: de tabellen uit de FK-lijst plus
 * de tabellen waarvan hij een aggregate of de storage-referenties herrekent
 * (`users.photoCount`, `photos.rating*`, `features.upvoteCount`,
 * `users.profilePhotoStorageId`). Dit is de set waar de migratie-tooling op
 * moet werken: leeg-preconditie, reset, en de telling in `verify`.
 */
export const MONITORED_TABLE_ORACLE: string[] = [
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
  "uploadIdempotency",
];

/**
 * De tabel die de import zelf niet vult. Handmatig benoemd, want het verschil
 * tussen "tellen en leegmaken" en "invoegen" is een besluit, geen afleiding.
 */
export const NOT_LOADED_BY_IMPORT = ["uploadIdempotency"];

/** De FK's op tabellen die de import wél vult. */
export const LOAD_FK_ORACLE: FkOracleEntry[] = MONITORED_FK_ORACLE.filter(
  (fk) => !NOT_LOADED_BY_IMPORT.includes(fk.table),
);

export const REQUIRED_FK_ORACLE = LOAD_FK_ORACLE.filter((fk) => fk.required);
export const OPTIONAL_FK_ORACLE = LOAD_FK_ORACLE.filter((fk) => !fk.required);

/** Vergelijkbare sleutel voor een set-gelijkheid over twee FK-lijsten. */
export const fkKey = (fk: { table: string; field: string; required: boolean }): string =>
  `${fk.table}.${fk.field}${fk.required ? "" : "?"}`;
