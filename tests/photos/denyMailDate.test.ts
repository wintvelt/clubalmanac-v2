import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { asUser, newT, seedWorld, useWebmasterEnv } from "../readWhitelist/_world";
import { DAY_MS, INFO_SENDER, NOW, mentionsDay, sentMails, useMailWorld } from "./_wp20";

// WP20 A-invariant 6: de mail bij afwijzen noemt de datum waarop de foto
// verdwijnt (de nieuwe flaggedDeleteDate, nu + 7 dagen), zodat de eigenaar
// weet tot wanneer (invariant 2). Geen melder, geen reden (invariant 1).
// Wereld: pBob van bob, gemeld door alice. Hier: een vers bezwaar zonder besluit.
// Spec: docs/work-packages/WP20-melden.md §A-invarianten.

useWebmasterEnv();
const mail = useMailWorld();

describe("photos.decideFlag(deny) — mail aan de eigenaar", () => {
  it("noemt de verwijderdatum, niet de melder of de reden", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(w.photos.pBob, {
        flaggedAt: NOW - 2 * DAY_MS,
        flaggedAppealDate: NOW - DAY_MS,
        flaggedAppealDenyDate: undefined,
        flaggedDeleteDate: undefined,
      });
    });
    await asUser(t, w, "wm").mutation(api.photos.decideFlag, { photoId: w.photos.pBob, approve: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const deleteAt = (await t.run((ctx) => ctx.db.get(w.photos.pBob)))!.flaggedDeleteDate!;
    expect(deleteAt).toBe(NOW + 7 * DAY_MS);

    const mails = sentMails(mail.fetchSpy()).filter((m) => m.to.includes(w.users.bob.email));
    expect(mails).toHaveLength(1);
    const m = mails[0]!;
    expect(m.from).toBe(INFO_SENDER);
    expect(mentionsDay(m.text, deleteAt), `tekst noemt ${new Date(deleteAt).toISOString()} niet`).toBe(true);
    expect(mentionsDay(m.html, deleteAt), "html noemt de datum niet").toBe(true);
    for (const part of [m.subject, m.text, m.html]) {
      expect(part).not.toContain(w.users.alice.name);
      expect(part).not.toContain(w.users.alice.email);
      expect(part).not.toContain(w.flagReason);
    }
  });
});
