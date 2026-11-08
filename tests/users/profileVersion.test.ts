import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { seedPhoto } from "../photoFormats/_helpers";
import { seedMember } from "../_helpers/membership";

// WP17b fix-cyclus 1, invariant 13 (audit B1): een nieuw beeld laadt overal
// opnieuw, zonder beeld-id.
//
// De profiel-URL is per user altijd gelijk. De app ziet een nieuwe profielfoto
// dus alleen aan de user-vorm. Wisselt alleen het beeld (zelfde stand, zelfde
// formaat-vlag), dan moet er toch iets in de vorm anders zijn: `profileVersion`.
// Ondoorzichtig: geen beeld-id, foto-id of formaat-id erin (WP17a invariant 10).
// Gelijk zolang het beeld gelijk blijft, anders herlaadt de avatar voor niets.
//
// Spec: docs/work-packages/WP17b-foto-acties.md §Fix-cyclus 1.

type T = ReturnType<typeof convexTest>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Owen (admin) en Mia (lid) in G, album A. `anchor` is een foto van Owen in A,
 * zodat de foto-reads Owen als eigenaar tonen. Een open uitnodiging van Owen
 * voor de anonieme landing.
 */
async function setup(t: T) {
  const owen = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  const mia = await registerUser(t, "user_mia", "mia@x.com", "Mia");
  const G = await withUser(t, "user_owen").mutation(api.groups.create, { name: "G" });
  await seedMember(t, { groupId: G, userId: mia });
  const A = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: G, name: "A" });
  const anchor = await seedPhoto(t, owen, { original: "ANKER" });
  await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: A, photoId: anchor.photoId });
  await t.run((ctx) =>
    ctx.db.insert("invites", {
      email: "nieuw@x.com",
      invitedBy: owen,
      groupId: G,
      role: "member",
      token: "tok-owen",
      status: "pending",
      expiresAt: Date.now() + DAY,
      createdAt: Date.now(),
    }),
  );
  return { owen, mia, G, A, anchor };
}

type S = Awaited<ReturnType<typeof setup>>;

/** Owen zoals de zeven responses met een avatar hem tonen (WP25 invariant 19). */
async function views(t: T, s: S): Promise<[string, R][]> {
  const mia = withUser(t, "user_mia");
  const owen = withUser(t, "user_owen");
  const withOwner = (await mia.query(api.photos.getWithOwner, { photoId: s.anchor.photoId })) as R;
  const listed = ((await mia.query(api.albums.listPhotos, { albumId: s.A })) as R[]).find(
    (i) => i.photo?._id === s.anchor.photoId,
  )!;
  const member = ((await mia.query(api.groups.listMembers, { groupId: s.G })) as R[]).find(
    (m) => m.user?._id === s.owen,
  )!;
  return [
    ["photos.getWithOwner", withOwner.owner],
    ["albums.listPhotos", listed.owner],
    ["groups.listMembers", member.user],
    ["users.getById", (await mia.query(api.users.getById, { userId: s.owen })) as R],
    ["users.current", (await owen.query(api.users.current, {})) as R],
    ["users.profile", (await owen.query(api.users.profile, {})) as R],
    ["invites.getByToken", ((await t.query(api.invites.getByToken, { token: "tok-owen" })) as R).inviter],
  ];
}

async function versions(t: T, s: S): Promise<Record<string, unknown>> {
  return Object.fromEntries((await views(t, s)).map(([name, u]) => [name, u?.profileVersion]));
}

function expectAllChanged(before: Record<string, unknown>, after: Record<string, unknown>, label: string) {
  for (const name of Object.keys(before)) {
    expect(after[name], `${label}: ${name}`).not.toEqual(before[name]);
  }
}

const setProfile = (t: T, photoId: Id<"photos">) =>
  withUser(t, "user_owen").mutation(api.users.setProfilePhoto, { photoId });

describe("profileVersion in elke user-vorm met een avatar", () => {
  it("een string in alle zeven, en voor één user overal gelijk; ook zonder profielfoto", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    for (const label of ["geen profielfoto", "eigen foto"]) {
      if (label === "eigen foto") {
        const p = await seedPhoto(t, s.owen, { original: "P", withFormats: true, exifOrientation: 6 });
        await setProfile(t, p.photoId);
      }
      const v = Object.values(await versions(t, s));
      for (const value of v) expect(typeof value, label).toBe("string");
      expect(new Set(v).size, `${label}: overal dezelfde`).toBe(1);
    }
  });

  it("ondoorzichtig: geen beeld-id, foto-id of formaat-id erin, ook niet als deel", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const withFormats = await seedPhoto(t, s.owen, { original: "MET", withFormats: true, exifOrientation: 3 });
    const plain = await seedPhoto(t, s.owen, { original: "ZONDER" });
    const loose = await t.run((ctx) => ctx.storage.store(new Blob(["LOS"], { type: "image/jpeg" })));

    const cases: [string, () => Promise<unknown>][] = [
      ["met formaten", () => setProfile(t, withFormats.photoId)],
      ["zonder formaten", () => setProfile(t, plain.photoId)],
      ["los beeld", () => t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: loose }))],
    ];
    for (const [label, set] of cases) {
      await set();
      const ids = await t.run(async (ctx) => [
        ...(await ctx.db.system.query("_storage").collect()).map((f) => f._id as string),
        ...(await ctx.db.query("photos").collect()).map((p) => p._id as string),
      ]);
      for (const [name, value] of Object.entries(await versions(t, s))) {
        for (const id of ids) expect(String(value), `${label}: ${name} bevat ${id}`).not.toContain(id);
      }
    }
  });
});

describe("profileVersion verandert als het beeld achter de avatar verandert", () => {
  it("een andere eigen foto, met dezelfde stand en formaten (users.setProfilePhoto)", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p1 = await seedPhoto(t, s.owen, { original: "EEN", withFormats: true, exifOrientation: 6 });
    const p2 = await seedPhoto(t, s.owen, { original: "TWEE", withFormats: true, exifOrientation: 6 });
    await setProfile(t, p1.photoId);
    const before = await versions(t, s);
    await setProfile(t, p2.photoId);
    expectAllChanged(before, await versions(t, s), "EEN → TWEE");
  });

  it("een andere eigen foto, beide zonder stand en zonder formaten", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p1 = await seedPhoto(t, s.owen, { original: "EEN" });
    const p2 = await seedPhoto(t, s.owen, { original: "TWEE" });
    await setProfile(t, p1.photoId);
    const before = await versions(t, s);
    await setProfile(t, p2.photoId);
    expectAllChanged(before, await versions(t, s), "EEN → TWEE");
  });

  it("via updateProfile met het beeld van een eigen foto", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p1 = await seedPhoto(t, s.owen, { original: "EEN", withFormats: true, exifOrientation: 1 });
    const p2 = await seedPhoto(t, s.owen, { original: "TWEE", withFormats: true, exifOrientation: 1 });
    await setProfile(t, p1.photoId);
    const before = await versions(t, s);
    await withUser(t, "user_owen").mutation(api.users.updateProfile, { profilePhotoStorageId: p2.storageId });
    expectAllChanged(before, await versions(t, s), "updateProfile");
  });

  it("geen profielfoto → een foto zonder stand en zonder formaten", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await seedPhoto(t, s.owen, { original: "EEN" });
    const before = await versions(t, s);
    await setProfile(t, p.photoId);
    expectAllChanged(before, await versions(t, s), "geen → foto");
  });

  it("een los gemigreerd beeld → een eigen foto zonder stand en zonder formaten", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const loose = await t.run((ctx) => ctx.storage.store(new Blob(["LOS"], { type: "image/jpeg" })));
    await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: loose }));
    const p = await seedPhoto(t, s.owen, { original: "EEN" });
    const before = await versions(t, s);
    await setProfile(t, p.photoId);
    expectAllChanged(before, await versions(t, s), "los → foto");
  });

  it("de profielfoto wordt gewist (zonder stand en zonder formaten): geen beeld meer", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await seedPhoto(t, s.owen, { original: "EEN" });
    await setProfile(t, p.photoId);
    const before = await versions(t, s);
    await withUser(t, "user_owen").mutation(api.photos.remove, { photoId: p.photoId });
    expectAllChanged(before, await versions(t, s), "gewist");
  });
});

describe("profileVersion blijft gelijk als er aan het beeld niets verandert", () => {
  it("twee keer lezen", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await seedPhoto(t, s.owen, { original: "EEN", withFormats: true, exifOrientation: 6 });
    await setProfile(t, p.photoId);
    expect(await versions(t, s)).toEqual(await versions(t, s));
  });

  it("een andere naam, een nieuwe foto in het album, en een nieuwe profielfoto van een ander", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await seedPhoto(t, s.owen, { original: "EEN", withFormats: true, exifOrientation: 6 });
    await setProfile(t, p.photoId);
    const before = await versions(t, s);

    await withUser(t, "user_owen").mutation(api.users.updateProfile, { name: "Owen B" });
    const extra = await seedPhoto(t, s.owen, { original: "EXTRA" });
    await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: s.A, photoId: extra.photoId });
    const miaPhoto = await seedPhoto(t, s.mia, { original: "MIA" });
    await withUser(t, "user_mia").mutation(api.users.setProfilePhoto, { photoId: miaPhoto.photoId });

    expect(await versions(t, s)).toEqual(before);
  });
});
