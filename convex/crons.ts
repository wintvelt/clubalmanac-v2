import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { FLAG_CLEANUP_HOUR_UTC } from "./lib/constants";

const crons = cronJobs();

// FL1: dagelijks geflagde photos waar de countdown afgelopen is
// definitief verwijderen. Zie cascade-matrix.md row FL1.
// LET OP (WP20 besluit 6, S1, A-keuze 9): mail en app noemen als laatste dag
// de kalenderdag vóór de eerste ronde op of na `flaggedDeleteDate`. Die regel
// rekent met dit uur: `flagRemovalDay` (lib/emailTemplates, via
// FLAG_CLEANUP_HOUR_UTC) en `removalDay` in app/src/lib/flags.ts. Verander je
// het uur, pas dan ook de app aan (en tests/crons/registration.test.ts).
crons.daily(
  "cleanup flagged photos",
  { hourUTC: FLAG_CLEANUP_HOUR_UTC, minuteUTC: 0 },
  internal.photos.cleanupFlaggedPhotos,
  {},
);

// UI1: dagelijks uploadIdempotency records ouder dan 7d opruimen.
// Zie cascade-matrix.md row UI1. 03:30 UTC zodat het niet samenvalt
// met cleanupFlaggedPhotos op 03:00.
crons.daily(
  "cleanup old upload idempotency",
  { hourUTC: 3, minuteUTC: 30 },
  internal.uploads.cleanupOld,
  {},
);

// IB2: dagelijks pending invites waarvan expiresAt gepasseerd is naar
// status="expired" patchen (natural expiry, stil — geen mail). Zie
// cascade-matrix.md row IB2. 04:00 UTC zodat het niet samenvalt met
// cleanupFlaggedPhotos (03:00) of cleanupOld (03:30).
crons.daily(
  "expire pending invites",
  { hourUTC: 4, minuteUTC: 0 },
  internal.invites.expirePendingInvites,
  {},
);

// WP10: dagelijkse integrity-check (storage-orphans, aggregate-drift,
// FK-integriteit) → detect-only, alert via mail bij drift. Zie
// docs/work-packages/WP10-integrity-monitoring.md. 04:30 UTC, gespreid ná
// IB2 (04:00) zodat geen runtime-overlap met de andere daily crons.
crons.daily(
  "integrity check",
  { hourUTC: 4, minuteUTC: 30 },
  internal.monitoring.integrityCheck,
  {},
);

// WP21 besluit 7 (A-invariant 16): dagelijks één cover lezen met een
// ondertekende S3-link; mail aan de webmaster als dat niet lukt (ingetrokken
// of verlopen sleutel, bucket of lijst weg). 05:00 UTC, na de integrity check.
crons.daily(
  "film link check",
  { hourUTC: 5, minuteUTC: 0 },
  internal.films.checkLinks,
  {},
);

// WP37 A-invariant 22: dagelijks de filmpjes in R2 naast de rijen leggen
// (wees-objecten, ontbrekende bestanden); één mail aan de webmaster als er
// iets is. 05:15 UTC, na de film link check. Wist niets.
crons.daily(
  "video storage check",
  { hourUTC: 5, minuteUTC: 15 },
  internal.videos.checkStorage,
  {},
);

// WP38 A-invariant 9: elk uur de originelen afronden die helemaal in R2
// staan, ook als de app niet meer langskomt (bv. 's nachts op de achtergrond
// binnengekomen).
crons.hourly(
  "film originals complete",
  { minuteUTC: 20 },
  internal.filmProjects.completeUploaded,
  {},
);

// WP38 A-invariant 11, besluit 15 en 18: dagelijks de originelen die een jaar
// binnen zijn weg (rij en object), halve inzendingen van projecten die ze niet
// meer aannemen weg, gesloten projecten zonder originelen weg, en de
// herinnering aan de oprichter. 05:30 UTC, na de video storage check.
crons.daily(
  "film originals expiry",
  { hourUTC: 5, minuteUTC: 30 },
  internal.filmProjects.expireOriginals,
  {},
);

// WP38 A-invariant 14: dagelijks de originelen-bucket naast de inzendingen
// leggen; één mail aan de webmaster als er iets is. 05:45 UTC, na de
// opruimronde van de originelen. Wist niets.
crons.daily(
  "film originals check",
  { hourUTC: 5, minuteUTC: 45 },
  internal.filmProjects.checkStorage,
  {},
);

export default crons;
