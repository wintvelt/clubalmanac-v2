import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";

// WP29 A-invariant 8 — account verwijderen op prod-schaal, met marge, binnen
// de echte Convex-limieten (`transactionLimits`: 4096 index-reads, 32.000
// gelezen en 16.000 geschreven documenten, 1000 geplande functies per
// transactie). Les WP28 besluit 13: zonder die optie valt een te dure stap in
// de tests niet op.
//
// Prod (2026-11): ±1560 foto's in totaal, 6 groepen, de grootste met 18 leden
// en 1459 publicaties. Deze wereld:
// - Rex heeft OWN eigen foto's (meer dan alle foto's op prod), allemaal in
//   album AR van groep G, en de eerste SOLO ook in groep S waar hij het
//   laatste lid is (M2-e).
// - Olga heeft RATED foto's in album AO van G. De eerste IN_H staan ook in
//   groep H (oprichter Olga, Rex lid).
// WP19a: de ratings op die foto's zijn weg (ratings geschrapt); de naam
// RATED bleef staan voor de foto's van een ander.
// - Rex is oprichter van G (18 leden, iedereen admin zoals op prod) → M2-d.
//
// Spec: docs/work-packages/WP29-account-verwijderen.md §A-invarianten.

const OWN = 1600;
const RATED = 1600;
const SOLO = 1500;
const IN_H = 100;
const OTHERS = 17;
const CHUNK = 200;

const newLimitedT = () => convexTest({ schema, modules, transactionLimits: true });
type T = ReturnType<typeof newLimitedT>;

beforeEach(() => {
  vi.useFakeTimers();
  process.env.CLERK_SECRET_KEY = "sk_test_wp29";
  process.env.CLUBALMANAC_STAGE = "dev";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLUBALMANAC_STAGE;
});

async function bigWorld(t: T) {
  const base = await t.run(async (ctx) => {
    const now = Date.now();
    const user = (key: string) =>
      ctx.db.insert("users", { subject: `user_${key}`, email: `${key}@x.test`, name: key, photoCount: 0, photoLimit: 5000, createdAt: now });
    const rex = await user("rex");
    const others: Array<Id<"users">> = [];
    for (let i = 0; i < OTHERS; i++) others.push(await user(i === 0 ? "olga" : `lid${i}`));
    const olga = others[0]!;

    const G = await ctx.db.insert("groups", { name: "G", createdBy: rex, createdAt: now });
    await ctx.db.insert("memberships", { userId: rex, groupId: G, role: "admin", joinedAt: now });
    for (let i = 0; i < OTHERS; i++) {
      await ctx.db.insert("memberships", { userId: others[i]!, groupId: G, role: "admin", joinedAt: now + 1 + i });
    }
    const S = await ctx.db.insert("groups", { name: "S", createdBy: rex, createdAt: now });
    await ctx.db.insert("memberships", { userId: rex, groupId: S, role: "admin", joinedAt: now });
    const H = await ctx.db.insert("groups", { name: "H", createdBy: olga, createdAt: now });
    await ctx.db.insert("memberships", { userId: olga, groupId: H, role: "admin", joinedAt: now });
    await ctx.db.insert("memberships", { userId: rex, groupId: H, role: "admin", joinedAt: now + 1 });

    const AR = await ctx.db.insert("albums", { groupId: G, name: "AR", createdBy: rex, createdAt: now });
    const AO = await ctx.db.insert("albums", { groupId: G, name: "AO", createdBy: olga, createdAt: now });
    const AS = await ctx.db.insert("albums", { groupId: S, name: "AS", createdBy: rex, createdAt: now });
    const AH = await ctx.db.insert("albums", { groupId: H, name: "AH", createdBy: olga, createdAt: now });
    const olgaBlob = await ctx.storage.store(new Blob(["olga"], { type: "image/jpeg" }));
    return { rex, others, olga, G, S, H, AR, AO, AS, AH, olgaBlob };
  });

  const rexPhotos: Array<{ photoId: Id<"photos">; storageId: Id<"_storage"> }> = [];
  for (let start = 0; start < OWN; start += CHUNK) {
    rexPhotos.push(
      ...(await t.run(async (ctx) => {
        const now = Date.now();
        const out: Array<{ photoId: Id<"photos">; storageId: Id<"_storage"> }> = [];
        for (let i = start; i < Math.min(start + CHUNK, OWN); i++) {
          const storageId = await ctx.storage.store(new Blob([`rex ${i}`], { type: "image/jpeg" }));
          const photoId = await ctx.db.insert("photos", {
            ownerId: base.rex,
            storageId,
            noFormatsAcceptedAt: now,
            createdAt: now,
          });
          await ctx.db.insert("albumPhotos", { albumId: base.AR, photoId, groupId: base.G, addedAt: now, addedBy: base.rex });
          if (i < SOLO) {
            await ctx.db.insert("albumPhotos", { albumId: base.AS, photoId, groupId: base.S, addedAt: now, addedBy: base.rex });
          }
          out.push({ photoId, storageId });
        }
        return out;
      })),
    );
  }
  await t.run(async (ctx) => ctx.db.patch(base.rex, { photoCount: OWN }));

  const olgaPhotos: Array<Id<"photos">> = [];
  for (let start = 0; start < RATED; start += CHUNK) {
    olgaPhotos.push(
      ...(await t.run(async (ctx) => {
        const now = Date.now();
        const out: Array<Id<"photos">> = [];
        for (let i = start; i < Math.min(start + CHUNK, RATED); i++) {
          const photoId = await ctx.db.insert("photos", {
            ownerId: base.olga,
            storageId: base.olgaBlob,
            noFormatsAcceptedAt: now,
            createdAt: now,
          });
          await ctx.db.insert("albumPhotos", { albumId: base.AO, photoId, groupId: base.G, addedAt: now, addedBy: base.olga });
          if (i < IN_H) {
            await ctx.db.insert("albumPhotos", { albumId: base.AH, photoId, groupId: base.H, addedAt: now, addedBy: base.olga });
          }
          out.push(photoId);
        }
        return out;
      })),
    );
  }
  await t.run(async (ctx) => ctx.db.patch(base.olga, { photoCount: RATED }));

  return { ...base, rexPhotos, olgaPhotos };
}

function stubClerk() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://api.clerk.com/")) throw new Error(`onverwachte fetch: ${url}`);
    calls.push(`${(init?.method ?? "GET").toUpperCase()} ${url}`);
    return new Response(JSON.stringify({ deleted: true }), { status: 200 });
  });
  return calls;
}

describe(`WP29 A-invariant 8 — account verwijderen met ${OWN} eigen foto's en ${RATED} foto's van een ander`, () => {
  it("lukt binnen de Convex-limieten; alles van hem weg, de groepen en aggregaten kloppen", { timeout: 600_000 }, async () => {
    const t = newLimitedT();
    const w = await bigWorld(t);
    const clerk = stubClerk();

    await withUser(t, "user_rex").mutation(api.users.deleteSelf, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(clerk).toEqual(["DELETE https://api.clerk.com/v1/users/user_rex"]);

    // Zijn rijen: via de indexen, zodat de checks zelf binnen de limiet blijven.
    const his = await t.run(async (ctx) => ({
      user: await ctx.db.get(w.rex),
      bySubject: await ctx.db.query("users").withIndex("by_subject", (q) => q.eq("subject", "user_rex")).collect(),
      photos: await ctx.db.query("photos").withIndex("by_owner", (q) => q.eq("ownerId", w.rex)).take(1),
      memberships: await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", w.rex)).collect(),
      groupsFounded: await ctx.db.query("groups").withIndex("by_createdBy", (q) => q.eq("createdBy", w.rex)).collect(),
      albums: (await ctx.db.query("albums").collect()).filter((a) => a.createdBy === w.rex),
      S: await ctx.db.get(w.S),
      AS: await ctx.db.get(w.AS),
      sPubs: await ctx.db.query("albumPhotos").withIndex("by_group", (q) => q.eq("groupId", w.S)).take(1),
      arPubs: await ctx.db.query("albumPhotos").withIndex("by_album", (q) => q.eq("albumId", w.AR)).take(1),
    }));
    expect(his.user).toBeNull();
    expect(his.bySubject).toEqual([]);
    expect(his.photos).toEqual([]);
    expect(his.memberships).toEqual([]);
    expect(his.groupsFounded).toEqual([]);
    expect(his.albums).toEqual([]);
    expect(his.S).toBeNull();
    expect(his.AS).toBeNull();
    expect(his.sPubs).toEqual([]);
    expect(his.arPubs).toEqual([]);

    // Storage: alleen het beeld van Olga is er nog.
    const storage = await t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).map((s) => s._id));
    expect(storage).toEqual([w.olgaBlob]);

    // G blijft: Olga (vroegste admin) wordt oprichter, 17 leden.
    const g = await t.run(async (ctx) => ({
      group: await ctx.db.get(w.G),
      members: await ctx.db.query("memberships").withIndex("by_group", (q) => q.eq("groupId", w.G)).collect(),
      AR: await ctx.db.get(w.AR),
    }));
    expect(g.group?.createdBy).toBe(w.olga);
    expect(g.members).toHaveLength(OTHERS);
    expect(g.AR?.createdBy).toBe(w.olga);

    // Elke foto van Olga staat er nog, met haar publicatie in AO, in stukken gelezen.
    let wrong = 0;
    for (let start = 0; start < RATED; start += CHUNK) {
      wrong += await t.run(async (ctx) => {
        let bad = 0;
        for (const id of w.olgaPhotos.slice(start, start + CHUNK)) {
          const photo = await ctx.db.get(id);
          const pubs = await ctx.db.query("albumPhotos").withIndex("by_photo", (q) => q.eq("photoId", id)).collect();
          const ok = photo !== null && pubs.some((p) => p.albumId === w.AO);
          if (!ok) bad++;
        }
        return bad;
      });
    }
    expect(wrong, "foto's van Olga die weg zijn of hun publicatie in AO kwijt").toBe(0);

    // De andere leden houden hun rij.
    const others = await t.run(async (ctx) => Promise.all(w.others.map((id) => ctx.db.get(id))));
    expect(others.every((u) => u !== null)).toBe(true);
    expect(others[0]?.photoCount).toBe(RATED);
  });
});
