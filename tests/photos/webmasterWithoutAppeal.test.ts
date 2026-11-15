import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  as,
  asGhost,
  asUser,
  newT,
  outcome,
  seedWorld,
  staleId,
  useWebmasterEnv,
  WEBMASTER_EMAIL,
  type T,
} from "../readWhitelist/_world";
import { expectNoMutationOracle, expectRejectedNoChange } from "../writeGates/_helpers";
import { INFO_SENDER, removeFlagged, sentMails, useMailWorld } from "./_wp20";

// WP20 A-invarianten 11–13 — BESLUIT 2, advies regie: de webmaster beslist
// ook zonder bezwaar. Valt besluit 2 anders uit, dan past A dit bestand aan
// (en de laatste test in decideFlag.test.ts).
//
// 11. decideFlag(approve: true) mag zonder bezwaar: alle flag-velden weg, geen
//     mail (zoals FL2). approve: false zonder bezwaar blijft geweigerd.
// 12. photos.removeFlagged verwijdert een gemelde foto meteen, in elke fase,
//     met dezelfde cascade als de cron. Alleen de webmaster; dezelfde weigering
//     voor bestaand en onbekend id. Niet gemeld: geweigerd.
// 13. De eigenaar krijgt een mail dat zijn gemelde foto is verwijderd, van
//     info@, zonder melder of reden. De foto-rij is dan al weg.
// Wereld: pBob (van bob) gemeld door alice, bezwaar afgewezen; in A1 (G1) en
// cover van G1 en A1. pAlice in A1 en A3, niet gemeld.
// Spec: docs/work-packages/WP20-melden.md §A-invarianten.

useWebmasterEnv();
const mail = useMailWorld();

const FLAG_FIELDS = [
  "flaggedAt",
  "flaggedBy",
  "flagReason",
  "flaggedDeleteDate",
  "flaggedAppealDate",
  "flaggedAppealDenyDate",
] as const;

/** pAlice gemeld door bob, zonder bezwaar. */
async function flagAliceByBob(t: T, w: Awaited<ReturnType<typeof seedWorld>>) {
  await asUser(t, w, "bob").mutation(api.photos.flag, { photoId: w.photos.pAlice, reason: "weg ermee" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  mail.fetchSpy().mockClear();
}

async function scheduledNames(t: T): Promise<string[]> {
  return (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).map((s) => s.name);
}

describe("decideFlag zonder bezwaar (A-invariant 11)", () => {
  it("approve: alle flag-velden gewist, geen mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await flagAliceByBob(t, w);
    const before = await scheduledNames(t);
    await asUser(t, w, "wm").mutation(api.photos.decideFlag, { photoId: w.photos.pAlice, approve: true });
    const p = await t.run((ctx) => ctx.db.get(w.photos.pAlice));
    for (const field of FLAG_FIELDS) expect(p?.[field], field).toBeUndefined();
    expect(await scheduledNames(t)).toEqual(before);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sentMails(mail.fetchSpy())).toHaveLength(0);
  });

  it("deny zonder bezwaar: geweigerd, niets gewijzigd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await flagAliceByBob(t, w);
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "wm").mutation(api.photos.decideFlag, { photoId: w.photos.pAlice, approve: false }),
    );
  });

  it("een niet-webmaster: geweigerd, ook zonder bezwaar", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await flagAliceByBob(t, w);
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "alice").mutation(api.photos.decideFlag, { photoId: w.photos.pAlice, approve: true }),
    );
  });
});

describe("photos.removeFlagged — webmaster (A-invariant 12)", () => {
  it("gemeld zonder bezwaar: foto weg, met de cascade (albums, teller)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await flagAliceByBob(t, w);
    const countBefore = (await t.run((ctx) => ctx.db.get(w.users.alice.id)))!.photoCount;
    await asUser(t, w, "wm").mutation(removeFlagged, { photoId: w.photos.pAlice });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run(async (ctx) => {
      expect(await ctx.db.get(w.photos.pAlice)).toBeNull();
      const aps = (await ctx.db.query("albumPhotos").collect()).filter((ap) => ap.photoId === w.photos.pAlice);
      expect(aps).toEqual([]);
      const g3 = await ctx.db.get(w.groups.G3);
      const a3 = await ctx.db.get(w.albums.A3);
      expect(g3?.coverPhotoId).toBeUndefined();
      expect(a3?.coverPhotoId).toBeUndefined();
      expect((await ctx.db.get(w.users.alice.id))!.photoCount).toBe(countBefore - 1);
    });
  });

  it("met bezwaar zonder besluit, en na afwijzen: ook", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // pBob: bezwaar afgewezen (wereld).
    await asUser(t, w, "wm").mutation(removeFlagged, { photoId: w.photos.pBob });
    // pAlice: bezwaar zonder besluit.
    await flagAliceByBob(t, w);
    await asUser(t, w, "alice").mutation(api.photos.appeal, { photoId: w.photos.pAlice });
    await asUser(t, w, "wm").mutation(removeFlagged, { photoId: w.photos.pAlice });
    expect(await t.run((ctx) => ctx.db.get(w.photos.pBob))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(w.photos.pAlice))).toBeNull();
  });

  it("niet gemelde foto: geweigerd, niets gewijzigd (geen algemene wis-knop)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expectRejectedNoChange(t, () => asUser(t, w, "wm").mutation(removeFlagged, { photoId: w.photos.pCarol }));
  });

  it("na goedkeuren is de foto niet meer gemeld: geweigerd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const wm = asUser(t, w, "wm");
    await wm.mutation(api.photos.decideFlag, { photoId: w.photos.pBob, approve: true });
    await expectRejectedNoChange(t, () => wm.mutation(removeFlagged, { photoId: w.photos.pBob }));
  });
});

describe("photos.removeFlagged — niet de webmaster (A-invariant 12, invariant 3)", () => {
  it("uitgelogd, ghost, webmaster-adres zonder users-rij: geweigerd, niets gewijzigd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const args = { photoId: w.photos.pBob };
    await expectRejectedNoChange(t, () => t.mutation(removeFlagged, args), "anoniem");
    await expectRejectedNoChange(t, () => asGhost(t).mutation(removeFlagged, args), "ghost");
    await expectRejectedNoChange(
      t,
      () => as(t, "user_wm_ghost", WEBMASTER_EMAIL).mutation(removeFlagged, args),
      "webmaster-adres zonder users-rij",
    );
  });

  it("melder, eigenaar en ander lid: geweigerd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    for (const key of ["alice", "bob", "carol"] as const) {
      await expectRejectedNoChange(
        t,
        () => asUser(t, w, key).mutation(removeFlagged, { photoId: w.photos.pBob }),
        key,
      );
    }
  });

  it("bestaand gemeld, bestaand niet gemeld en onbekend id: dezelfde weigering", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = (await staleId(t, w, "photos")) as Id<"photos">;
    const bob = asUser(t, w, "bob");
    await expectNoMutationOracle(
      t,
      () => bob.mutation(removeFlagged, { photoId: missing }),
      () => bob.mutation(removeFlagged, { photoId: w.photos.pBob }),
    );
    await expectNoMutationOracle(
      t,
      () => bob.mutation(removeFlagged, { photoId: missing }),
      () => bob.mutation(removeFlagged, { photoId: w.photos.pCarol }),
    );
  });
});

describe("photos.removeFlagged — mail aan de eigenaar (A-invariant 13)", () => {
  it("één mail aan de eigenaar, van info@, zonder melder of reden", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await flagAliceByBob(t, w);
    await asUser(t, w, "wm").mutation(removeFlagged, { photoId: w.photos.pAlice });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const mails = sentMails(mail.fetchSpy());
    expect(mails).toHaveLength(1);
    const m = mails[0]!;
    expect(m.from).toBe(INFO_SENDER);
    expect(m.to).toEqual([w.users.alice.email]);
    expect(m.text.length).toBeGreaterThan(0);
    for (const part of [m.subject, m.text, m.html]) {
      expect(part).not.toContain(w.users.bob.name);
      expect(part).not.toContain(w.users.bob.email);
      expect(part).not.toContain("weg ermee");
    }
  });

  it("de mail gaat ook als de foto-rij al weg is (de mail hangt niet van de foto af)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "wm").mutation(removeFlagged, { photoId: w.photos.pBob });
    expect(await t.run((ctx) => ctx.db.get(w.photos.pBob))).toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const mails = sentMails(mail.fetchSpy());
    expect(mails.map((m) => m.to)).toEqual([[w.users.bob.email]]);
  });

  it("Mailjet faalt: de foto blijft verwijderd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    mail.fetchSpy().mockImplementation(async () => new Response("kapot", { status: 500 }));
    await asUser(t, w, "wm").mutation(removeFlagged, { photoId: w.photos.pBob });
    await outcome(() => t.finishAllScheduledFunctions(vi.runAllTimers));
    expect(await t.run((ctx) => ctx.db.get(w.photos.pBob))).toBeNull();
  });
});

