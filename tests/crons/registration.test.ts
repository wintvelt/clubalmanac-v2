import { describe, expect, it } from "vitest";
import { getFunctionName } from "convex/server";
import crons from "../../convex/crons";
import { internal } from "../../convex/_generated/api";

// Cron registration pin (WP4 component 1).
//
// Audit-13 cyclus toonde dat een productie-cron simpelweg ontbreken een
// silent-fail-modus is — `npm test` blijft groen, runtime weet niet beter,
// pas op deploy of in productie merk je dat een job nooit liep. Deze test
// pin't statisch dat de daily cron-registraties voor FL1 en UI1 bestaan,
// met juiste schedule en juiste function-reference. Geen Convex runtime,
// geen netwerk, geen `convex-test`.
//
// Cascade-matrix mapping:
//   FL1 — `cleanup flagged photos` daily 03:00 UTC → internal.photos.cleanupFlaggedPhotos
//   UI1 — `cleanup old upload idempotency` daily 03:30 UTC → internal.uploads.cleanupOld
//   IB2 — `expire pending invites` daily 04:00 UTC → internal.invites.expirePendingInvites
//         (04:00 gespreid na FL1 03:00 + UI1 03:30, geen runtime-overlap)

describe("convex/crons.ts — cron registration", () => {
  it("FL1: 'cleanup flagged photos' is daily 03:00 UTC en verwijst naar internal.photos.cleanupFlaggedPhotos", () => {
    const job = crons.crons["cleanup flagged photos"];
    if (!job) throw new Error("cron 'cleanup flagged photos' niet geregistreerd");
    expect(job.schedule).toEqual({
      type: "daily",
      hourUTC: 3,
      minuteUTC: 0,
    });
    expect(job.name).toBe(getFunctionName(internal.photos.cleanupFlaggedPhotos));
  });

  it("UI1: 'cleanup old upload idempotency' is daily 03:30 UTC en verwijst naar internal.uploads.cleanupOld", () => {
    const job = crons.crons["cleanup old upload idempotency"];
    if (!job) throw new Error("cron 'cleanup old upload idempotency' niet geregistreerd");
    expect(job.schedule).toEqual({
      type: "daily",
      hourUTC: 3,
      minuteUTC: 30,
    });
    expect(job.name).toBe(getFunctionName(internal.uploads.cleanupOld));
  });

  it("IB2: 'expire pending invites' is daily 04:00 UTC en verwijst naar internal.invites.expirePendingInvites", () => {
    const job = crons.crons["expire pending invites"];
    if (!job) throw new Error("cron 'expire pending invites' niet geregistreerd");
    expect(job.schedule).toEqual({
      type: "daily",
      hourUTC: 4,
      minuteUTC: 0,
    });
    expect(job.name).toBe(
      getFunctionName(internal.invites.expirePendingInvites),
    );
  });

  it("registreert exact deze drie crons (geen onbedoelde extra registraties)", () => {
    const ids = Object.keys(crons.crons).sort();
    expect(ids).toEqual(
      [
        "cleanup flagged photos",
        "cleanup old upload idempotency",
        "expire pending invites",
      ].sort(),
    );
  });
});
