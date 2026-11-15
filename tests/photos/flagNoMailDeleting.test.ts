import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { asUser, newT, outcome, seedWorld, useWebmasterEnv, type T } from "../readWhitelist/_world";
import { DAY_MS, NOW, removeFlagged, sentMails, useMailWorld } from "./_wp20";

// WP20 besluit 6, N3 (fix-cyclus 1): geen mail aan een eigenaar wiens account
// wordt verwijderd (WP29: `users.deletion` gezet), bij melden, afwijzen en
// removeFlagged. Ook niet als het verwijderen begint nadat de mutation de mail
// heeft ingepland: de controle telt op het moment van versturen.
// Wat de mutations verder doen (melding opslaan, foto wissen) pint dit niet.
// Wereld: pAlice (alice) in A1 (G1: alice, bob); pBob (bob) in A1.
// Spec: docs/work-packages/WP20-melden.md §Besluiten na de audit, §Fix-cyclus 1 (A).

useWebmasterEnv();
const mail = useMailWorld();

async function startDeletion(t: T, userId: Id<"users">) {
  await t.run(async (ctx) => {
    await ctx.db.patch(userId, { deletion: { startedAt: Date.now() } });
  });
}

async function appealedBob(t: T, photoId: Id<"photos">) {
  await t.run(async (ctx) => {
    await ctx.db.patch(photoId, {
      flaggedAt: NOW - 2 * DAY_MS,
      flaggedAppealDate: NOW - DAY_MS,
      flaggedAppealDenyDate: undefined,
      flaggedDeleteDate: undefined,
    });
  });
}

function mailsTo(email: string) {
  return sentMails(mail.fetchSpy()).filter((m) => m.to.includes(email));
}

describe("N3 — melden", () => {
  it("eigenaar wordt verwijderd: geen mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await startDeletion(t, w.users.alice.id);
    await outcome(() => asUser(t, w, "bob").mutation(api.photos.flag, { photoId: w.photos.pAlice }));
    await outcome(() => t.finishAllScheduledFunctions(vi.runAllTimers));
    expect(mailsTo(w.users.alice.email)).toEqual([]);
  });

  it("verwijderen begint na het melden, vóór het versturen: geen mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "bob").mutation(api.photos.flag, { photoId: w.photos.pAlice });
    await startDeletion(t, w.users.alice.id);
    await outcome(() => t.finishAllScheduledFunctions(vi.runAllTimers));
    expect(mailsTo(w.users.alice.email)).toEqual([]);
  });

  it("controle: zonder verwijderen wel een mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "bob").mutation(api.photos.flag, { photoId: w.photos.pAlice });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(mailsTo(w.users.alice.email)).toHaveLength(1);
  });
});

describe("N3 — afwijzen", () => {
  it("eigenaar wordt verwijderd: geen mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await appealedBob(t, w.photos.pBob);
    await startDeletion(t, w.users.bob.id);
    await outcome(() =>
      asUser(t, w, "wm").mutation(api.photos.decideFlag, { photoId: w.photos.pBob, approve: false }),
    );
    await outcome(() => t.finishAllScheduledFunctions(vi.runAllTimers));
    expect(mailsTo(w.users.bob.email)).toEqual([]);
  });

  it("verwijderen begint na het afwijzen, vóór het versturen: geen mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await appealedBob(t, w.photos.pBob);
    await asUser(t, w, "wm").mutation(api.photos.decideFlag, { photoId: w.photos.pBob, approve: false });
    await startDeletion(t, w.users.bob.id);
    await outcome(() => t.finishAllScheduledFunctions(vi.runAllTimers));
    expect(mailsTo(w.users.bob.email)).toEqual([]);
  });

  it("controle: zonder verwijderen wel een mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await appealedBob(t, w.photos.pBob);
    await asUser(t, w, "wm").mutation(api.photos.decideFlag, { photoId: w.photos.pBob, approve: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(mailsTo(w.users.bob.email)).toHaveLength(1);
  });
});

describe("N3 — removeFlagged", () => {
  it("eigenaar wordt verwijderd: geen mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await startDeletion(t, w.users.bob.id);
    await outcome(() => asUser(t, w, "wm").mutation(removeFlagged, { photoId: w.photos.pBob }));
    await outcome(() => t.finishAllScheduledFunctions(vi.runAllTimers));
    expect(mailsTo(w.users.bob.email)).toEqual([]);
  });

  it("verwijderen begint na removeFlagged, vóór het versturen: geen mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "wm").mutation(removeFlagged, { photoId: w.photos.pBob });
    await startDeletion(t, w.users.bob.id);
    await outcome(() => t.finishAllScheduledFunctions(vi.runAllTimers));
    expect(mailsTo(w.users.bob.email)).toEqual([]);
  });

  it("controle: zonder verwijderen wel een mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "wm").mutation(removeFlagged, { photoId: w.photos.pBob });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(mailsTo(w.users.bob.email)).toHaveLength(1);
  });
});
