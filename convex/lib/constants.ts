// Gedeelde constanten zonder Convex-runtime-afhankelijkheden.
//
// Apart bestand zodat dev-tooling buiten de Convex-bundel (scripts/migrate,
// dat op Node's type-stripping draait) ze kan importeren zonder de hele
// `_generated/server`-keten mee te trekken.

/** Uploadlimiet per user. In AWS stond dit als env-var, niet per user. */
export const DEFAULT_PHOTO_LIMIT = 1000;

/**
 * WP15b: hoogstens één bezoek per user per periode. `users.recordVisit`
 * schrijft alleen als het laatste bezoek minstens zo lang geleden is. De app
 * gebruikt dezelfde periode om aanroepen te besparen.
 */
export const VISIT_PERIOD_MS = 3_600_000;

/** WP15b: maximale lengte van een naam, in tekens (code points), na trim. */
export const NAME_MAX_LENGTH = 50;

/**
 * WP18 A-keuze 4: grootste bestand dat `POST /upload` aanneemt, in bytes
 * (15 MiB). Een omgezette foto (JPEG, langste zijde 4032) is een paar MB; de
 * grens raakt alleen een client die de app omzeilt. Het platform weigert zelf
 * pas boven ~20 MiB, met een fout die de app niet herkent.
 */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
