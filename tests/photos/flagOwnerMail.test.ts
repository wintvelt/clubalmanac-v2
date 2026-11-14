import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { asUser, newT, outcome, seedWorld, useWebmasterEnv } from "../readWhitelist/_world";
import { DAY_MS, INFO_SENDER, NOW, mentionsDay, sentMails, useMailWorld } from "./_wp20";

// WP20 A-invariant 10 — BESLUIT 1, advies regie: de eigenaar krijgt een mail
// bij de eerste melding. Valt besluit 1 anders uit, dan past A dit bestand aan.
//
// De mail: van info@, aan de eigenaar, met de datum waarop de foto verdwijnt
// en dat je in de app bezwaar maakt. Geen naam of adres van de melder, geen
// reden (invariant 1). Een tweede melding stuurt niets (invariant 4); een
// geweigerde melding ook niet. Lukt de mail niet, dan blijft de melding.
// Wereld: pAlice (van alice) staat in A1 (G1: alice, bob) en A3 (G3: alice,
// dave). carol zit in geen van beide.
// Spec: docs/work-packages/WP20-melden.md §A-invarianten.

useWebmasterEnv();
const mail = useMailWorld();

const REASON = "staat er raar op";

describe("photos.flag — mail aan de eigenaar (besluit 1)", () => {
  it("eerste melding: één mail aan de eigenaar, met de verwijderdatum en bezwaar", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "bob").mutation(api.photos.flag, { photoId: w.photos.pAlice, reason: REASON });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const mails = sentMails(mail.fetchSpy());
    expect(mails).toHaveLength(1);
    const m = mails[0]!;
    expect(m.from).toBe(INFO_SENDER);
    expect(m.to).toEqual([w.users.alice.email]);
    const deleteAt = NOW + 14 * DAY_MS;
    expect((await t.run((ctx) => ctx.db.get(w.photos.pAlice)))?.flaggedDeleteDate).toBe(deleteAt);
    expect(mentionsDay(m.text, deleteAt), "tekst noemt de verwijderdatum niet").toBe(true);
    expect(mentionsDay(m.html, deleteAt), "html noemt de verwijderdatum niet").toBe(true);
    expect(m.text.toLowerCase()).toContain("bezwaar");
  });

  it("geen melder en geen reden in de mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "bob").mutation(api.photos.flag, { photoId: w.photos.pAlice, reason: REASON });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const mails = sentMails(mail.fetchSpy());
    expect(mails).toHaveLength(1);
    const m = mails[0]!;
    for (const part of [m.subject, m.text, m.html]) {
      expect(part).not.toContain(w.users.bob.name);
      expect(part).not.toContain(w.users.bob.email);
      expect(part).not.toContain(w.users.bob.subject);
      expect(part).not.toContain(w.users.bob.id);
      expect(part).not.toContain(REASON);
    }
  });

  it("tweede melding door een ander: geen tweede mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "bob").mutation(api.photos.flag, { photoId: w.photos.pAlice });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await asUser(t, w, "dave").mutation(api.photos.flag, { photoId: w.photos.pAlice });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sentMails(mail.fetchSpy())).toHaveLength(1);
  });

  it("geweigerde meldingen (eigen foto, geen toegang): geen mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await outcome(() => asUser(t, w, "alice").mutation(api.photos.flag, { photoId: w.photos.pAlice }));
    await outcome(() => asUser(t, w, "carol").mutation(api.photos.flag, { photoId: w.photos.pAlice }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sentMails(mail.fetchSpy())).toHaveLength(0);
  });

  it("melding op een al gemelde foto (pBob): geen mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "alice").mutation(api.photos.flag, { photoId: w.photos.pBob });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sentMails(mail.fetchSpy())).toHaveLength(0);
  });

  it("Mailjet faalt: de melding blijft staan", async () => {
    const t = newT();
    const w = await seedWorld(t);
    mail.fetchSpy().mockImplementation(async () => new Response("kapot", { status: 500 }));
    await asUser(t, w, "bob").mutation(api.photos.flag, { photoId: w.photos.pAlice });
    await outcome(() => t.finishAllScheduledFunctions(vi.runAllTimers));
    const p = await t.run((ctx) => ctx.db.get(w.photos.pAlice));
    expect(p?.flaggedAt).toBe(NOW);
    expect(p?.flaggedDeleteDate).toBe(NOW + 14 * DAY_MS);
  });
});
