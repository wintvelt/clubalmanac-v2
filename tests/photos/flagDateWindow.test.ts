import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { asUser, newT, seedWorld, useWebmasterEnv, type T } from "../readWhitelist/_world";
import { mentionsDay, sentMails, useMailWorld } from "./_wp20";

// WP20 besluit 6, S1 (fix-cyclus 1): de datum die de mail noemt ("na <datum>")
// is een dag waarop de foto de hele dag (NL-tijd) nog bestaat en bezwaar nog
// kan; de foto verdwijnt pas bij de eerste opruimronde daarna (cron FL1,
// dagelijks 03:00 UTC, `flaggedDeleteDate <= now`). Ook bij een melding of
// afwijzing tussen 00:00 en 03:00 UTC.
//
// A-keuze 9 (mechanisme): de genoemde dag is de kalenderdag vóór de eerste
// opruimronde op of na `flaggedDeleteDate`. De opgeslagen datum en de cron
// blijven zoals ze zijn.
//
// Orakel: met de hand uitgerekende dagen, plus de cron zelf draaien op het
// einde van de genoemde dag (NL) en bij de ronde daarna. November = wintertijd,
// NL = UTC+1: de genoemde dag D eindigt in NL om D 23:00 UTC.
// Spec: docs/work-packages/WP20-melden.md §Besluiten na de audit, §Fix-cyclus 1 (A).

useWebmasterEnv();
const mail = useMailWorld();

const H = 60 * 60 * 1000;
const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 10, day, hour, minute);

async function photoExists(t: T, photoId: Id<"photos">) {
  return (await t.run((ctx) => ctx.db.get(photoId))) !== null;
}

async function cronAt(t: T, ts: number) {
  vi.setSystemTime(ts);
  await t.mutation(internal.photos.cleanupFlaggedPhotos, {});
}

/** Melden op `ts`: bob meldt pAlice (G1). Geeft de tekst van de mail aan alice. */
async function flagAt(t: T, w: Awaited<ReturnType<typeof seedWorld>>, ts: number) {
  vi.setSystemTime(ts);
  await asUser(t, w, "bob").mutation(api.photos.flag, { photoId: w.photos.pAlice });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const mails = sentMails(mail.fetchSpy()).filter((m) => m.to.includes(w.users.alice.email));
  expect(mails).toHaveLength(1);
  return mails[0]!;
}

describe("S1 — melden: de genoemde dag bestaat de hele dag", () => {
  it("melding om 01:00 UTC: mail noemt de dag ervoor; die dag (NL) bestaat de foto, de ronde daarna niet", async () => {
    const t = newT();
    vi.setSystemTime(at(14, 0, 30));
    const w = await seedWorld(t);
    const m = await flagAt(t, w, at(14, 1));
    // flaggedDeleteDate = 28 nov 01:00 UTC; eerste ronde = 28 nov 03:00 UTC.
    expect(mentionsDay(m.text, at(27, 12)), "tekst noemt 27 november niet").toBe(true);
    expect(mentionsDay(m.html, at(27, 12)), "html noemt 27 november niet").toBe(true);
    expect(mentionsDay(m.text, at(28, 12)), "tekst noemt 28 november: die dag is de foto er om 04:00 NL al niet meer").toBe(false);

    // De ronde van 27 nov (04:00 NL) laat hem staan; de volgende is 28 nov 04:00 NL,
    // dus 27 november (NL) bestaat hij de hele dag.
    await cronAt(t, at(27, 3));
    expect(await photoExists(t, w.photos.pAlice)).toBe(true);
    await cronAt(t, at(28, 3));
    expect(await photoExists(t, w.photos.pAlice)).toBe(false);
  });

  it("melding om 02:59 UTC: ook de dag ervoor", async () => {
    const t = newT();
    vi.setSystemTime(at(14, 0, 30));
    const w = await seedWorld(t);
    const m = await flagAt(t, w, at(14, 2, 59));
    expect(mentionsDay(m.text, at(27, 12))).toBe(true);
    expect(mentionsDay(m.text, at(28, 12))).toBe(false);
  });

  it("melding om 00:10 UTC (01:10 NL): ook de dag ervoor", async () => {
    const t = newT();
    vi.setSystemTime(at(14, 0, 5));
    const w = await seedWorld(t);
    const m = await flagAt(t, w, at(14, 0, 10));
    expect(mentionsDay(m.text, at(27, 12))).toBe(true);
    expect(mentionsDay(m.text, at(28, 12))).toBe(false);
  });

  it("controle: melding om 12:00 UTC noemt de dag van flaggedDeleteDate; die dag bestaat hij, de ronde daarna niet", async () => {
    const t = newT();
    vi.setSystemTime(at(14, 11));
    const w = await seedWorld(t);
    const m = await flagAt(t, w, at(14, 12));
    expect(mentionsDay(m.text, at(28, 12))).toBe(true);
    await cronAt(t, at(28, 3));
    expect(await photoExists(t, w.photos.pAlice)).toBe(true);
    await cronAt(t, at(29, 3));
    expect(await photoExists(t, w.photos.pAlice)).toBe(false);
  });

  it("controle: melding om 23:30 UTC (00:30 NL de dag erna): de dag van flaggedDeleteDate in UTC", async () => {
    const t = newT();
    vi.setSystemTime(at(14, 23));
    const w = await seedWorld(t);
    const m = await flagAt(t, w, at(14, 23, 30));
    // flaggedDeleteDate = 28 nov 23:30 UTC; eerste ronde 29 nov 03:00 UTC.
    expect(mentionsDay(m.text, at(28, 12))).toBe(true);
    await cronAt(t, at(29, 3));
    expect(await photoExists(t, w.photos.pAlice)).toBe(false);
  });
});

describe("S1 — afwijzen: zelfde regel voor de nieuwe datum (+7 dagen)", () => {
  async function denyAt(ts: number) {
    const t = newT();
    vi.setSystemTime(ts - 2 * H);
    const w = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(w.photos.pBob, {
        flaggedAt: ts - 2 * 24 * H,
        flaggedAppealDate: ts - 24 * H,
        flaggedAppealDenyDate: undefined,
        flaggedDeleteDate: undefined,
      });
    });
    vi.setSystemTime(ts);
    await asUser(t, w, "wm").mutation(api.photos.decideFlag, { photoId: w.photos.pBob, approve: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const mails = sentMails(mail.fetchSpy()).filter((m) => m.to.includes(w.users.bob.email));
    expect(mails).toHaveLength(1);
    return { t, w, m: mails[0]! };
  }

  it("afwijzen om 02:30 UTC: mail noemt de dag ervoor; de foto bestaat die dag (NL), de ronde daarna niet", async () => {
    const { t, w, m } = await denyAt(at(14, 2, 30));
    // flaggedDeleteDate = 21 nov 02:30 UTC; eerste ronde = 21 nov 03:00 UTC.
    expect(mentionsDay(m.text, at(20, 12)), "tekst noemt 20 november niet").toBe(true);
    expect(mentionsDay(m.html, at(20, 12)), "html noemt 20 november niet").toBe(true);
    expect(mentionsDay(m.text, at(21, 12))).toBe(false);
    await cronAt(t, at(20, 3));
    expect(await photoExists(t, w.photos.pBob)).toBe(true);
    await cronAt(t, at(21, 3));
    expect(await photoExists(t, w.photos.pBob)).toBe(false);
  });

  it("controle: afwijzen om 12:00 UTC noemt de dag van flaggedDeleteDate", async () => {
    const { m } = await denyAt(at(14, 12));
    expect(mentionsDay(m.text, at(21, 12))).toBe(true);
  });
});
