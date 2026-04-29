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

export default crons;
