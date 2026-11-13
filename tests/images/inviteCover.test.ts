import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import http from "../../convex/http";
import { as, goneGroupId, newT, seedPhoto, publish, seedAlbum, type T, type World } from "../groups/_beheer";
import { bytesOf, containsBytes, labeledJpeg, sameBytes, SCHOON } from "../_helpers/jpeg";
import { secondGroup, seedCover, seedInvite, world } from "../invites/_wp19b";

// WP19b besluit 2 (V4), A-invariant 15: de genodigde ziet de groepsfoto bij
// een ontvangen uitnodiging. De smalste uitzondering op de foto-toegang:
//
//   GET /beeld/uitnodiging/<inviteId>[?formaat=klein|groot]
//
// - Alleen een ingelogde caller met users-rij, alleen voor een uitnodiging aan
//   zijn eigen adres die nu accepteerbaar is.
// - Alleen het beeld van de cover van die groep, en alleen als die foto in een
//   album van die groep staat. Geen origineel: zonder formaat of met
//   `origineel` het formaat *groot*. Zonder formaten het schoongemaakte
//   origineel (zoals de andere paden; SCHOON heeft geen metadata).
// - Uitgelogd 401; alle andere gevallen één en hetzelfde 404. Onbekend
//   formaat 400. `Cache-Control` bevat `private`.
// - Niets anders gaat open: `/beeld/foto/<coverId>`, `photos.getById` en
//   `groups.getWithCover` geven de genodigde niets.

const KLEIN = labeledJpeg("klein");
const GROOT = labeledJpeg("groot");
const path = (id: string, formaat?: string) =>
  `/beeld/uitnodiging/${id}${formaat ? `?formaat=${formaat}` : ""}`;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup(t: T, opts: { formats?: boolean } = {}) {
  const w = await world(t);
  const { photoId } = await seedCover(t, w, {
    bytes: SCHOON,
    ...(opts.formats ? { formats: { klein: KLEIN, groot: GROOT } } : {}),
  });
  const inviteId = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
  return { w, photoId, inviteId };
}

async function get(t: T, subject: string | null, url: string) {
  return subject === null ? await t.fetch(url, { method: "GET" }) : await as(t, subject).fetch(url, { method: "GET" });
}

async function snap(res: Response) {
  return { status: res.status, body: Array.from(await bytesOf(res)).join(",") };
}

describe("A-invariant 15 — de genodigde ziet de cover", () => {
  it("met formaten: klein en groot geven precies dat formaat; private cache", async () => {
    const t = newT();
    const { inviteId } = await setup(t, { formats: true });
    const klein = await get(t, "user_bob", path(inviteId, "klein"));
    expect(klein.status).toBe(200);
    expect(klein.headers.get("Cache-Control") ?? "").toMatch(/\bprivate\b/);
    expect(klein.headers.get("Cache-Control") ?? "").not.toMatch(/\bpublic\b/);
    expect(sameBytes(await bytesOf(klein), KLEIN)).toBe(true);
    const groot = await get(t, "user_bob", path(inviteId, "groot"));
    expect(sameBytes(await bytesOf(groot), GROOT)).toBe(true);
  });

  it("geen origineel: zonder formaat en met formaat=origineel het formaat groot", async () => {
    const t = newT();
    const { inviteId } = await setup(t, { formats: true });
    for (const url of [path(inviteId), path(inviteId, "origineel")]) {
      const res = await get(t, "user_bob", url);
      expect(res.status).toBe(200);
      const body = await bytesOf(res);
      expect(sameBytes(body, GROOT)).toBe(true);
      expect(containsBytes(body, SCHOON)).toBe(false);
    }
  });

  it("zonder formaten: het (schone) origineel als terugval", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    const res = await get(t, "user_bob", path(inviteId, "klein"));
    expect(res.status).toBe(200);
    expect(sameBytes(await bytesOf(res), SCHOON)).toBe(true);
  });

  it("uitgelogd: 401 zonder bytes", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    const res = await get(t, null, path(inviteId));
    expect(res.status).toBe(401);
    expect(containsBytes(await bytesOf(res), SCHOON)).toBe(false);
  });

  it("onbekend formaat: 400", async () => {
    const t = newT();
    const { inviteId } = await setup(t);
    expect((await get(t, "user_bob", path(inviteId, "reus"))).status).toBe(400);
  });
});

describe("A-invariant 15 — alle andere gevallen: één en hetzelfde 404", () => {
  type Case = [string, (t: T, s: { w: World; photoId: Id<"photos">; inviteId: Id<"invites"> }) => Promise<[string, string]>];

  const cases: Case[] = [
    ["een ander (outsider) met het id van bob", async (_t, s) => ["user_eve", s.inviteId]],
    ["een lid van de groep met het id van bob", async (_t, s) => ["user_lex", s.inviteId]],
    ["een uitnodiging aan een ander adres", async (t, s) =>
      ["user_bob", await seedInvite(t, { email: "eve@x.test", invitedBy: s.w.users.olga!, groupId: s.w.groupId })]],
    ["misvormd id", async () => ["user_bob", "geen-id"]],
    ["een id van een andere tabel", async (_t, s) => ["user_bob", s.photoId]],
    ["gewist (ingetrokken)", async (t, s) => {
      await t.run(async (ctx) => ctx.db.delete(s.inviteId));
      return ["user_bob", s.inviteId];
    }],
    ["verlopen", async (t, s) => {
      await t.run(async (ctx) => ctx.db.patch(s.inviteId, { expiresAt: Date.now() }));
      return ["user_bob", s.inviteId];
    }],
    ["afgewezen", async (t, s) => {
      await t.run(async (ctx) => ctx.db.patch(s.inviteId, { status: "declined" }));
      return ["user_bob", s.inviteId];
    }],
    ["geaccepteerd", async (t, s) => {
      await t.run(async (ctx) => ctx.db.patch(s.inviteId, { status: "accepted" }));
      return ["user_bob", s.inviteId];
    }],
    ["uitnodiger geen admin meer", async (t, s) => {
      await t.run(async (ctx) => {
        const m = await ctx.db
          .query("memberships")
          .withIndex("by_user_and_group", (q) => q.eq("userId", s.w.users.olga!).eq("groupId", s.w.groupId))
          .unique();
        await ctx.db.patch(m!._id, { role: "member" });
      });
      return ["user_bob", s.inviteId];
    }],
    ["groep weg", async (t, s) =>
      ["user_bob", await seedInvite(t, { email: "bob@x.test", invitedBy: s.w.users.olga!, groupId: await goneGroupId(t) })]],
    ["uitnodiging zonder groep", async (t, s) =>
      ["user_bob", await seedInvite(t, { email: "bob@x.test", invitedBy: s.w.users.olga! })]],
    ["groep zonder cover", async (t, s) => {
      await t.run(async (ctx) => ctx.db.patch(s.w.groupId, { coverPhotoId: undefined }));
      return ["user_bob", s.inviteId];
    }],
    ["cover die niet in een album van de groep staat", async (t, s) => {
      const g2 = await secondGroup(t, s.w);
      const other = await seedPhoto(t, s.w.users.olga!);
      await publish(t, await seedAlbum(t, g2, s.w.users.olga!), other);
      await t.run(async (ctx) => ctx.db.patch(s.w.groupId, { coverPhotoId: other }));
      return ["user_bob", s.inviteId];
    }],
    ["cover-foto gewist", async (t, s) => {
      await t.run(async (ctx) => ctx.db.delete(s.photoId));
      return ["user_bob", s.inviteId];
    }],
    ["caller zonder users-rij (sessie met het adres van de genodigde)", async (t, s) =>
      ["user_nieuw", await seedInvite(t, { email: "nieuw@x.test", invitedBy: s.w.users.olga!, groupId: s.w.groupId })]],
  ];

  for (const [label, make] of cases) {
    it(`${label}: 404, gelijk aan het antwoord voor een misvormd id`, async () => {
      const t = newT();
      const s = await setup(t, { formats: true });
      const reference = await snap(await get(t, "user_eve", path("geen-id")));
      expect(reference.status).toBe(404);
      const [subject, id] = await make(t, s);
      for (const formaat of [undefined, "klein", "groot"]) {
        expect(await snap(await get(t, subject, path(id, formaat)))).toEqual(reference);
      }
    });
  }
});

describe("A-invariant 15 — niets anders gaat open", () => {
  it("de genodigde krijgt de cover niet via /beeld/foto, photos.getById of groups.getWithCover", async () => {
    const t = newT();
    const { w, photoId } = await setup(t, { formats: true });
    expect((await get(t, "user_bob", `/beeld/foto/${photoId}`)).status).toBe(404);
    expect((await get(t, "user_bob", `/beeld/foto/${photoId}?formaat=klein`)).status).toBe(404);
    await expect(as(t, "user_bob").query(api.photos.getById, { photoId })).rejects.toThrow();
    await expect(as(t, "user_bob").query(api.groups.getWithCover, { groupId: w.groupId })).rejects.toThrow();
  });

  it("geen andere foto van de groep: het pad kent alleen de cover", async () => {
    const t = newT();
    const { w, inviteId } = await setup(t, { formats: true });
    // Een tweede foto in de groep verandert niets aan wat het pad geeft.
    const other = await seedPhoto(t, w.users.olga!);
    await publish(t, await seedAlbum(t, w.groupId, w.users.olga!), other);
    const res = await get(t, "user_bob", path(inviteId, "groot"));
    expect(sameBytes(await bytesOf(res), GROOT)).toBe(true);
  });

  it("na accepteren is hij lid en ziet hij de cover via het gewone pad", async () => {
    const t = newT();
    const { photoId, inviteId } = await setup(t, { formats: true });
    await as(t, "user_bob").mutation(api.invites.accept, { inviteId });
    expect((await get(t, "user_bob", `/beeld/foto/${photoId}?formaat=klein`)).status).toBe(200);
  });
});

describe("routes — het uitnodigingspad", () => {
  it("bestaat voor GET en alleen voor GET", () => {
    expect(http.lookup(path("abc"), "GET")).not.toBeNull();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect(http.lookup(path("abc"), method)).toBeNull();
    }
  });
});
