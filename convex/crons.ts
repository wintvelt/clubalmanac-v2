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

export default crons;
