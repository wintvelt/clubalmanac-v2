import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { leftovers, upload } from "./_upload";

// WP18 A-keuze 1 en A-invariant 15 (kernvondst 5): upload en album in één
// verzoek. Met `X-Album-Id` komen de foto en zijn plek in het album in één
// transactie, of geen van beide. Een herhaling met dezelfde upload-id geeft de
// bestaande foto en zet hem niet nog eens in het album. Het album: alleen als
// lid van zijn groep (toestemmingslijst), vóór reservering en opslag; geen
// toegang, onbekend, gewist en misvormd geven één antwoord (404) en laten
// niets achter. Invariant 8: de andere leden zien de teller oplopen.
//
// Spec: docs/work-packages/WP18-foto-upload.md §Spec-criticus aanvullingen.

type T = ReturnType<typeof convexTest>;
const MINUTE = 60_000;

// Nep-klok: de geplande extractMetadata en makeFormats van een eerdere upload
// lopen dan niet tussendoor. In convex-test 0.0.50 erven ze via setTimeout de
// context van de mutation, denken ze dat ze genest zijn en rollen ze de
// schrijfacties van de volgende upload terug (flaky in de volle suite). Deze
// file pint de upload zelf, niet die stappen. De tijd staat stil: een upload
// is strikt later dan album en lidmaatschap (een minuut eerder), en markSeen
// valt op hetzelfde moment als de upload, dus daarna niet meer ongelezen.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * G — alice (member), bob (admin). Album A.
 * H — carol (admin). Album B.
 * Album en lidmaatschap zijn van een minuut geleden, zodat een nieuwe foto
 * voor bob ongelezen is (strikt later dan zijn ijkpunt).
 */
async function world(t: T) {
  return await t.run(async (ctx) => {
    const then = Date.now() - MINUTE;
    const user = (key: string) =>
      ctx.db.insert("users", {
        subject: `user_${key}`,
        email: `${key}@x.com`,
        name: key,
        photoCount: 0,
        photoLimit: 1000,
        createdAt: then,
      });
    const alice = await user("alice");
    const bob = await user("bob");
    const carol = await user("carol");
    const g = await ctx.db.insert("groups", { name: "G", createdBy: bob, createdAt: then });
    await ctx.db.insert("memberships", { userId: alice, groupId: g, role: "member", joinedAt: then });
    await ctx.db.insert("memberships", { userId: bob, groupId: g, role: "admin", joinedAt: then });
    const albumA = await ctx.db.insert("albums", { groupId: g, name: "A", createdBy: bob, createdAt: then });
    const h = await ctx.db.insert("groups", { name: "H", createdBy: carol, createdAt: then });
    await ctx.db.insert("memberships", { userId: carol, groupId: h, role: "admin", joinedAt: then });
    const albumB = await ctx.db.insert("albums", { groupId: h, name: "B", createdBy: carol, createdAt: then });
    const gone = await ctx.db.insert("albums", { groupId: g, name: "weg", createdBy: bob, createdAt: then });
    await ctx.db.delete(gone);
    return { alice, bob, carol, g, h, albumA, albumB, gone };
  });
}

const toAlbum = (albumId: string) => ({ "X-Album-Id": albumId });

async function rowsOf(t: T, albumId: Id<"albums">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("albumPhotos")
      .filter((q) => q.eq(q.field("albumId"), albumId))
      .collect(),
  );
}

describe("A-keuze 1: met album staat de foto in één keer in het album", () => {
  it("een lid uploadt in een album van zijn groep: foto en plek, met de uploader als toevoeger", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);

    const res = await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumA) });
    expect(res.status).toBe(200);
    const { photoId } = (await res.json()) as { photoId: Id<"photos"> };

    const rows = await rowsOf(t, w.albumA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ photoId, groupId: w.g, addedBy: w.alice });
    const photo = await t.run(async (ctx) => ctx.db.get(photoId));
    expect(photo!.ownerId).toBe(w.alice);
  });

  it("de herhaling met dezelfde id: dezelfde foto, nog steeds één plek, één telling", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const first = await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumA) });
    const { photoId } = (await first.json()) as { photoId: string };

    const again = await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumA) });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { photoId: string }).photoId).toBe(photoId);

    expect(await rowsOf(t, w.albumA)).toHaveLength(1);
    const left = await leftovers(t, w.alice);
    expect(left.photos).toBe(1);
    expect(left.photoCount).toBe(1);
  });

  it("invariant 8: een ander lid ziet de teller van het album oplopen, en na openen op nul", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const asBob = withUser(t, "user_bob");
    const unread = async () =>
      (await asBob.query(api.albums.listByGroupWithUnread, { groupId: w.g })).find((a) => a._id === w.albumA)!
        .unreadCount;
    expect(await unread()).toBe(0);

    await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumA) });
    await upload(t, "user_alice", { uploadId: "u-2", headers: toAlbum(w.albumA) });
    expect(await unread()).toBe(2);

    await asBob.mutation(api.albums.markSeen, { albumId: w.albumA });
    expect(await unread()).toBe(0);
  });

  it("twee foto's in één ronde: twee plekken", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumA) });
    await upload(t, "user_alice", { uploadId: "u-2", headers: toAlbum(w.albumA) });
    expect(await rowsOf(t, w.albumA)).toHaveLength(2);
  });

  it("zonder album (de profielfoto): een foto in geen album, zoals nu", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const res = await upload(t, "user_alice", { uploadId: "profiel" });
    expect(res.status).toBe(200);
    const left = await leftovers(t, w.alice);
    expect(left.photos).toBe(1);
    expect(left.albumPhotos).toBe(0);
  });

  it("op de limiet met album: 403, geen foto en geen plek", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await t.run((ctx) => ctx.db.patch(w.alice, { photoLimit: 0 }));
    const res = await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumA) });
    expect(res.status).toBe(403);
    const left = await leftovers(t, w.alice);
    expect(left).toMatchObject({ photos: 0, reservations: 0, storage: 0, albumPhotos: 0, photoCount: 0 });
  });
});

describe("A-invariant 15: album alleen als lid, één antwoord, niets achter", () => {
  async function refused(t: T, w: Awaited<ReturnType<typeof world>>, albumId: string, uploadId: string) {
    const res = await upload(t, "user_alice", { uploadId, headers: toAlbum(albumId) });
    const body = await res.text();
    expect(await leftovers(t, w.alice)).toEqual({
      photos: 0,
      reservations: 0,
      storage: 0,
      albumPhotos: 0,
      photoCount: 0,
    });
    return { status: res.status, body };
  }

  it("album van een groep zonder lidmaatschap: 404, niets achter", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const r = await refused(t, w, w.albumB, "u-1");
    expect(r.status).toBe(404);
  });

  it("geen orakel: geen lid, gewist album, misvormd id en een id van een andere tabel geven hetzelfde", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const noMember = await refused(t, w, w.albumB, "u-1");
    const gone = await refused(t, w, w.gone, "u-2");
    const garbage = await refused(t, w, "geen-album-id", "u-3");
    const otherTable = await refused(t, w, w.g, "u-4");
    expect(noMember.status).toBe(404);
    expect(gone).toEqual(noMember);
    expect(garbage).toEqual(noMember);
    expect(otherTable).toEqual(noMember);
  });

  it("een vertrokken lid uploadt niet meer in het album van zijn oude groep", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await t.run(async (ctx) => {
      const m = await ctx.db
        .query("memberships")
        .filter((q) => q.and(q.eq(q.field("userId"), w.alice), q.eq(q.field("groupId"), w.g)))
        .unique();
      await ctx.db.delete(m!._id);
    });
    const r = await refused(t, w, w.albumA, "u-1");
    expect(r.status).toBe(404);
  });

  it("na een weigering lukt dezelfde id in een album met toegang", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumB) });
    const res = await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumA) });
    expect(res.status).toBe(200);
    expect(await rowsOf(t, w.albumA)).toHaveLength(1);
    expect(await rowsOf(t, w.albumB)).toHaveLength(0);
  });
});

// ── Fix-cyclus 2 (spec §Fix-cyclus 2) ─────────────────────────────────────
//
// A-invariant 24: met `X-Album-Id` betekent een 200 dat de foto bestaat en in
// dat album staat, ook bij een herhaling. De app geeft dezelfde foto voor
// hetzelfde album dezelfde id (A-invariant 25), dus een herhaling kan komen
// nadat de foto uit het album is gehaald.

describe("A-invariant 24: een 200 met album is waar, ook bij een herhaling", () => {
  it("uit het album gehaald, dan de herhaling: dezelfde foto staat er weer in, één plek, de uploader als toevoeger", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const first = await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumA) });
    const { photoId } = (await first.json()) as { photoId: Id<"photos"> };
    await withUser(t, "user_alice").mutation(api.albums.removePhoto, { albumId: w.albumA, photoId });
    expect(await rowsOf(t, w.albumA)).toHaveLength(0);

    const again = await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumA) });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { photoId: string }).photoId).toBe(photoId);

    const rows = await rowsOf(t, w.albumA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ photoId, groupId: w.g, addedBy: w.alice });
    const left = await leftovers(t, w.alice);
    expect(left.photos).toBe(1);
    expect(left.photoCount).toBe(1);
  });

  it("de teller van een ander lid loopt weer op", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const asBob = withUser(t, "user_bob");
    const unread = async () =>
      (await asBob.query(api.albums.listByGroupWithUnread, { groupId: w.g })).find((a) => a._id === w.albumA)!
        .unreadCount;
    const first = await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumA) });
    const { photoId } = (await first.json()) as { photoId: Id<"photos"> };
    await withUser(t, "user_alice").mutation(api.albums.removePhoto, { albumId: w.albumA, photoId });
    await asBob.mutation(api.albums.markSeen, { albumId: w.albumA });
    expect(await unread()).toBe(0);
    vi.advanceTimersByTime(1000);

    await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumA) });
    expect(await unread()).toBe(1);
  });

  it("ook op de limiet: geen nieuwe foto, wel weer in het album", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const first = await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumA) });
    const { photoId } = (await first.json()) as { photoId: Id<"photos"> };
    await withUser(t, "user_alice").mutation(api.albums.removePhoto, { albumId: w.albumA, photoId });
    await t.run((ctx) => ctx.db.patch(w.alice, { photoLimit: 1 }));

    const again = await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumA) });
    expect(again.status).toBe(200);
    expect(await rowsOf(t, w.albumA)).toHaveLength(1);
    expect((await leftovers(t, w.alice)).photos).toBe(1);
  });

  it("dezelfde id met een ander album van de groep: de foto staat ook daar, en blijft in het eerste", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const albumA2 = await t.run(async (ctx) =>
      ctx.db.insert("albums", { groupId: w.g, name: "A2", createdBy: w.bob, createdAt: Date.now() - MINUTE }),
    );
    const first = await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(w.albumA) });
    const { photoId } = (await first.json()) as { photoId: Id<"photos"> };

    const again = await upload(t, "user_alice", { uploadId: "u-1", headers: toAlbum(albumA2) });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { photoId: string }).photoId).toBe(photoId);

    expect((await rowsOf(t, albumA2)).map((r) => r.photoId)).toEqual([photoId]);
    expect((await rowsOf(t, w.albumA)).map((r) => r.photoId)).toEqual([photoId]);
    expect((await leftovers(t, w.alice)).photos).toBe(1);
  });
});
