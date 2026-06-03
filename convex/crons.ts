import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// FL1: dagelijks geflagde photos waar de countdown afgelopen is
// definitief verwijderen. Zie cascade-matrix.md row FL1.
crons.daily(
  "cleanup flagged photos",
  { hourUTC: 3, minuteUTC: 0 },
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

export default crons;
