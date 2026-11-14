import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, newT, type T } from "../groups/_beheer";
import { SCHOON } from "../_helpers/jpeg";
import { allKeys, secondGroup, seedCover, seedInvite, world } from "./_wp19b";

// WP19c besluit 4, A-invariant 12: de cover op de uitnodigingskaart staat
// rechtop. `listReceived` geeft daarvoor bij de groep alleen `coverOrientation`
// (de `exifOrientation` van de cover, dezelfde die een lid via
// `groups.getWithCover` krijgt). Alleen als `hasCover` true is en de cover een
// stand heeft. Geen ander foto-veld.

const listReceived = api.invites.listReceived;
type R = Record<string, unknown>;
type Group = { _id: string; name: string; hasCover: boolean; coverOrientation?: number };

async function setStand(t: T, photoId: Id<"photos">, stand: number | undefined): Promise<void> {
  await t.run(async (ctx) => ctx.db.patch(photoId, { exifOrientation: stand }));
}

async function bobsGroup(t: T): Promise<Group> {
  const got = (await as(t, "user_bob").query(listReceived, {})) as R[];
  expect(got).toHaveLength(1);
  return got[0]!.group as Group;
}

async function invited(t: T) {
  const w = await world(t);
  await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
  return w;
}

describe("A-invariant 12 — coverOrientation bij de groep", () => {
  for (const stand of [3, 6, 8, 2]) {
    it(`cover met stand ${stand}: coverOrientation = ${stand}, gelijk aan wat een lid ziet`, async () => {
      const t = newT();
      const w = await invited(t);
      const { photoId } = await seedCover(t, w, { bytes: SCHOON });
      await setStand(t, photoId, stand);

      const group = await bobsGroup(t);
      expect(group.hasCover).toBe(true);
      expect(group.coverOrientation).toBe(stand);

      const member = (await as(t, "user_lex").query(api.groups.getWithCover, { groupId: w.groupId })) as {
        cover: { exifOrientation?: number } | null;
      };
      expect(group.coverOrientation).toBe(member.cover?.exifOrientation);
    });
  }

  it("cover zonder stand: het veld ontbreekt", async () => {
    const t = newT();
    const w = await invited(t);
    await seedCover(t, w, { bytes: SCHOON });
    const group = await bobsGroup(t);
    expect(group.hasCover).toBe(true);
    expect("coverOrientation" in group).toBe(false);
  });

  it("groep zonder cover: geen coverOrientation", async () => {
    const t = newT();
    await invited(t);
    const group = await bobsGroup(t);
    expect(group.hasCover).toBe(false);
    expect("coverOrientation" in group).toBe(false);
  });

  it("cover met stand, maar alleen in een album van een andere groep: hasCover false, geen stand", async () => {
    const t = newT();
    const w = await invited(t);
    const other = await secondGroup(t, w);
    const { photoId } = await seedCover(t, w, { bytes: SCHOON, groupId: other });
    await t.run(async (ctx) => ctx.db.patch(w.groupId, { coverPhotoId: photoId }));
    await setStand(t, photoId, 6);
    const group = await bobsGroup(t);
    expect(group.hasCover).toBe(false);
    expect("coverOrientation" in group).toBe(false);
  });

  it("reactief: draait een lid de cover, dan volgt de stand", async () => {
    const t = newT();
    const w = await invited(t);
    const { photoId } = await seedCover(t, w, { bytes: SCHOON });
    await setStand(t, photoId, 6);
    expect((await bobsGroup(t)).coverOrientation).toBe(6);
    await setStand(t, photoId, 3);
    expect((await bobsGroup(t)).coverOrientation).toBe(3);
  });
});

describe("A-invariant 12 — de whitelist groeit met precies één veld", () => {
  it("groep: alleen _id, name, hasCover, coverOrientation; geen foto-id, storage-id of andere foto-velden", async () => {
    const t = newT();
    const w = await invited(t);
    const { photoId } = await seedCover(t, w, { bytes: SCHOON, formats: { klein: SCHOON, groot: SCHOON } });
    await t.run(async (ctx) =>
      ctx.db.patch(photoId, {
        exifOrientation: 6,
        width: 4032,
        height: 3024,
        takenAt: Date.now() - 1000,
        latitude: 52.37,
        longitude: 4.89,
      }),
    );
    const photo = (await t.run(async (ctx) => ctx.db.get(photoId)))!;

    const group = await bobsGroup(t);
    expect(Object.keys(group).sort()).toEqual(["_id", "coverOrientation", "hasCover", "name"]);

    const got = (await as(t, "user_bob").query(listReceived, {})) as R[];
    const json = JSON.stringify(got);
    for (const id of [photoId, photo.storageId, photo.formats!.klein, photo.formats!.groot]) {
      expect(json).not.toContain(String(id));
    }
    const keys = allKeys(got);
    for (const k of ["exifOrientation", "hasFormats", "width", "height", "takenAt", "latitude", "longitude", "coverPhotoId", "cover"]) {
      expect(keys).not.toContain(k);
    }
  });
});
