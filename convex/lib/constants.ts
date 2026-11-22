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

/**
 * FL1: het uur (UTC) waarop de dagelijkse opruimronde gemelde foto's wist
 * (convex/crons.ts). WP20 besluit 6, S1: de dag die mail en app noemen hangt
 * hiervan af (lib/emailTemplates `flagRemovalDay`, en in de app
 * `removalDay` in app/src/lib/flags.ts, die het uur zelf kent).
 */
export const FLAG_CLEANUP_HOUR_UTC = 3;

/** WP15b: maximale lengte van een naam, in tekens (code points), na trim. */
export const NAME_MAX_LENGTH = 50;

/**
 * WP18 A-keuze 4: grootste bestand dat `POST /upload` aanneemt, in bytes
 * (15 MiB). Een omgezette foto (JPEG, langste zijde 4032) is een paar MB; de
 * grens raakt alleen een client die de app omzeilt. Het platform weigert zelf
 * pas boven ~20 MiB, met een fout die de app niet herkent.
 */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * WP29 A-invariant 7: zo lang mag een account "wordt verwijderd" staan voordat
 * de integriteitscheck het meldt. Normaal is het binnen minuten weg; blijft
 * het staan, dan is Clerk blijvend mislukt.
 */
export const ACCOUNT_DELETION_REPORT_AFTER_MS = 60 * 60 * 1000;

/**
 * WP37 A-keuze: de langste duur van een filmpje (3:00). De grens telt
 * afgerond op hele seconden, zoals de tegel hem toont: tot 180,499 s mag, dus
 * "3:00" wordt nooit geweigerd (`videoTooLong`).
 */
export const MAX_VIDEO_MS = 180_000;

/** WP37 A-keuze: het grootste filmpje in R2 (120 MiB), ruim boven 3 minuten op 4 Mbit/s. */
export const MAX_VIDEO_BYTES = 120 * 1024 * 1024;

/** WP37 A-invariant 20: zoveel video-uploads mag een user tegelijk open hebben. */
export const MAX_OPEN_VIDEO_UPLOADS = 3;

/** WP37 A-invariant 36: zoveel keer `startUpload` per user in 24 uur (glijdend). */
export const MAX_VIDEO_REQUESTS_PER_DAY = 30;

/** WP37 A-invariant 20: zo lang blijft een video-upload open (een upload van 85 MB kan lang duren). */
export const VIDEO_UPLOAD_OPEN_MS = 24 * 60 * 60 * 1000;

/** Langer dan 3:00, afgerond op hele seconden (A-keuze). */
export function videoTooLong(durationMs: number): boolean {
  return Math.round(durationMs / 1000) > MAX_VIDEO_MS / 1000;
}
