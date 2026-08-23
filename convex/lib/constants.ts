// Gedeelde constanten zonder Convex-runtime-afhankelijkheden.
//
// Apart bestand zodat dev-tooling buiten de Convex-bundel (scripts/migrate,
// dat op Node's type-stripping draait) ze kan importeren zonder de hele
// `_generated/server`-keten mee te trekken.

/** Uploadlimiet per user. In AWS stond dit als env-var, niet per user. */
export const DEFAULT_PHOTO_LIMIT = 1000;
