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

// --- WP38: filmproject en originelen ----------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const GIB = 1024 * 1024 * 1024;

/** WP38 A-keuze: een origineel gaat in delen van 32 MiB (alle even groot behalve het laatste). */
export const ORIGINAL_PART_BYTES = 32 * 1024 * 1024;

/** WP38 A-invariant 4: een deel-link geldt 7 dagen (het maximum van SigV4 en R2). */
export const ORIGINAL_PART_LINK_SECONDS = 7 * 24 * 60 * 60;

/** WP38 A-keuze: een downloadlink voor de oprichter geldt 1 uur. */
export const ORIGINAL_DOWNLOAD_SECONDS = 3600;

/** WP38 besluit 11: hooguit 2 GiB per origineel. */
export const MAX_ORIGINAL_BYTES = 2 * GIB;

/** WP38 besluit 11: hooguit 200 GiB per project (binnen en onderweg samen). */
export const MAX_PROJECT_ORIGINAL_BYTES = 200 * GIB;

/** WP38 besluit 11: hooguit 400 GiB voor alle projecten samen. */
export const MAX_TOTAL_ORIGINAL_BYTES = 400 * GIB;

/** WP38 besluit 9, A-invariant 11: een origineel blijft hooguit een jaar na binnenkomst. */
export const ORIGINAL_KEEP_MS = 365 * DAY;

/** WP38 besluit 18: een aangemeld origineel mag tot 14 dagen na het sluiten binnenkomen. */
export const ORIGINAL_ARRIVAL_AFTER_CLOSE_MS = 14 * DAY;

/** WP38 besluit 15: de herinnering aan de oprichter, 30 dagen voordat de eerste originelen weggaan. */
export const ORIGINAL_REMINDER_BEFORE_MS = 30 * DAY;

/**
 * WP38 besluit 13: de einddatum ligt hooguit een jaar vooruit. Een dag extra
 * ruimte, omdat de app het einde van de gekozen dag (23:59 in Nederland)
 * stuurt.
 */
export const FILM_PROJECT_MAX_AHEAD_MS = 366 * DAY;
