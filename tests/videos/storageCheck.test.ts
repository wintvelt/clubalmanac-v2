import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import crons from "../../convex/crons";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DAY_MS, ENV, FIXED_NOW, HOUR_MS, newT, PLAIN, seedVideo, seedWorld, useVideosEnv, videosInternal, WEBMASTER, type T } from "./_videos";

// WP37 — de dagelijkse R2-check en de opruimronde.
//   Invariant 5: geen wezen die niemand ziet. A-invariant 20: een video-
//   upload blijft een dag open, daarna gaan reservering en object weg.
//   A-invariant 22: de check meldt wees-objecten (geen rij, geen open
//   reservering, ouder dan een dag), ontbrekende bestanden (rij zonder
//   object), een grootte die afwijkt van `video.bytes` en objecten boven
//   120 MiB (fixronde 1), met één mail aan de webmaster; schoon = geen mail.
//   De check wist niets (WP10-discipline: melden, niet herstellen).
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §A-invarianten.

const env = useVideosEnv();

async function check(t: T) {
  await t.action(videosInternal.checkStorage, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

function mailText(): string {
  return JSON.stringify(env.r2.mails);
}

async function openVideoReservation(t: T, ownerId: Id<"users">, key: string, createdAt = Date.now()) {
  return await t.run(async (ctx) =>
    ctx.db.insert("uploadIdempotency", {
      ownerId,
      clientUploadId: `open-${key}`,
      status: "in_progress",
      createdAt,
      videoKey: key,
    } as never),
  );
}

describe("videos.checkStorage (A-invariant 22)", () => {
  it("rijen en objecten kloppen: geen mail, niets gewist", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie });
    await check(t);
    expect(env.r2.mails).toEqual([]);
    expect(env.r2.deletes()).toEqual([]);
  });

  it("een object zonder rij, ouder dan een dag: één mail aan de webmaster; het object blijft", async () => {
    const t = newT();
    await seedWorld(t);
    env.r2.put("videos/wees.mp4", PLAIN, FIXED_NOW - DAY_MS - HOUR_MS);
    await check(t);
    expect(env.r2.mails).toHaveLength(1);
    expect(mailText()).toContain(WEBMASTER);
    expect(env.r2.deletes()).toEqual([]);
    expect(env.r2.objects.has("videos/wees.mp4")).toBe(true);
  });

  it("een object zonder rij van vandaag: nog geen wees", async () => {
    const t = newT();
    await seedWorld(t);
    env.r2.put("videos/net-binnen.mp4", PLAIN, FIXED_NOW - HOUR_MS);
    await check(t);
    expect(env.r2.mails).toEqual([]);
  });

  it("een object van een open video-upload is geen wees", async () => {
    const t = newT();
    const w = await seedWorld(t);
    env.r2.put("videos/bezig.mp4", PLAIN, FIXED_NOW - DAY_MS - HOUR_MS);
    await openVideoReservation(t, w.users.alice, "videos/bezig.mp4", FIXED_NOW - 2 * HOUR_MS);
    await check(t);
    expect(env.r2.mails).toEqual([]);
  });

  it("een rij waarvan het object ontbreekt: mail met het foto-id", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const v = await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie, inR2: false });
    await check(t);
    expect(env.r2.mails).toHaveLength(1);
    expect(mailText()).toContain(v.photoId);
  });

  it("de mail bevat geen geheim en geen ondertekende link", async () => {
    const t = newT();
    await seedWorld(t);
    env.r2.put("videos/wees.mp4", PLAIN, FIXED_NOW - 2 * DAY_MS);
    await check(t);
    expect(mailText()).not.toContain(ENV.R2_SECRET_ACCESS_KEY);
    expect(mailText()).not.toContain("X-Amz-Signature");
  });

  it("R2 onbereikbaar: één mail, geen fout", async () => {
    const t = newT();
    await seedWorld(t);
    env.r2.down = true;
    await check(t);
    expect(env.r2.mails).toHaveLength(1);
  });

  it("R2-config ontbreekt: één mail met de naam van de env-var", async () => {
    const t = newT();
    await seedWorld(t);
    delete process.env.R2_ENDPOINT;
    await check(t);
    expect(env.r2.mails).toHaveLength(1);
    expect(mailText()).toContain("R2_ENDPOINT");
  });

  it("zonder WEBMASTER_EMAILS: geen mail en geen fout", async () => {
    const t = newT();
    await seedWorld(t);
    delete process.env.WEBMASTER_EMAILS;
    env.r2.put("videos/wees.mp4", PLAIN, FIXED_NOW - 2 * DAY_MS);
    await check(t);
    expect(env.r2.mails).toEqual([]);
  });

  it("elk verzoek naar R2 is ondertekend", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await seedVideo(t, env.r2, { ownerId: w.users.alice });
    await check(t);
    expect(env.r2.calls.length).toBeGreaterThan(0);
    for (const c of env.r2.calls) expect(c.signed).toBe(true);
  });

  it("een object waarvan de grootte afwijkt van video.bytes: mail met het foto-id; niets gewist (fixronde 1)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const v = await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie });
    env.r2.sizes.set(v.key, PLAIN.byteLength + 4096);
    await check(t);
    expect(env.r2.mails).toHaveLength(1);
    expect(mailText()).toContain(v.photoId);
    expect(env.r2.deletes()).toEqual([]);
  });

  it("een object boven 120 MiB, ook onder uploads/ van een open upload: mail (fixronde 1)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    env.r2.put("uploads/groot.mp4", PLAIN, FIXED_NOW - HOUR_MS);
    env.r2.sizes.set("uploads/groot.mp4", 120 * 1024 * 1024 + 1);
    await openVideoReservation(t, w.users.alice, "uploads/groot.mp4", FIXED_NOW - HOUR_MS);
    await check(t);
    expect(env.r2.mails).toHaveLength(1);
    expect(env.r2.deletes()).toEqual([]);
  });

  it("precies de juiste grootte en precies 120 MiB: geen mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const v = await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie });
    await t.run(async (ctx) => {
      const row = await ctx.db.get(v.photoId);
      await ctx.db.patch(v.photoId, { video: { ...(row as unknown as { video: { key: string; durationMs: number } }).video, bytes: 120 * 1024 * 1024 } } as never);
    });
    env.r2.sizes.set(v.key, 120 * 1024 * 1024);
    await check(t);
    expect(env.r2.mails).toEqual([]);
  });

  it("cron 'video storage check': dagelijks 05:15 UTC", () => {
    const job = crons.crons["video storage check"];
    if (!job) throw new Error("cron 'video storage check' niet geregistreerd");
    expect(job.schedule).toEqual({ type: "daily", hourUTC: 5, minuteUTC: 15 });
    expect(job.name).toBe(getFunctionName(videosInternal.checkStorage));
  });
});

describe("uploads.cleanupOld en video-uploads (A-invariant 20)", () => {
  async function cleanup(t: T) {
    await t.mutation(internal.uploads.cleanupOld, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  }
  async function reservations(t: T) {
    return await t.run(async (ctx) => ctx.db.query("uploadIdempotency").collect());
  }

  it("een open video-upload van een uur blijft (een foto-reservering van een uur niet)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    env.r2.put("videos/bezig.mp4", PLAIN);
    await openVideoReservation(t, w.users.alice, "videos/bezig.mp4", FIXED_NOW - HOUR_MS);
    await t.run(async (ctx) =>
      ctx.db.insert("uploadIdempotency", { ownerId: w.users.alice, clientUploadId: "foto", status: "in_progress", createdAt: FIXED_NOW - HOUR_MS }),
    );
    await cleanup(t);
    const left = await reservations(t);
    expect(left.map((r) => r.clientUploadId)).toEqual(["open-videos/bezig.mp4"]);
    expect(env.r2.objects.has("videos/bezig.mp4")).toBe(true);
  });

  it("een open video-upload van meer dan een dag: reservering en object weg", async () => {
    const t = newT();
    const w = await seedWorld(t);
    env.r2.put("videos/oud.mp4", PLAIN);
    await openVideoReservation(t, w.users.alice, "videos/oud.mp4", FIXED_NOW - DAY_MS - 60_000);
    await cleanup(t);
    expect(await reservations(t)).toEqual([]);
    expect(env.r2.deletes()).toEqual(["videos/oud.mp4"]);
    expect(env.r2.objects.size).toBe(0);
  });

  it("een open video-upload zonder object (nooit geüpload): reservering weg, geen fout", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await openVideoReservation(t, w.users.alice, "videos/nooit.mp4", FIXED_NOW - 2 * DAY_MS);
    await cleanup(t);
    expect(await reservations(t)).toEqual([]);
  });

  it("een afgeronde video-reservering van 8 dagen: reservering weg, het filmpje blijft", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const v = await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie });
    await t.run(async (ctx) =>
      ctx.db.insert("uploadIdempotency", {
        ownerId: w.users.alice,
        clientUploadId: "klaar",
        status: "completed",
        photoId: v.photoId,
        createdAt: FIXED_NOW - 8 * DAY_MS,
        completedAt: FIXED_NOW - 8 * DAY_MS,
        videoKey: v.key,
      } as never),
    );
    await cleanup(t);
    expect(await reservations(t)).toEqual([]);
    expect(env.r2.deletes()).toEqual([]);
    expect(env.r2.objects.has(v.key)).toBe(true);
  });
});
