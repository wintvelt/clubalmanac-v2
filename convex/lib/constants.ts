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
