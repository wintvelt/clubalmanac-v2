import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  as,
  expectRefused,
  goneAlbumId,
  goneGroupId,
  membership,
  newT,
  publish,
  seedAlbum,
  seedGroup,
  seedPhoto,
  type T,
} from "../groups/_beheer";

// WP28 fix-cyclus 1, A-invariant 11 en A-keuze 1: verwachte weigeringen op de
// WP28-paden zijn een ConvexError met een code (invariant 7: in productie
// heet een gewone Error "Server Error"). Op addPhoto, removePhoto en markSeen
// is geen lid of een onbekend album NOT_MEMBER, voor bestaand en gewist album
// gelijk (het orakel van removePhoto, red-team R4).
//
// Wereld: oprichter Olga, admin Anna, lid Lex, buitenstaander Eve. Album A met
// foto P van Olga.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function world(t: T) {
  const w = await seedGroup(t, {
    founder: "olga",
    members: { anna: "admin", lex: "member" },
    outsiders: ["eve"],
  });
  const A = await seedAlbum(t, w.groupId, w.users.olga!, "A");
  const B = await seedAlbum(t, w.groupId, w.users.olga!, "B");
  const P = await seedPhoto(t, w.users.olga!);
  await publish(t, A, P);
  const gone = await goneAlbumId(t, w.groupId, w.users.olga!);
  return { ...w, A, B, P, gone };
}

describe("covers: COVER_NOT_IN_GROUP en COVER_NOT_IN_ALBUM", () => {
  it("groepscover met een foto die in geen album van de groep staat", async () => {
    const t = newT();
    const w = await world(t);
    const loose = await seedPhoto(t, w.users.anna!);
    await expectRefused(t, "COVER_NOT_IN_GROUP", () =>
      as(t, "user_anna").mutation(api.groups.update, { groupId: w.groupId, coverPhotoId: loose }),
    );
  });

  it("albumcover met een foto uit een ander album", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "COVER_NOT_IN_ALBUM", () =>
      as(t, "user_anna").mutation(api.albums.update, { albumId: w.B, coverPhotoId: w.P }),
    );
  });
});

describe("invites.accept: INVITE_INVALID", () => {
  it("een uitnodiging van vóór WP28 van een lid zonder admin-rol", async () => {
    const t = newT();
    const w = await world(t);
    const token = crypto.randomUUID();
    await t.run(async (ctx) =>
      ctx.db.insert("invites", {
        email: "eve@x.test",
        invitedBy: w.users.lex!,
        groupId: w.groupId,
        role: "member",
        token,
        status: "pending",
        expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
      }),
    );
    await expectRefused(t, "INVITE_INVALID", () => as(t, "user_eve").mutation(api.invites.accept, { token }));
    expect(await membership(t, w.groupId, w.users.eve!)).toBeNull();
  });
});

describe("albums.addPhoto", () => {
  it("geen lid en gewist album: dezelfde NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    const mine = await seedPhoto(t, w.users.eve!);
    const a = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.albums.addPhoto, { albumId: w.A, photoId: mine }),
    );
    const b = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.albums.addPhoto, { albumId: w.gone, photoId: mine }),
    );
    expect(a).toEqual(b);
  });

  it("een foto van een ander: NOT_PHOTO_OWNER", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_PHOTO_OWNER", () =>
      as(t, "user_lex").mutation(api.albums.addPhoto, { albumId: w.B, photoId: w.P }),
    );
  });

  it("al in dit album: ALREADY_IN_ALBUM", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "ALREADY_IN_ALBUM", () =>
      as(t, "user_olga").mutation(api.albums.addPhoto, { albumId: w.A, photoId: w.P }),
    );
  });
});

describe("albums.removePhoto", () => {
  it("geen lid en gewist album: dezelfde NOT_MEMBER (het orakel)", async () => {
    const t = newT();
    const w = await world(t);
    const a = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.albums.removePhoto, { albumId: w.A, photoId: w.P }),
    );
    const b = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.albums.removePhoto, { albumId: w.gone, photoId: w.P }),
    );
    expect(a).toEqual(b);
  });

  it("niet in dit album: NOT_IN_ALBUM", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_IN_ALBUM", () =>
      as(t, "user_anna").mutation(api.albums.removePhoto, { albumId: w.B, photoId: w.P }),
    );
  });

  it("een lid dat de foto niet toevoegde: NOT_ALLOWED", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(api.albums.removePhoto, { albumId: w.A, photoId: w.P }),
    );
  });
});

describe("albums.markSeen", () => {
  it("geen lid en gewist album: dezelfde NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    const a = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.albums.markSeen, { albumId: w.A }),
    );
    const b = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.albums.markSeen, { albumId: w.gone }),
    );
    expect(a).toEqual(b);
  });
});

// Fix-cyclus 2, H1 (A-invariant 16): ook groups.markAllAlbumsSeen weigert
// een niet-lid met NOT_MEMBER, voor bestaande en gewiste groep gelijk.
describe("groups.markAllAlbumsSeen", () => {
  it("geen lid en gewiste groep: dezelfde NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    const gone = await goneGroupId(t);
    const a = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.groups.markAllAlbumsSeen, { groupId: w.groupId }),
    );
    const b = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.groups.markAllAlbumsSeen, { groupId: gone }),
    );
    expect(a).toEqual(b);
  });
});
