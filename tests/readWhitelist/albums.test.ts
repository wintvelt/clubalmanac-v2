import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  SHAPE,
  asGhost,
  asUser,
  expectNoOracle,
  expectNoUserSecrets,
  expectShape,
  newT,
  seedWorld,
  staleId,
  useWebmasterEnv,
  type R,
  type T,
} from "./_world";

// WP23 — albums-reads. Spec §Vormen (album, groep, albumPhoto, foto),
// invarianten 3-5. Lidmaatschap was al vereist; nieuw zijn de whitelist en
// het orakel ("Album bestaat niet" vs "Geen lid").

useWebmasterEnv();

type AlbumQuery =
  | typeof api.albums.getById
  | typeof api.albums.getWithGroup
  | typeof api.albums.getWithCover
  | typeof api.albums.listPhotos;

const BY_ALBUM: Array<[string, AlbumQuery]> = [
  ["getById", api.albums.getById],
  ["getWithGroup", api.albums.getWithGroup],
  ["getWithCover", api.albums.getWithCover],
  ["listPhotos", api.albums.listPhotos],
];

type GroupQuery =
  | typeof api.albums.listByGroup
  | typeof api.albums.listByGroupWithUnread;

const BY_GROUP: Array<[string, GroupQuery]> = [
  ["listByGroup", api.albums.listByGroup],
  ["listByGroupWithUnread", api.albums.listByGroupWithUnread],
];

// Losse client-vorm: `t` en `t.withIdentity(...)` hebben allebei `query`.
type Client = Pick<T, "query">;

function byAlbum(c: Client, q: AlbumQuery, albumId: Id<"albums">) {
  return c.query(q as typeof api.albums.getById, { albumId });
}
function byGroup(c: Client, q: GroupQuery, groupId: Id<"groups">) {
  return c.query(q as typeof api.albums.listByGroup, { groupId });
}

describe("albums — auth per query", () => {
  for (const [name, q] of BY_ALBUM) {
    it(`${name}: niet-ingelogd en identity zonder users-rij throwen`, async () => {
      const t = newT();
      const w = await seedWorld(t);
      await expect(byAlbum(t, q, w.albums.A1)).rejects.toThrow();
      await expect(byAlbum(asGhost(t), q, w.albums.A1)).rejects.toThrow();
    });

    it(`${name}: niet-lid krijgt hetzelfde als bij een onbekend album`, async () => {
      const t = newT();
      const w = await seedWorld(t);
      const gone = await staleId(t, w, "albums");
      const carol = asUser(t, w, "carol");
      await expectNoOracle(
        () => byAlbum(carol, q, gone),
        () => byAlbum(carol, q, w.albums.A1),
      );
    });
  }

  for (const [name, q] of BY_GROUP) {
    it(`${name}: niet-ingelogd throwt; niet-lid = onbekende groep`, async () => {
      const t = newT();
      const w = await seedWorld(t);
      await expect(byGroup(t, q, w.groups.G1)).rejects.toThrow();
      const gone = await staleId(t, w, "groups");
      const carol = asUser(t, w, "carol");
      await expectNoOracle(
        () => byGroup(carol, q, gone),
        () => byGroup(carol, q, w.groups.G1),
      );
    });
  }
});

describe("albums — geen webmaster-bypass (audit-ronde 1)", () => {
  for (const [name, q] of BY_ALBUM) {
    it(`${name}: webmaster zonder lidmaatschap = onbekend album`, async () => {
      const t = newT();
      const w = await seedWorld(t);
      const gone = await staleId(t, w, "albums");
      const wm = asUser(t, w, "wm");
      await expectNoOracle(
        () => byAlbum(wm, q, gone),
        () => byAlbum(wm, q, w.albums.A1),
      );
    });
  }

  for (const [name, q] of BY_GROUP) {
    it(`${name}: webmaster zonder lidmaatschap = onbekende groep`, async () => {
      const t = newT();
      const w = await seedWorld(t);
      const gone = await staleId(t, w, "groups");
      const wm = asUser(t, w, "wm");
      await expectNoOracle(
        () => byGroup(wm, q, gone),
        () => byGroup(wm, q, w.groups.G1),
      );
    });
  }
});

describe("albums — vormen voor een lid", () => {
  it("getById: precies de album-velden", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const a = (await asUser(t, w, "bob").query(api.albums.getById, {
      albumId: w.albums.A1,
    })) as R;
    expectShape(a, SHAPE.album);
    expect(a._id).toBe(w.albums.A1);
  });

  it("getWithGroup: album-velden + group als groep-vorm", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const a = (await asUser(t, w, "bob").query(api.albums.getWithGroup, {
      albumId: w.albums.A1,
    })) as R;
    expectShape(a, [...SHAPE.album, "group"]);
    expectShape(a.group, SHAPE.group);
    expect(a.group._id).toBe(w.groups.G1);
  });

  it("getWithCover: album-velden + cover als foto-vorm (gemelde cover zonder flag-velden)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const a = (await asUser(t, w, "alice").query(api.albums.getWithCover, {
      albumId: w.albums.A1,
    })) as R;
    expectShape(a, [...SHAPE.album, "cover"]);
    expectShape(a.cover, SHAPE.photo);
    expect(a.cover._id).toBe(w.photos.pBob);
    expectNoUserSecrets(a, w);
  });

  it("listByGroup: per album precies de album-velden", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const list = (await asUser(t, w, "bob").query(api.albums.listByGroup, {
      groupId: w.groups.G1,
    })) as R[];
    expect(list.map((a) => a._id)).toEqual([w.albums.A1]);
    for (const a of list) expectShape(a, SHAPE.album);
  });

  it("listByGroupWithUnread: per album album-velden + unreadCount", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const list = (await asUser(t, w, "bob").query(
      api.albums.listByGroupWithUnread,
      { groupId: w.groups.G1 },
    )) as R[];
    expect(list).toHaveLength(1);
    for (const a of list) {
      expectShape(a, [...SHAPE.album, "unreadCount"]);
      expect(typeof a.unreadCount).toBe("number");
    }
  });

  it("listPhotos: per item albumPhoto-velden + foto-vorm; geen GPS, filename, flag-velden of user-secrets", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const list = (await asUser(t, w, "bob").query(api.albums.listPhotos, {
      albumId: w.albums.A1,
    })) as R[];
    expect(list.map((i) => i.photo._id).sort()).toEqual(
      [w.photos.pBob, w.photos.pAlice].sort(),
    );
    for (const item of list) {
      expectShape(item, ["albumPhoto", "photo"]);
      expectShape(item.albumPhoto, SHAPE.albumPhoto);
      expectShape(item.photo, SHAPE.photo);
      expect(item.albumPhoto.photoId).toBe(item.photo._id);
    }
    expectNoUserSecrets(list, w);
  });
});

describe("albums.listPhotos — null-tak (audit-ronde 1)", () => {
  it("foto-rij ontbreekt maar de publicatie staat er nog: photo is null, albumPhoto blijft in de vorm", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run((ctx) => ctx.db.delete(w.photos.pAlice));
    const list = (await asUser(t, w, "bob").query(api.albums.listPhotos, {
      albumId: w.albums.A1,
    })) as R[];
    const orphan = list.find((i) => i.albumPhoto.photoId === w.photos.pAlice);
    expect(orphan, "publicatie van de verdwenen foto ontbreekt").toBeDefined();
    expectShape(orphan, ["albumPhoto", "photo"]);
    expectShape(orphan!.albumPhoto, SHAPE.albumPhoto);
    expect(orphan!.photo).toBeNull();
  });
});
